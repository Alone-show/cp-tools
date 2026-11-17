/**
 * skill 激活门：工具只在对应 skill 被 **加载** 之后才对下一步可见。
 *
 * 两条加载路径：
 *   1. 模型调用 `skill` 工具（官方 action-cards 范式：`tools/result` 观察，下一步生效）；
 *   2. 用户输入 `/<entry>` 命令（`shared/entry.js`）：命令把 skill 正文注入为一条
 *      `cp-tools-entry` 上下文，并调用 `gate.activate()`，本步起可见。
 *
 * 状态来源优先用 **会话投影**（`ctx.sessionProjections`）：
 *   - 从日志折叠 `tool/call` + `tool/result`（成功才点亮）、手势注入、命令入口；
 *   - resume / fork / compaction 后自动复原，不再调用已弃用的 `session.snapshotEvents()`。
 * 只有组合里没有 sessionProjections 时才退回「内存 + 日志补水」，并只告警一次。
 */

/** 官方 skill 工具名（dsh-tool-skill 注册的模型侧加载器）。 */
const SKILL_TOOL = 'skill';

/** 投影 key / 版本；四个子插件共用同一 key，框架按 refs 共享一份状态。 */
export const GATE_KEY = 'cp-tools.gate';
const GATE_VERSION = 1;

/**
 * 投影状态校验器。
 *
 * 框架的 `stateSchema` 按 Standard Schema 用（只调用 `.parse()` 做 checkpoint 冷读），
 * 而 cp-tools 不依赖 zod/schemastery（本地 link 插件没有依赖树），所以这里给一个
 * 最小的解析器：形状不对就抛错，让框架退回 `init` + 重放日志。
 */
const STATE_SCHEMA = {
  parse(value) {
    if (value === null || typeof value !== 'object') throw new TypeError('cp-tools gate state 必须是对象');
    if (!Array.isArray(value.loaded) || !value.loaded.every((item) => typeof item === 'string')) {
      throw new TypeError('cp-tools gate state.loaded 必须是字符串数组');
    }
    if (!Array.isArray(value.entered) || !value.entered.every((item) => typeof item === 'string')) {
      throw new TypeError('cp-tools gate state.entered 必须是字符串数组');
    }
    if (
      !Array.isArray(value.pending) ||
      !value.pending.every(
        (item) => item !== null && typeof item === 'object' && typeof item.callId === 'string' && typeof item.name === 'string',
      )
    ) {
      throw new TypeError('cp-tools gate state.pending 必须是 {callId,name} 数组');
    }
    return {
      loaded: [...value.loaded],
      entered: [...value.entered],
      pending: value.pending.map((item) => ({ callId: item.callId, name: item.name })),
    };
  },
};

/** 空状态；每次 init 都新建，避免共享可变数组。 */
export function emptyGateState() {
  return { loaded: [], entered: [], pending: [] };
}

/** `skill` 工具的参数是 `{ name }`；事件里可能存对象，也可能存 JSON 字符串。 */
function skillNameOf(args) {
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch {
      return undefined;
    }
  }
  if (args === null || typeof args !== 'object') return undefined;
  return typeof args.name === 'string' ? args.name : undefined;
}

function unique(list, value) {
  return list.includes(value) ? list : [...list, value];
}

/**
 * 折叠一条会话事件；无变化时返回同一引用（投影框架用 Object.is 判断变更）。
 *
 * 事件形状（已按会话日志核实）：
 *   - `tool/call`   → `data.name` / `data.arguments`（JSON 字符串）/ `data.callId`
 *   - `tool/result` → `data.toolCallId` / `data.message.isError`
 *   - `user/message`→ `data.source.kind`（`skill-invocation` / `cp-tools-entry`）/ `data.source.name`
 *
 * @param {{loaded: string[], entered: string[], pending: {callId: string, name: string}[]}} state
 * @param {{type?: string, data?: any}} event
 */
export function foldGateState(state, event) {
  const type = event?.type;
  const data = event?.data;

  if (type === 'tool/call') {
    if (data?.name !== SKILL_TOOL) return state;
    const name = skillNameOf(data.arguments);
    const callId = typeof data.callId === 'string' ? data.callId : undefined;
    if (name === undefined || callId === undefined) return state;
    return { ...state, pending: [...state.pending, { callId, name }] };
  }

  if (type === 'tool/result') {
    const callId = typeof data?.toolCallId === 'string' ? data.toolCallId : undefined;
    if (callId === undefined) return state;
    const index = state.pending.findIndex((item) => item.callId === callId);
    if (index < 0) return state;
    const entry = state.pending[index];
    const pending = state.pending.filter((_item, i) => i !== index);
    if (data?.message?.isError === true) return { ...state, pending };
    const loaded = unique(state.loaded, entry.name);
    return { ...state, pending, loaded };
  }

  if (type === 'user/message') {
    const source = data?.source;
    if (source === null || typeof source !== 'object') return state;
    const name = typeof source.name === 'string' ? source.name : undefined;
    if (name === undefined) return state;
    const gesture = source.kind === 'skill-invocation';
    const entry = source.kind === 'cp-tools-entry';
    if (!gesture && !entry) return state;
    const loaded = unique(state.loaded, name);
    const entered = entry ? unique(state.entered, name) : state.entered;
    if (loaded === state.loaded && entered === state.entered) return state;
    return { ...state, loaded, entered };
  }

  return state;
}

/**
 * 给工具的 description 前置一句「归属 + 作用边界」，让模型即使在工具可见后也知道边界。
 *
 * 不新增参数、不改 name，只改描述文本；工具对象保持浅拷贝，避免同一定义被复用时互相污染。
 *
 * @param tool 原始工具定义
 * @param scopeText 一句话边界，例：`【bpms 技能】只操作订单需求表，默认 dry-run。`
 */
export function withSkillScope(tool, scopeText) {
  const description = typeof tool?.description === 'string' ? tool.description : '';
  return { ...tool, description: `${scopeText}${description === '' ? '' : ` ${description}`}` };
}

/**
 * @param ctx Cordis 插件上下文
 * @param ownedSkills 本插件负责的 skill 名（其它 skill 的加载不点亮本插件工具）
 * @returns {{
 *   when: (skillName: string) => (context: {agent?: object, signal?: AbortSignal}) => Promise<boolean>,
 *   activate: (agent: object, skillName: string) => void,
 *   entered: (skillName: string, agent?: object) => boolean,
 *   ready: Promise<void>,
 *   __internals: object,
 * }}
 */
export function createSkillGate(ctx, ownedSkills) {
  const owned = new Set(ownedSkills);
  const memory = new Map(); // Agent -> { loaded: Set, entered: Set }
  const seeded = new WeakSet();
  const warned = new Set();
  let handle;
  let legacy = false;
  let ready = Promise.resolve();

  function warnOnce(key, message, error) {
    if (warned.has(key)) return;
    warned.add(key);
    const detail = error === undefined ? '' : `：${error?.message ?? String(error)}`;
    try {
      if (ctx.logger?.warn) ctx.logger.warn(`[cp-tools/skill-gate] ${message}${detail}`);
      else console.warn(`[cp-tools/skill-gate] ${message}${detail}`);
    } catch {
      /* 日志失败不影响激活判断 */
    }
  }

  function remember(agent) {
    let state = memory.get(agent);
    if (state === undefined) {
      state = { loaded: new Set(), entered: new Set() };
      memory.set(agent, state);
    }
    return state;
  }

  // ---- 投影注册（优先） ------------------------------------------------
  const projections = typeof ctx.get === 'function' ? ctx.get('sessionProjections') : undefined;
  if (projections !== undefined && typeof projections.register === 'function') {
    try {
      ready = Promise.resolve(
        projections.register({
          key: GATE_KEY,
          stateVersion: GATE_VERSION,
          stateSchema: STATE_SCHEMA,
          init: () => emptyGateState(),
          apply: foldGateState,
        }),
      )
        .then((registered) => {
          handle = registered;
          // 投影注册由服务持有；插件卸载时显式释放，避免反复装/卸累积 refs。
          try {
            if (typeof ctx.effect === 'function' && typeof registered?.dispose === 'function') {
              ctx.effect(() => () => registered.dispose());
            }
          } catch {
            /* 插件已卸载：注册会随服务生命周期结束 */
          }
        })
        .catch((error) => {
          legacy = true;
          warnOnce('projection', 'session projection 注册失败，退回内存 + 日志补水', error);
        });
    } catch (error) {
      legacy = true;
      warnOnce('projection', 'session projection 注册失败，退回内存 + 日志补水', error);
    }
  } else {
    legacy = true;
    warnOnce(
      'missing',
      '当前组合没有 sessionProjections，退回内存 + 日志补水（snapshotEvents 已弃用，建议装配 session-projection）',
    );
  }

  // ---- 实时观察（投影存在时作为同一步的即时来源，也是无投影时的唯一来源） ----
  if (typeof ctx.on === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() =>
      ctx.on('tools/result', (exec, result) => {
        // PTC 嵌套调用不算作加载：只有模型直接调用 skill 才点亮。
        if (exec === undefined || exec.parent !== undefined) return;
        if (exec.name !== SKILL_TOOL || result?.isError === true) return;
        if (exec.agent === undefined || exec.agent === null) return;
        const name = skillNameOf(exec.arguments);
        if (name === undefined || !owned.has(name)) return;
        try {
          remember(exec.agent).loaded.add(name);
        } catch {
          /* 记账失败不拖垮 turn */
        }
      }),
    );
    ctx.effect(() =>
      ctx.on('agent/disposed', ({ agent }) => {
        memory.delete(agent);
      }),
    );
  }

  /** 无投影时：从会话日志折叠一次，等价于投影的冷启动。 */
  function seed(agent) {
    if (!legacy) return;
    if (agent === undefined || agent === null || seeded.has(agent)) return;
    seeded.add(agent);
    const session = agent.session;
    if (session === undefined || typeof session.snapshotEvents !== 'function') return;
    let events;
    try {
      events = session.snapshotEvents();
    } catch (error) {
      warnOnce('seed', '读取会话日志补水失败，已加载状态按内存处理', error);
      return;
    }
    if (!Array.isArray(events)) return;
    let state = emptyGateState();
    for (const event of events) state = foldGateState(state, event);
    const bucket = remember(agent);
    for (const name of state.loaded) if (owned.has(name)) bucket.loaded.add(name);
    for (const name of state.entered) if (owned.has(name)) bucket.entered.add(name);
  }

  /** 从投影读取一个字段，读不到就用内存。 */
  function fromProjection(agent, field) {
    if (handle === undefined) return undefined;
    const session = agent?.session;
    if (session === undefined) return undefined;
    try {
      const state = handle.stateOf(session);
      const value = state?.[field];
      return Array.isArray(value) ? value : undefined;
    } catch (error) {
      warnOnce('state', '读取 session projection 失败，退回内存状态', error);
      return undefined;
    }
  }

  function isLoaded(agent, skillName) {
    const projected = fromProjection(agent, 'loaded');
    if (projected?.includes(skillName) === true) return true;
    return memory.get(agent)?.loaded.has(skillName) === true;
  }

  function isEntered(agent, skillName) {
    const projected = fromProjection(agent, 'entered');
    if (projected?.includes(skillName) === true) return true;
    return memory.get(agent)?.entered.has(skillName) === true;
  }

  return {
    ready,

    /**
     * 生成一个 `when` 条件。条件只读状态，不写注册、不发请求；抛错会让 step 以
     * TOOL_ACTIVATION_FAILED 失败，所以这里一律降级为 false 并记一次日志。
     *
     * @param skillName 本组工具所属的 skill
     */
    when(skillName) {
      return async ({ agent, signal } = {}) => {
        if (process.env.CP_TOOLS_SKILL_GATE === 'off') return true;
        try {
          signal?.throwIfAborted?.();
          await ready;
          signal?.throwIfAborted?.();
          seed(agent);
          return owned.has(skillName) && isLoaded(agent, skillName);
        } catch (error) {
          if (signal?.aborted === true) throw error;
          warnOnce(`when:${skillName}`, `判断 ${skillName} 是否可见失败，本步按不可见处理`, error);
          return false;
        }
      };
    },

    /**
     * 命令入口用：立即使该 skill 的工具在本步可见；持久化由命令注入的
     * `cp-tools-entry` 消息（投影折叠）负责。
     */
    activate(agent, skillName) {
      if (agent === undefined || agent === null) return;
      if (!owned.has(skillName)) return;
      const bucket = remember(agent);
      bucket.loaded.add(skillName);
      bucket.entered.add(skillName);
    },

    /** 写类 guard 用：本次会话是否通过 `/<entry>` 命令进入过该 skill。 */
    entered(skillName, agent) {
      if (agent === undefined || agent === null) return false;
      return isEntered(agent, skillName);
    },

    __internals: { GATE_KEY, memory, owned, isLoaded, isEntered, foldGateState, emptyGateState },
  };
}
