/**
 * skill 激活门：工具只在对应 skill 被 **模型加载** 之后才对这一步可见。
 *
 * 做法照抄官方 `@deepseek-ai/dsh-action-cards`（lib/index.js:369-394、591-594）：
 *   - `ctx.tools.register(definition, { when })`，条件由 `tools.resolve()` 每个 step 求值一次；
 *   - 条件只读内存里的已加载集合，不写注册、不发请求（官方约束）；
 *   - 已加载集合由 `tools/result` 观察 `skill` 工具的成功调用维护，`agent/disposed` 清理；
 *   - 条件抛错会让整个 step 以 `TOOL_ACTIVATION_FAILED` 失败，所以这里一律 try/catch。
 *
 * 注意官方边界（已核实）：`dsh-tool-skill` 在 `agent/pre-step` 注入 `/xxx` 手势时**不触发事件**，
 * 没有任何官方 hook。所以本门只认模型自助加载这条路；`/xxx` 不再点亮工具。
 */

/** 官方 skill 工具名（dsh-tool-skill 注册的模型侧加载器）。 */
const SKILL_TOOL = 'skill';

/** `skill` 工具的参数是 `{ name }`；`tool/call` 事件里存的是 JSON 字符串。 */
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
 * @returns `{ when(skillName), __internals }`
 */
export function createSkillGate(ctx, ownedSkills) {
  const owned = new Set(ownedSkills);
  const loaded = new Map(); // Agent -> Set<skill>
  const seeded = new WeakSet(); // 已按会话日志补过水

  function mark(agent, name) {
    if (agent === undefined || agent === null) return;
    if (typeof name !== 'string' || !owned.has(name)) return;
    const set = loaded.get(agent) ?? new Set();
    set.add(name);
    loaded.set(agent, set);
  }

  /**
   * resume / fork 后用会话日志补一次：已经加载过的 skill 不该让工具重新变回不可见。
   * 只读公开的 `session.snapshotEvents()`，不碰 inbox 之类的内部事件。
   */
  function seed(agent) {
    if (agent === undefined || agent === null || seeded.has(agent)) return;
    seeded.add(agent);
    const session = agent.session;
    if (session === undefined || typeof session.snapshotEvents !== 'function') return;
    const events = session.snapshotEvents();
    if (!Array.isArray(events)) return;
    for (const event of events) {
      if (event === null || typeof event !== 'object') continue;
      if (event.type === 'tool/call') {
        if (event.data?.name !== SKILL_TOOL) continue;
        mark(agent, skillNameOf(event.data.arguments));
      } else if (event.type === 'user/message') {
        const source = event.data?.source;
        if (source?.kind !== 'skill-invocation') continue;
        mark(agent, source.name);
      }
    }
  }

  if (typeof ctx.on === 'function' && typeof ctx.effect === 'function') {
    ctx.effect(() =>
      ctx.on('tools/result', (exec, result) => {
        // PTC 嵌套调用不算作加载：只有模型直接调用 skill 才点亮。
        if (exec === undefined || exec.parent !== undefined) return;
        if (exec.name !== SKILL_TOOL || result?.isError === true) return;
        mark(exec.agent, skillNameOf(exec.arguments));
      }),
    );
    ctx.effect(() =>
      ctx.on('agent/disposed', ({ agent }) => {
        loaded.delete(agent);
      }),
    );
  }

  return {
    /**
     * 生成一个 `when` 条件。同一个 skill 的工具共用一个函数，避免每 step 重复求值逻辑。
     * @param skillName 本组工具所属的 skill
     */
    when(skillName) {
      return ({ agent }) => {
        try {
          if (process.env.CP_TOOLS_SKILL_GATE === 'off') return true;
          seed(agent);
          return loaded.get(agent)?.has(skillName) === true;
        } catch {
          // 条件失败不能拖垮 step（框架会判 TOOL_ACTIVATION_FAILED）：退化成"不可见"。
          return false;
        }
      };
    },
    __internals: { loaded, owned },
  };
}
