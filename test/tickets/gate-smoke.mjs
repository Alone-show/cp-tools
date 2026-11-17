// 离线冒烟：/tickets 注册 8 个工具、命令入口与写类 guard 生效。
import assert from 'node:assert/strict';
import path from 'node:path';
import { apply, __internals } from '../../src/tickets/index.js';

const { readBundledSkill, SKILL_FILE } = __internals;

const skill = readBundledSkill();
assert.equal(skill.name, 'tickets');
assert.equal(skill.invocation.modelInvocable, true);
// /tickets 现在有真命令；skill 本身不再需要用户可调用（避免命令+手势双入口）。
assert.equal(skill.invocation.userInvocable, false);
assert.equal(skill.source, 'runtime');
assert.equal(skill.path, SKILL_FILE);
assert.equal(skill.resourceBase.path, path.dirname(SKILL_FILE));
assert.ok(skill.content.trimStart().startsWith('# 工单与历史 bug 查验'));
assert.ok(skill.content.includes('/tickets'));
assert.ok(skill.description.includes('任务号'));
console.log('ok  tickets skill 覆盖工单与历史 bug');

const tools = [];
const commands = [];
const guards = [];
const ctx = {
  logger: { warn() {} },
  get: () => undefined,
  effect: (fn) => {
    fn();
    return () => {};
  },
  on: () => () => {},
  inject: (deps, callback) =>
    callback({
      commands: { register: (definition) => (commands.push(definition), () => {}) },
      effect: (fn) => {
        fn();
        return () => {};
      },
    }),
  tools: {
    register(definition, options) {
      tools.push({ ...definition, __when: options?.when });
      return () => {};
    },
    guard: (guard) => (guards.push(guard), () => {}),
  },
  skills: { register: () => () => {} },
};
apply(ctx);

assert.deepEqual(commands.map((c) => c.name), ['tickets']);
console.log('ok  注册 /tickets 命令入口');
assert.equal(guards.length, 1, '应注册一个写类 guard');

for (const tool of tools) assert.equal(typeof tool.__when, 'function', `${tool.name} 缺 skill 激活门`);
assert.equal(await tools[0].__when({ agent: { session: undefined } }), false, '未加载 tickets skill 时不可见');
process.env.CP_TOOLS_SKILL_GATE = 'off';
try {
  assert.equal(await tools[0].__when({ agent: { session: undefined } }), true, '急停开关应恒可见');
} finally {
  delete process.env.CP_TOOLS_SKILL_GATE;
}
console.log(`ok  ${tools.length} 个工单工具都带 skill 激活门`);

// 写类 guard：未经命令进入 → 拒绝；经 /tickets 进入后 → 放行。
const session = {};
const agent = { session, followup: () => {} };
const denied = guards[0]({ name: 'ticket_sync', arguments: {}, agent });
assert.ok(denied, '未进入写模式时 ticket_sync 应被拒绝');
assert.match(denied, /\/tickets/);
assert.equal(guards[0]({ name: 'ticket_search', arguments: {}, agent }), undefined, '读类不受影响');
await commands[0].handler({ agent, rawInput: 'sync', signal: new AbortController().signal });
assert.equal(guards[0]({ name: 'ticket_sync', arguments: {}, agent }), undefined, '命令进入后应放行');
console.log('ok  写类 guard 按命令入口放行/拒绝');

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
