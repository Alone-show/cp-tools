import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBundledSkill } from '../../src/shared/skill.js';

function tmpSkill(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-skill-'));
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, body);
  return { dir, file };
}

test('readBundledSkill：解析 frontmatter 与 invocation', () => {
  const { dir, file } = tmpSkill(
    ['---', 'name: demo', 'description: 演示 skill', 'disable-model-invocation: true', 'user-invocable: false', '---', '', '# 正文', '内容'].join('\n'),
  );
  try {
    const skill = readBundledSkill(file);
    assert.equal(skill.name, 'demo');
    assert.equal(skill.description, '演示 skill');
    assert.equal(skill.source, 'runtime');
    assert.equal(skill.path, file);
    assert.equal(skill.resourceBase.path, dir);
    assert.equal(skill.invocation.modelInvocable, false);
    assert.equal(skill.invocation.userInvocable, false);
    assert.ok(skill.content.trimStart().startsWith('# 正文'));
    assert.ok(!skill.content.startsWith('---'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundledSkill：默认两侧都可调用', () => {
  const { dir, file } = tmpSkill('---\nname: demo\ndescription: 演示\n---\n正文\n');
  try {
    const skill = readBundledSkill(file);
    assert.equal(skill.invocation.modelInvocable, true);
    assert.equal(skill.invocation.userInvocable, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundledSkill：缺 name/description 直接报错', () => {
  const { dir, file } = tmpSkill('---\nname: demo\n---\n正文\n');
  try {
    assert.throws(() => readBundledSkill(file), /缺少 name\/description/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
