// 离线冒烟：/tickets 注册 8 个工具、skill 可被模型/用户调用。
import assert from 'node:assert/strict';
import path from 'node:path';
import { apply, __internals } from '../../src/tickets/index.js';

const { readBundledSkill, SKILL_FILE } = __internals;

const skill = readBundledSkill();
assert.equal(skill.name, 'tickets');
assert.equal(skill.invocation.modelInvocable, true);
assert.equal(skill.invocation.userInvocable, true);
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
    register(definition) {
      tools.push(definition);
      return () => {};
    },
  },
  skills: { register: () => () => {} },
};
apply(ctx);

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
