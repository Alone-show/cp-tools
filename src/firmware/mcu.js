/**
 * MCU 版本检索（/firmware 的 firmware_mcu）。
 *
 * 为什么单独一个工具，而不是并进 firmware_find：
 *   - **两条版本线**。OS 镜像是 `CP_<机型>_<A|D|R>_V…_LCD…`，MCU 是 `<族>_MCU_APP_V…_<YYMMDD>_<HHMMSS>`，
 *     两者目录、命名、发布阶段都不同。
 *   - **目录写法不同**。OS 侧是 `/PROD/<芯片>/<系统>/<机型>`（`SP2-10PRO`），
 *     MCU 侧是 `/PROD/MCU/<机型>/<版本>`，而 `SPRING2-10PRO` 的 MCU 目录叫 `SPRING2-PRO`。
 *   - **同板多族**。`/PROD/MCU` 下并存 `SPRING2`、`SPRING2-PRO`、`APOLLO2`、`APOLLO2-PRO`、`APOLLO2-PLUS`、
 *     `TANK`、`TANK2`、`MEGA1`、`SPRING`、`SPRING-12`…，取「全板最新」必错，只能按族 + 变体（PRO/PLUS）匹配。
 *
 * 数据源：alist `/PROD/MCU/<机型>/`（版本目录即产物目录，权威）；TB 只用来补「阶段 / 完成日期 / 任务链接」。
 */

import path from 'node:path';
import { createAlist } from './alist.js';
import { readCookie, tokenDir } from '../tb/auth.js';
import { createTbClient, normalizeTask } from '../tb/live.js';
import { PROJECT_ID, asList } from '../tb/constants.js';

export const MCU_ROOT = '/PROD/MCU';

/** 机型族别名：OS 侧习惯写法 -> MCU 目录族名 */
const FAMILY_ALIASES = {
  SP2: 'SPRING2',
  SP2PRO: 'SPRING2',
  SPRING2PRO: 'SPRING2',
  SPRING2: 'SPRING2',
  SPRING: 'SPRING',
  APOLLO: 'APOLLO',
  APOLLO2: 'APOLLO2',
  TANK: 'TANK',
  TANK2: 'TANK2',
  MEGA1: 'MEGA1',
  V1200: 'V1200',
};

const VARIANT_SUFFIX = /(PRO|PLUS)$/;

/** `<族>_MCU_<APP|BOOT|BURN>_V1.0.7_260924_190041` */
const MCU_NAME_RE = /^([A-Z0-9][A-Z0-9-]*)_MCU_(APP|BOOT|BURN)_V(\d+)\.(\d+)\.(\d+)(?:_(\d{6})(?:_(\d{6}))?)?$/i;

/** 把任意机型写法拆成 {family, pro, plus, sizes}；认不出 family 时返回 family='' */
export function parseModelName(raw) {
  const text = String(raw ?? '')
    .toUpperCase()
    .replace(/^(RK|T3|SC60|QUALCOMM)\s*\/\s*/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
  const tokens = text.split(' ').filter(Boolean);
  if (!tokens.length) return { family: '', pro: false, plus: false, sizes: [] };

  const pro = tokens.some((t) => t === 'PRO' || t.endsWith('PRO'));
  const plus = tokens.some((t) => t === 'PLUS' || t.endsWith('PLUS'));
  // 尺寸只从「族名之后」的 token 里取：`SPRING2 10PRO` -> 10、`APOLLO2 12X` -> 12；族名里的 2 不算尺寸
  const sizes = tokens
    .slice(1)
    .map((t) => String(t).match(/^(\d{1,2})(?!\d)/)?.[1])
    .filter(Boolean)
    .map(Number);

  let head = tokens[0].replace(VARIANT_SUFFIX, '');
  // APOLLO2PLUS / SPRING2PRO 这种连写：族名已去掉变体后缀，本体仍带尾巴时再拆一层
  if (!FAMILY_ALIASES[head] && /^(APOLLO|SPRING|TANK)\d/.test(head)) {
    const m = head.match(/^([A-Z]+\d*)/);
    if (m) head = m[1];
  }
  const family = FAMILY_ALIASES[head] ?? head;
  return { family, pro, plus, sizes };
}

/**
 * 给一个机型找 MCU 目录的匹配度。
 * 族必须相同；PRO / PLUS 变体一致加分，不一致扣分（决定 `SPRING2-10PRO → SPRING2-PRO` 而不是 `SPRING2`）。
 */
export function scoreMcuDir(modelName, dirName) {
  const m = parseModelName(modelName);
  const d = parseModelName(dirName);
  if (!m.family || !d.family || m.family !== d.family) return 0;
  let score = 60;
  score += m.pro === d.pro ? 20 : -20;
  score += m.plus === d.plus ? 15 : -10;
  if (d.sizes.length && m.sizes.some((n) => d.sizes.includes(n))) score += 5;
  return score;
}

/** 按匹配度排序 MCU 目录；只返回 score > 0 的候选 */
export function rankMcuDirs(modelName, dirNames) {
  return (dirNames ?? [])
    .map((dir) => ({ dir, score: scoreMcuDir(modelName, dir) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.dir.localeCompare(b.dir));
}

/** `SPRING2PRO_MCU_APP_V1.0.7_260924_190041` -> {family, kind, version, buildDate, stamp, name} */
export function parseMcuName(name) {
  const m = String(name ?? '').trim().match(MCU_NAME_RE);
  if (!m) return null;
  const [, family, kind, major, minor, patch, ymd, hms] = m;
  const version = `V${major}.${minor}.${patch}`;
  const buildDate = ymd ? `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}` : '';
  return {
    name: String(name).trim(),
    family: family.toUpperCase(),
    kind: kind.toUpperCase(),
    version,
    buildDate,
    stamp: hms ?? '',
    sortKey: ymd ? Number(`20${ymd}${hms ?? '000000'}`) : 0,
  };
}

/** 目录项列表 -> 按构建日期倒序的版本行 */
export function versionsFromDirEntries(entries, { kind = 'APP', limit = 5 } = {}) {
  const wanted = String(kind || 'APP').toUpperCase();
  return (entries ?? [])
    .map((entry) => (typeof entry === 'string' ? { name: entry, isDir: true } : entry))
    .filter((entry) => entry.isDir !== false)
    .map((entry) => parseMcuName(entry.name))
    .filter((row) => row && row.kind === wanted)
    .sort((a, b) => b.sortKey - a.sortKey)
    .slice(0, Math.max(1, limit));
}

/** 从 TB 任务里读 MCU 版本行（只取父版本任务上的完整版本串） */
export function mcuRowsFromTasks(tasks) {
  const out = [];
  for (const task of tasks ?? []) {
    const fields = task?.fields ?? {};
    const candidates = [...asList(fields['固件版本']), task?.title].map((x) => String(x ?? ''));
    for (const text of candidates) {
      const hit = text.match(/([A-Z0-9-]+_MCU_(?:APP|BOOT|BURN)_V\d+\.\d+\.\d+(?:_\d{6}(?:_\d{6})?)?)/i);
      if (!hit) continue;
      const parsed = parseMcuName(hit[1]);
      if (!parsed) continue;
      out.push({
        ...parsed,
        stage: String(task.stage ?? ''),
        doneDate: String(task.accomplished ?? '').slice(0, 10),
        taskUrl: task.url ?? '',
        model: asList(fields['机型'])[0] ?? '',
        downloadUrl: asList(fields['固件下载地址'])[0] ?? '',
      });
      break;
    }
  }
  return out;
}

/**
 * TB 补充信息：按 `<家族前缀>_MCU_APP` 搜板子，把阶段 / 完成日期 / 任务链接贴到对应版本上。
 * 任何失败都返回空表（TB 只是补充，不能影响 alist 主路径）。
 */
async function tbEnrich({ ctx, exec, family, limit = 8 }) {
  const empty = { ok: false, rows: [], note: '' };
  try {
    const dir = await tokenDir(ctx, exec);
    const cookie = readCookie(path.join(dir, 'token.json'));
    if (!cookie) return { ...empty, note: 'TB 凭据里没有 teamboard cookie' };
    const client = createTbClient({ cookie });
    const query = `${family}_MCU_APP`;
    const hits = await client.search(PROJECT_ID, query, 2);
    if (!hits?.length) return { ...empty, note: `TB 搜索「${query}」没有命中` };
    const defs = await client.defs(PROJECT_ID);
    const normalized = hits.map((row) => normalizeTask(row, defs)).filter((t) => t.title.includes(query));
    const detailed = await Promise.all(
      normalized.slice(0, limit).map(async (task) => {
        try {
          return normalizeTask(await client.task(task.id), defs);
        } catch {
          return task;
        }
      }),
    );
    return { ok: true, rows: mcuRowsFromTasks(detailed), note: '' };
  } catch (error) {
    return { ...empty, note: `TB 补充失败：${error?.message ?? error}` };
  }
}

function text(r) {
  const lines = [];
  if (r.status === 'needs_confirmation') {
    lines.push(`机型「${r.model}」对不上 MCU 目录，请先选定：`);
    for (const row of r.dirCandidates ?? []) lines.push(`  · ${row.dir}（匹配度 ${row.score}）`);
    lines.push('选定后带精确 model 重试（如 firmware_mcu(model="SPRING2-10PRO")）。');
    return lines.join('\n');
  }
  if (r.status === 'empty') {
    lines.push(`没查到 ${r.model} 的 MCU 版本${r.dir ? `（目录 ${r.dir}）` : ''}。`);
    if (r.note) lines.push(r.note);
    if (r.dirCandidates?.length) {
      lines.push('相近目录：');
      for (const row of r.dirCandidates) lines.push(`  · ${row.dir}（匹配度 ${row.score}）`);
    }
    return lines.join('\n');
  }
  if (r.status !== 'ok') return `查询失败：${r.note || r.message || r.status}`;

  lines.push(`MCU 版本 · ${r.model} → ${r.dir}（共 ${r.versions.length} 条，最新在前）`);
  for (const v of r.versions) {
    const tb = [v.stage, v.doneDate].filter(Boolean).join(' / ');
    lines.push(`  · ${v.name}${v.buildDate ? `  构建 ${v.buildDate}` : ''}${tb ? `  [${tb}]` : ''}`);
    if (v.taskUrl) lines.push(`      任务: ${v.taskUrl}`);
    if (v.downloadUrl || v.dirUrl) lines.push(`      下载: ${v.downloadUrl || v.dirUrl}`);
  }
  if (!r.liveChecked) lines.push(`（TB 未核对：${r.note || '实时检索失败'}）`);
  return lines.join('\n');
}

export function mcuToolFor(ctx) {
  return {
    name: 'firmware_mcu',
    description:
      '查 CP 的 MCU 版本（与 OS 镜像两条线，不能用 firmware_find）：按机型映射到 alist /PROD/MCU/<机型>/ 目录，'
      + '列出 MCU APP（或 BOOT/BURN）版本，最新在前，并用 Teambition 补阶段、完成日期、任务链接与下载地址。'
      + '机型按「族 + PRO/PLUS 变体」匹配（SPRING2-10PRO 的 MCU 目录是 SPRING2-PRO，SPRING2 10 是 SPRING2），'
      + '不唯一或认不出时返回 status=needs_confirmation + dirCandidates，不猜；默认只列 APP 包。',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: '机型，自由写法：SP2-10PRO / SPRING2-10PRO / apollo 12 pro / TANK2 / SPRING-12 都能归一到 MCU 族',
        },
        kind: { type: 'string', enum: ['APP', 'BOOT', 'BURN'], description: '包类型，默认 APP' },
        limit: { type: 'integer', description: '返回条数上限，默认 5，最大 20' },
        stage: { type: 'string', description: '可选。按 TB 阶段过滤（如 生产库归档）；省略则不过滤，阶段只做展示' },
        tb: { type: 'boolean', description: '是否用 TB 补阶段/任务链接，默认 true；TB 不可用时只给 alist 结果' },
      },
      required: ['model'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'empty', 'needs_confirmation', 'error'] },
          model: { type: 'string' },
          dir: { type: 'string' },
          dirCandidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: { dir: { type: 'string' }, score: { type: 'integer' } },
            },
          },
          versions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                version: { type: 'string' },
                family: { type: 'string' },
                kind: { type: 'string' },
                buildDate: { type: 'string' },
                stage: { type: 'string' },
                doneDate: { type: 'string' },
                taskUrl: { type: 'string' },
                downloadUrl: { type: 'string' },
                dirUrl: { type: 'string' },
              },
            },
          },
          liveChecked: { type: 'boolean' },
          note: { type: 'string' },
          alist: { type: 'object' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: text(value) }],
    },
    async execute(args = {}, exec) {
      const model = String(args.model ?? '').trim();
      if (!model) return { status: 'error', note: '需要 model' };
      const kind = String(args.kind ?? 'APP').toUpperCase();
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20);
      const wantTb = args.tb !== false && process.env.DSH_TB_DISABLE !== '1';

      let alist = null;
      try {
        const dir = await tokenDir(ctx, exec);
        alist = createAlist({ cacheFile: path.join(dir, 'alist-cache.json'), ttlMs: 0 });
      } catch {
        alist = null;
      }
      if (!alist) return { status: 'error', model, note: 'alist 客户端创建失败' };

      const dirs = await alist.list(MCU_ROOT);
      if (!Array.isArray(dirs)) return { status: 'error', model, note: 'alist /PROD/MCU 不可达' };

      const ranked = rankMcuDirs(model, dirs.filter((d) => d.isDir).map((d) => d.name));
      if (!ranked.length) {
        return {
          status: 'needs_confirmation',
          model,
          dirCandidates: dirs.filter((d) => d.isDir).map((d) => ({ dir: d.name, score: 0 })),
          note: '这个机型对不上 /PROD/MCU 下任何族，请在上面目录里选一个',
        };
      }
      const best = ranked[0];
      const ambiguous = ranked.length > 1 && ranked[0].score - ranked[1].score < 10;
      if (best.score < 60 || ambiguous) {
        return {
          status: 'needs_confirmation',
          model,
          dirCandidates: ranked.slice(0, 5),
          note: '族名相同但变体（PRO/PLUS）分不清，或对不上任何目录',
        };
      }

      const dirPath = `${MCU_ROOT}/${best.dir}`;
      const entries = await alist.list(dirPath);
      const rows = versionsFromDirEntries(Array.isArray(entries) ? entries : [], { kind, limit });
      if (!rows.length) {
        return {
          status: 'empty',
          model,
          dir: best.dir,
          dirCandidates: ranked.slice(0, 5),
          note: Array.isArray(entries) ? `目录里没有 ${kind} 版本` : '目录不可读',
        };
      }

      let liveChecked = false;
      let note = '';
      if (wantTb) {
        const tb = await tbEnrich({ ctx, family: rows[0].family, limit: 8 });
        liveChecked = tb.ok;
        note = tb.note;
        if (tb.ok) {
          const byName = new Map(tb.rows.map((row) => [row.name, row]));
          // 父版本任务只有 `V1.0.6` 这种短版本串时，退一步按 族+kind+版本 匹配
          const byVersion = new Map();
          for (const row of tb.rows) {
            const key = `${row.family}|${row.kind}|${row.version}`;
            if (!byVersion.has(key)) byVersion.set(key, row);
          }
          for (const row of rows) {
            const hit = byName.get(row.name) ?? byVersion.get(`${row.family}|${row.kind}|${row.version}`);
            if (!hit) continue;
            row.stage = hit.stage;
            row.doneDate = hit.doneDate;
            row.taskUrl = hit.taskUrl;
            row.downloadUrl = hit.downloadUrl;
          }
        }
      }

      const stageFilter = String(args.stage ?? '').trim();
      const versions = (stageFilter ? rows.filter((row) => String(row.stage ?? '').includes(stageFilter)) : rows).map(
        (row) => ({
          name: row.name,
          version: row.version,
          family: row.family,
          kind: row.kind,
          buildDate: row.buildDate,
          stage: row.stage ?? '',
          doneDate: row.doneDate ?? '',
          taskUrl: row.taskUrl ?? '',
          downloadUrl: row.downloadUrl ?? '',
          dirUrl: alist.pageUrl?.(`${dirPath}/${row.name}`) ?? '',
        }),
      );

      return {
        status: versions.length ? 'ok' : 'empty',
        model,
        dir: best.dir,
        dirCandidates: ranked.slice(0, 5),
        versions,
        liveChecked,
        note: versions.length ? note : `阶段过滤「${stageFilter}」后没有版本`,
        alist: alist.stats ?? undefined,
      };
    },
  };
}

export const __internals = { parseModelName, scoreMcuDir, rankMcuDirs, parseMcuName, versionsFromDirEntries, mcuRowsFromTasks, MCU_NAME_RE };
