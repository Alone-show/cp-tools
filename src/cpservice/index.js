import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';

/**
 * E9631Service / CpService — U 盘升级包（E9631Service.xml / CpService.xml）生成与验证。
 * 运行时 skill 名 = `cpservice`（调用命令 `/cpservice`），正文在 skills/cpservice/SKILL.md。
 *
 * 插件本身不带工具，只往 `ctx.skills` 注册一个运行时 skill；
 * skill 正文在 `skills/cpservice/SKILL.md`，附件在 `skills/cpservice/assets/`（resourceBase 指向 skill 目录）。
 */

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.join(PLUGIN_DIR, 'skills', 'cpservice', 'SKILL.md');

/**
 * 读取并解析插件自带的 SKILL.md。
 *
 * 运行时注册（`ctx.skills.register`）不会自己读 frontmatter，
 * 所以这里解析后显式放进 `invocation`，否则模型侧目录不会出现这个 skill。
 */
export function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

export const name = 'e9631service';
export const inject = ['skills'];

export function apply(ctx) {
  const skill = readBundledSkill();
  const register = () => ctx.skills.register(skill);
  if (typeof ctx.effect === 'function') ctx.effect(register);
  else register();
}

/** 供离线冒烟测试使用。 */
export const __internals = { PLUGIN_DIR, SKILL_FILE, readBundledSkill };
