import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';
import { TOOL_FACTORIES } from './tools.js';
import { createConfigRoute, createTestRoute } from './http.js';

/**
 * BPMS（CPSales）订单需求表 — 登录与编辑。
 *
 * 运行时命令 `/bpms`，正文在 skills/bpms/SKILL.md。
 * 负责登录、读记录、按字段改记录，以及备份与回滚。
 */

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.join(PLUGIN_DIR, 'skills', 'bpms', 'SKILL.md');

export function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

export const name = 'cp-bpms';
export const inject = ['tools', 'skills'];

export function apply(ctx) {
  for (const factory of TOOL_FACTORIES) {
    ctx.effect(() => ctx.tools.register(factory()));
  }
  // 插件页「BPMS 配置」的读写接口：只在 Web 组合（Connection）下注册。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (child) => {
      if (typeof child?.connection?.fetch?.register !== 'function') return;
      child.effect(() => child.connection.fetch.register(createConfigRoute()), 'cp-bpms: Web 配置路由');
      child.effect(() => child.connection.fetch.register(createTestRoute()), 'cp-bpms: Web 试登录路由');
    });
  }
  try {
    const skill = readBundledSkill();
    ctx.effect(() => ctx.skills.register(skill));
  } catch (error) {
    const message = `[cp-bpms] 注册运行时 skill 失败：${error?.message || error}`;
    if (ctx.logger?.warn) ctx.logger.warn(message);
    else console.warn(message);
  }
}

/** 供离线冒烟测试使用。 */
export const __internals = { PLUGIN_DIR, SKILL_FILE, readBundledSkill, TOOL_FACTORIES };
