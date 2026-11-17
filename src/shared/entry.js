/**
 * 命令入口：`/firmware`、`/tickets`、`/bpms`。
 *
 * 与 skill 手势的区别：命令是**确定性入口**，不依赖模型自己判断要不要加载。
 * 命令把 skill 正文作为一条 `cp-tools-entry` 用户消息注入（客户端折叠成卡片），
 * 同时调用 `gate.activate()` —— 工具在**本步**就可见，不需要像 `skill` 工具那样等下一步。
 *
 * 持久化靠注入的消息本身：会话投影折叠 `user/message` 的 `source.kind`，
 * resume / fork 后自动恢复 `loaded` 与 `entered`（写类 guard 用后者）。
 */
import crypto from 'node:crypto';

/** 命令入口清单；`check-package` 与文档校验共用这一份。 */
export const ENTRY_COMMANDS = ['firmware', 'tickets', 'bpms'];

/** 客户端折叠卡片的摘要上限，对齐 DSH 的 boundContextSummary（120 字符、单行）。 */
const SUMMARY_MAX = 120;

function summary(text) {
  const one = String(text || '').replace(/\s+/g, ' ').trim();
  return one.length > SUMMARY_MAX ? `${one.slice(0, SUMMARY_MAX - 1)}…` : one;
}

/**
 * 构造注入消息：skill 正文在前，用户请求在最后（背景在前，材料在最后）。
 *
 * @param {object} input
 * @param {string} input.name 命令名
 * @param {string} input.skill skill 名
 * @param {string} input.body SKILL.md 正文
 * @param {string} input.query 用户请求（命令参数，或默认请求）
 * @param {string} [input.suffix] 命令自带的补充说明（如 "sync"）
 */
export function entryMessage({ name, skill, body, query, suffix }) {
  const text = [
    `【${skill} skill · 由命令入口加载】`,
    String(body || '').trim(),
    '',
    '---',
    `用户请求：${String(query || '').trim() || '（未提供，请按 skill 主线开始）'}`,
    suffix ? `命令附注：${suffix}` : '',
    `请按上面 skill 的主线处理本次请求。本页已通过命令入口加载，不要再用 skill 工具重复加载；` +
      `${skill} 的模型工具从本步起可用。`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'cp-tools-entry',
      name: skill,
      form: 'instructions',
      summary: summary(`${skill} skill · ${query || ''}`),
    },
  };
}

/**
 * 注册一个命令入口。
 *
 * @param {object} ctx Cordis 插件上下文
 * @param {object} options
 * @param {string} options.name 命令名（如 `firmware`）
 * @param {string} options.skill skill 名（通常与命令名相同）
 * @param {object} options.definition 已解析的 skill（readBundledSkill 的返回值）
 * @param {string} options.description 命令发现界面里的说明
 * @param {string} [options.hint] 输入提示
 * @param {string} options.defaultQuery 命令不带参数时的默认请求
 * @param {object} options.gate createSkillGate 的返回值
 */
export function registerEntryCommand(ctx, { name, skill, definition, description, hint, defaultQuery, gate }) {
  const handler = async (inv) => {
    const agent = inv?.agent;
    if (agent === undefined || agent === null || typeof agent.followup !== 'function') {
      return { kind: 'error', text: `/${name}：当前会话没有可用的 agent，无法加载 ${skill} skill。` };
    }
    const query = String(inv?.rawInput ?? '').trim() || defaultQuery;
    try {
      gate.activate(agent, skill);
      agent.followup(entryMessage({ name, skill, body: definition.content, query }));
      return { kind: 'success', text: `已加载 ${skill} skill，正在处理…` };
    } catch (error) {
      return { kind: 'error', text: `/${name} 加载 ${skill} skill 失败：${error?.message ?? error}` };
    }
  };

  const register = (commands) => {
    if (commands === undefined || typeof commands.register !== 'function') return undefined;
    return commands.register({
      name,
      description,
      ...(hint === undefined ? {} : { input: { hint } }),
      handler,
    });
  };

  // commands 服务在 headless 等组合里可能不存在：可选注入，不影响插件本身加载。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['commands'], (child) => {
      if (child?.commands?.register === undefined) return;
      child.effect(() => register(child.commands), `cp-tools: /${name} entry`);
    });
  } else if (ctx.commands?.register !== undefined) {
    register(ctx.commands);
  }
}
