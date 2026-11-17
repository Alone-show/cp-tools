/**
 * 写类 guard：命令入口之外的写操作一律拒绝。
 *
 * 原则：读类工具允许模型自助加载（保联动），写类工具要求**本会话经 `/<entry>` 命令进入**。
 * 用 `ctx.tools.guard()` 注册（单调拒绝，后续监听器无法改回允许），拒绝理由是模型可见文本。
 *
 * @param gate createSkillGate 的返回值
 * @param {Array<{tool: string, skill: string, command: string, when?: (args: any) => boolean, reason?: string}>} rules
 * @returns {(exec: {name?: string, arguments?: any, agent?: object}) => string | undefined}
 */
export function createWriteGuard(gate, rules) {
  const byTool = new Map(rules.map((rule) => [rule.tool, rule]));

  return (exec) => {
    const rule = byTool.get(exec?.name);
    if (rule === undefined) return undefined;
    if (typeof rule.when === 'function' && rule.when(exec.arguments) !== true) return undefined;
    if (gate.entered(rule.skill, exec.agent) === true) return undefined;
    return (
      rule.reason ??
      `本次会话没有通过 /${rule.command} 进入 ${rule.skill} 的写模式：先让用户输入 /${rule.command} <需求>，再重试；只读/预演调用不受影响。`
    );
  };
}

/**
 * 把 guard 挂到 `ctx.tools.guard()`；当前 DSH 没有该 API 时只告警不抛错
 * （旧版本降级为「无写保护」，但插件本身仍可用）。
 *
 * @param {object} ctx Cordis 插件上下文
 * @param {(exec: object) => string | undefined} guard
 * @returns {() => void} disposer
 */
export function registerToolGuard(ctx, guard) {
  if (typeof ctx?.tools?.guard !== 'function') {
    ctx?.logger?.warn?.('[cp-tools] 当前 DSH 不支持 ctx.tools.guard，写类保护未生效');
    return () => {};
  }
  const dispose = ctx.tools.guard(guard);
  return typeof dispose === 'function' ? dispose : () => {};
}
