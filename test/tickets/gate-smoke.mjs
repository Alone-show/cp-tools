// 离线冒烟：/tickets 注册 8 个工具、skill 可被模型/用户调用。
import assert from 'node:assert/strict';
import path from 'node:path';
import { apply, __internals } from '../../src/tickets/index.js';

const { readBundledSkill, SKILL_FILE } = __internals;

const skill = readBundledSkill();
assert.equal(skill.name, 'tickets');
assert.equal(skill.invocation.modelInvocable, true);
// 工具有 skill 激活门：/tickets 不再走手势（手势只注入正文、不给工具），改为模型自助加载。
assert.equal(skill.invocation.userInvocable, false);
assert.equal(skill.source, 'runtime');
assert.equal(skill.path, SKILL_FILE);
assert.equal(skill.resourceBase.path, path.dirname(SKILL_FILE));
assert.ok(skill.content.trimStart().startsWith('# 工单与历史 bug 查验'));
assert.ok(skill.content.includes('/tickets'));
assert.ok(skill.description.includes('任务号'));
console.log('ok  tickets skill 覆盖工单与历史 bug');

const tools = [];
const ctx = {
  get: () => undefined,
  effect: (fn) => {
    fn();
    return () => {};
  },
  on: () => () => {},
  tools: {
    register(definition, options) {
      tools.push({ ...definition, __when: options?.when });
      return () => {};
    },
  },
  skills: { register: () => () => {} },
};
apply(ctx);

for (const tool of tools) assert.equal(typeof tool.__when, 'function', `${tool.name} 缺 skill 激活门`);
assert.equal(tools[0].__when({ agent: { session: undefined } }), false, '未加载 tickets skill 时不可见');
process.env.CP_TOOLS_SKILL_GATE = 'off';
try {
  assert.equal(tools[0].__when({ agent: { session: undefined } }), true, '急停开关应恒可见');
} finally {
  delete process.env.CP_TOOLS_SKILL_GATE;
}
console.log(`ok  ${tools.length} 个工单工具都带 skill 激活门`);

assert.deepEqual(tools.map((t) => t.name).sort(), [
  'ticket_bug_check',
  'ticket_bug_log',
  'ticket_bug_matrix',
  'ticket_bug_models',
  'ticket_bug_sync',
  'ticket_login',
  'ticket_search',
  'ticket_sync',
]);
console.log('ok  注册 8 个工单/bug 工具');

for (const tool of tools) {
  assert.equal(tool.parameters.type, 'object');
  assert.ok(tool.output?.schema, `${tool.name} 缺 output.schema`);
  assert.equal(typeof tool.output.render, 'function', `${tool.name} 缺 output.render`);
}
console.log('ok  schema/render 完整');

console.log('\n全部通过');
