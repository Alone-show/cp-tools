import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ENTRY_COMMANDS } from '../../src/shared/entry.js';

const ROOT = path.resolve(import.meta.dirname, '../..');

const SKILLS = [
  ['cp-docs', 'src/docs/skills/cp-docs/SKILL.md'],
  ['firmware', 'src/firmware/skills/firmware/SKILL.md'],
  ['tickets', 'src/tickets/skills/tickets/SKILL.md'],
  ['cpservice', 'src/cpservice/skills/cpservice/SKILL.md'],
  ['flash', 'src/flash/skills/flash/SKILL.md'],
  ['bpms', 'src/bpms/skills/bpms/SKILL.md'],
];

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(match, `${file} 缺 frontmatter`);
  return match[1];
}

test('每个命令入口都有同名 skill，且 skill 不对用户暴露手势（避免双入口）', () => {
  for (const name of ENTRY_COMMANDS) {
    const hit = SKILLS.find(([skillName]) => skillName === name);
    assert.ok(hit, `/${name} 没有对应的 SKILL.md`);
    assert.match(frontmatter(path.join(ROOT, hit[1])), /^user-invocable:\s*false\s*$/m);
  }
});

test('cp-docs 也是真命令（不是手势）', () => {
  assert.ok(!ENTRY_COMMANDS.includes('cp-docs'), 'cp-docs 在 docs 插件里单独注册，不放进 ENTRY_COMMANDS');
  assert.match(frontmatter(path.join(ROOT, 'src/docs/skills/cp-docs/SKILL.md')), /^user-invocable:\s*false\s*$/m);
});

test('flash / cpservice 保持手势入口（没有工具，不需要命令点亮）', () => {
  for (const name of ['flash', 'cpservice']) {
    const [, file] = SKILLS.find(([skillName]) => skillName === name);
    assert.doesNotMatch(frontmatter(path.join(ROOT, file)), /^user-invocable:\s*false\s*$/m);
  }
});
