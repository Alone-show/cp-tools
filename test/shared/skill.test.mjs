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

test('readBundledSkill：块标量 description 必须报错，不能静默变成 ">"', () => {
  const { dir, file } = tmpSkill('---\nname: demo\ndescription: >\n  第一行\n  第二行\n---\n正文\n');
  try {
    assert.throws(() => readBundledSkill(file), /块标量/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundledSkill：未知 frontmatter 键必须报错', () => {
  const { dir, file } = tmpSkill('---\nname: demo\ndescription: ok\nunknownField: x\n---\n正文\n');
  try {
    assert.throws(() => readBundledSkill(file), /未支持的键 "unknownField"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundledSkill：非法布尔值必须报错，不能静默按默认值启用', () => {
  const { dir, file } = tmpSkill('---\nname: demo\ndescription: ok\ndisable-model-invocation: true # 注释\n---\n正文\n');
  try {
    assert.throws(() => readBundledSkill(file), /不是布尔值/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundledSkill：name 必须是 kebab-case', () => {
  const { dir, file } = tmpSkill('---\nname: Demo Skill\ndescription: ok\n---\n正文\n');
  try {
    assert.throws(() => readBundledSkill(file), /不是合法 skill 名/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('readBundledSkill：带引号的 description 去掉引号', () => {
  const { dir, file } = tmpSkill('---\nname: demo\ndescription: "含: 冒号 # 井号"\n---\n正文\n');
  try {
    assert.equal(readBundledSkill(file).description, '含: 冒号 # 井号');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
