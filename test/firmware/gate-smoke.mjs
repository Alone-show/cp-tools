// 离线冒烟：确认 /firmware 只负责固件查找，skill 与工具元信息正确。
import assert from 'node:assert/strict';
import path from 'node:path';
import { apply, __internals } from '../../src/firmware/index.js';

const { readBundledSkill, SKILL_FILE } = __internals;

const skill = readBundledSkill();
assert.equal(skill.name, 'firmware');
assert.equal(skill.invocation.modelInvocable, true, '模型目录里应能看到 firmware skill');
// /firmware 现在有真命令；skill 本身不再需要用户可调用（避免命令+手势双入口）。
assert.equal(skill.invocation.userInvocable, false, '命令入口的 skill 不出现在 / 手势菜单');
assert.equal(skill.source, 'runtime');
assert.equal(skill.path, SKILL_FILE);
assert.equal(skill.resourceBase.path, path.dirname(SKILL_FILE));
assert.ok(skill.content.trimStart().startsWith('# 固件查找'), 'frontmatter 不应进入正文');
assert.ok(skill.content.includes('/firmware'), '正文说明 /firmware 仍可作为显式入口');
assert.ok(!skill.content.includes('只能由用户显式输入'), '不应再强制斜杠');
assert.ok(skill.description.length > 0);
assert.ok(skill.description.includes('tickets'), 'firmware 描述应把工单/修复引导到 tickets');
// 回归：曾把 TB 里的 next 链接读成「alist 没收录」，skill 必须钉死两者同步这一事实
assert.ok(skill.content.includes('同一份存储'), 'skill 应说明 next 与 alist 是同一份存储、内容同步');
assert.ok(skill.content.includes('next.cpinnov.run') && skill.content.includes('alist.cpinnov.run'));
assert.ok(
  skill.content.includes('不是 alist 存在性的证据'),
  'skill 应说明「固件下载地址」不能用来判断 alist 有没有该版本',
);
console.log('ok  skill 只覆盖固件查找');

const tools = [];
const commands = [];
let preExecute = 0;
const ctx = {
  logger: { warn() {} },
  get: () => undefined,
  effect: (fn) => {
    fn();
    return () => {};
  },
  on: (name) => {
    // 只有 tools/pre-execute 才算"闸门"；skill 激活门监听的是 tools/result 与 agent/disposed。
    if (name === 'tools/pre-execute') preExecute += 1;
    return () => {};
  },
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
    guard: () => () => {},
  },
  skills: { register: () => () => {} },
};
apply(ctx);

assert.deepEqual(tools.map((t) => t.name).sort(), ['firmware_find', 'firmware_mcu', 'firmware_models']);
console.log('ok  只注册 3 个固件工具（find / models / mcu）');

assert.deepEqual(commands.map((c) => c.name), ['firmware']);
console.log('ok  注册 /firmware 命令入口');

const findTool = tools.find((t) => t.name === 'firmware_find');
assert.ok(findTool.description.includes('同一份存储'), '工具描述也要写清 next 与 alist 内容同步');
assert.ok(findTool.description.includes('不要说成「alist 未收录」'), '工具描述应禁止把 next 链接读成 alist 缺版本');

assert.equal(preExecute, 0, '不应再注册 tools/pre-execute 闸门');
console.log('ok  没有 tools/pre-execute 闸门');

for (const tool of tools) assert.equal(typeof tool.__when, 'function', `${tool.name} 缺 skill 激活门`);
assert.equal(await tools[0].__when({ agent: { session: undefined } }), false, '未加载 skill 时不可见');
process.env.CP_TOOLS_SKILL_GATE = 'off';
try {
  assert.equal(await tools[0].__when({ agent: { session: undefined } }), true, '急停开关应恒可见');
} finally {
  delete process.env.CP_TOOLS_SKILL_GATE;
}
console.log('ok  3 个固件工具都带 skill 激活门（可用 CP_TOOLS_SKILL_GATE=off 急停）');

// 命令 handler：注入 skill 正文 + 用户请求，并激活本步可见。
const messages = [];
const agent = { session: undefined, followup: (message) => messages.push(message) };
const result = await commands[0].handler({ agent, rawInput: 'models', signal: new AbortController().signal });
assert.equal(result.kind, 'success');
assert.equal(messages.length, 1);
assert.equal(messages[0].source.kind, 'cp-tools-entry');
assert.ok(messages[0].content[0].text.includes('# 固件查找'), '命令应把 skill 正文注入');
assert.ok(messages[0].content[0].text.includes('用户请求：models'));
assert.equal(await tools[0].__when({ agent }), true, '命令进入后本步即可见');
console.log('ok  /firmware 注入正文并在本步点亮工具');

for (const tool of tools) {
  assert.ok(!tool.description.includes('仅当用户输入'), `${tool.name} 描述仍在限制 /firmware`);
  assert.equal(tool.parameters.type, 'object');
  assert.ok(tool.output?.schema, `${tool.name} 缺 output.schema`);
  assert.equal(typeof tool.output.render, 'function', `${tool.name} 缺 output.render`);
}
console.log('ok  工具描述不再要求 /firmware，schema/render 完整');

console.log('\n全部通过');
