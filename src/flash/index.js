import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';

/**
 * 整机线刷 — 用 assets/flash.sh 把整机镜像（RK `rk_upgrade_tool UF` / T3 `openixcli flash`）
 * 烧进设备，刷完只比版本号即判通过。
 *
 * 运行时 skill 名 = `flash`（调用命令 `/flash`），正文在 skills/flash/SKILL.md。
 * 与 `cpservice`（U 盘升级包）职责分离：这边只做整机覆盖烧写，会清数据。
 *
 * 插件本身不带工具，只往 `ctx.skills` 注册一个运行时 skill；
 * skill 正文在 `skills/flash/SKILL.md`，附件在 `skills/flash/assets/`（resourceBase 指向 skill 目录）。
 */

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.join(PLUGIN_DIR, 'skills', 'flash', 'SKILL.md');

/** 读取并解析插件自带的 SKILL.md（运行时注册不会自己读 frontmatter，必须显式放进 invocation）。 */
export function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

export const name = 'cp-flash';
export const inject = ['skills'];

export function apply(ctx) {
  const skill = readBundledSkill();
  const register = () => ctx.skills.register(skill);
  if (typeof ctx.effect === 'function') ctx.effect(register);
  else register();
}

/** 供离线冒烟测试使用。 */
export const __internals = { PLUGIN_DIR, SKILL_FILE, readBundledSkill };
