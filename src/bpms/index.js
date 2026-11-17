import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';
import { createSkillGate, withSkillScope } from '../shared/skill-gate.js';
import { registerEntryCommand } from '../shared/entry.js';
import { createWriteGuard, registerToolGuard } from '../shared/write-guard.js';
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
/** 工具描述前置的作用边界（模型可见）。 */
const BPMS_SCOPE = '【bpms 技能】只操作 CPSales 订单需求表：改字段前先用 bpms_fields 确认字段名，默认 dry-run；不负责刷机与出包。';

export function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

export const name = 'cp-bpms';
export const inject = ['tools', 'skills'];

export function apply(ctx) {
  // 先解析 skill：解析失败就让插件行显式失败，避免留下永远不可见的工具。
  const skill = readBundledSkill();
  // 工具只在加载过 bpms skill 之后才可见（见 shared/skill-gate.js）。
  const gate = createSkillGate(ctx, ['bpms']);
  const when = gate.when('bpms');
  for (const factory of TOOL_FACTORIES) {
    ctx.effect(() => ctx.tools.register(withSkillScope(factory(), BPMS_SCOPE), { when }));
  }
  // 写库/上传要求本会话经 /bpms 进入；dry-run（apply:false）仍允许模型自助预演。
  ctx.effect(() =>
    registerToolGuard(
      ctx,
      createWriteGuard(gate, [
        { tool: 'bpms_update', skill: 'bpms', command: 'bpms', when: (args) => args?.apply === true },
        { tool: 'bpms_upload', skill: 'bpms', command: 'bpms' },
      ]),
    ),
  );
  // 插件页「BPMS 配置」的读写接口：只在 Web 组合（Connection）下注册。
  if (typeof ctx.inject === 'function') {
    ctx.inject(['connection'], (child) => {
      if (typeof child?.connection?.fetch?.register !== 'function') return;
      child.effect(() => child.connection.fetch.register(createConfigRoute()), 'cp-bpms: Web 配置路由');
      child.effect(() => child.connection.fetch.register(createTestRoute()), 'cp-bpms: Web 试登录路由');
    });
  }
  ctx.effect(() => ctx.skills.register(skill));

  registerEntryCommand(ctx, {
    name: 'bpms',
    skill: 'bpms',
    definition: skill,
    description: 'BPMS（CPSales）订单需求：登录、按字段读写记录、上传附件（默认 dry-run）',
    hint: '登录 / 需求编号 / 要改的字段',
    defaultQuery: '先确认 BPMS 登录状态，然后等我给需求编号（CPS-SY…）和要改的字段。',
    gate,
  });
}

/** 供离线冒烟测试使用。 */
export const __internals = { PLUGIN_DIR, SKILL_FILE, readBundledSkill, TOOL_FACTORIES };
