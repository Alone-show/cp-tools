// 离线冒烟：确认 /firmware 只负责固件查找，skill 与工具元信息正确。
import assert from 'node:assert/strict';
import path from 'node:path';
import { apply, __internals } from '../../src/firmware/index.js';

const { readBundledSkill, SKILL_FILE } = __internals;

const skill = readBundledSkill();
assert.equal(skill.name, 'firmware');
assert.equal(skill.invocation.modelInvocable, true, '模型目录里应能看到 firmware skill');
assert.equal(skill.invocation.userInvocable, true, '`/` 菜单里应能看到 firmware');
assert.equal(skill.source, 'runtime');
assert.equal(skill.path, SKILL_FILE);
assert.equal(skill.resourceBase.path, path.dirname(SKILL_FILE));
assert.ok(skill.content.trimStart().startsWith('# 固件查找'), 'frontmatter 不应进入正文');
assert.ok(skill.content.includes('/firmware'), '正文说明 /firmware 仍可作为显式入口');
assert.ok(!skill.content.includes('只能由用户显式输入'), '不应再强制斜杠');
assert.ok(skill.description.length > 0);
assert.ok(skill.description.includes('tickets'), 'firmware 描述应把工单/修复引导到 tickets');
console.log('ok  skill 只覆盖固件查找');

const tools = [];
let preExecute = 0;
const ctx = {
  get: () => undefined,
  effect: (fn) => {
    fn();
    return () => {};
  },
  on: () => {
    preExecute += 1;
    return () => {};
  },
  tools: {
    register(definition) {
      tools.push(definition);
      return () => {};
    },
  },
  skills: { register: () => () => {} },
};
apply(ctx);

assert.deepEqual(tools.map((t) => t.name).sort(), ['firmware_find', 'firmware_models']);
console.log('ok  只注册 2 个固件工具');

assert.equal(preExecute, 0, '不应再注册 tools/pre-execute 闸门');
console.log('ok  没有 tools/pre-execute 闸门');

for (const tool of tools) {
  assert.ok(!tool.description.includes('仅当用户输入'), `${tool.name} 描述仍在限制 /firmware`);
  assert.equal(tool.parameters.type, 'object');
  assert.ok(tool.output?.schema, `${tool.name} 缺 output.schema`);
  assert.equal(typeof tool.output.render, 'function', `${tool.name} 缺 output.render`);
}
console.log('ok  工具描述不再要求 /firmware，schema/render 完整');

console.log('\n全部通过');
