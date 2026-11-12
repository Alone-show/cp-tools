/**
 * @local/cp-tools/tickets —— 工单现象与历史 bug 查验。
 *
 * 两条能力线：
 *   1) ticket_search：在 TB「【研发部】CI/CD 发版流程」看板里按现象找工单/任务号/子任务状态；
 *   2) ticket_bug_*：在 alist /PROD 的 commit-logs 里判断 bug 是否修进客户正式版。
 *
 * 与 firmware 共用同一份 TB 数据（.tbfw）与登录凭据；本插件是唯一写方。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkToken, ensureToken, loginWithCookie } from '../tb/login.js';
import { candidateDirs, tokenDir, readCookie, liveAuth } from '../tb/auth.js';
import { readBoardFromDirs, readSubtasks, syncBoard } from '../tb/board.js';
import { createTbClient, findLiveRecords } from '../tb/live.js';
import { modelGroups, resolveModel, variantList, modelVariants, hitModel, hitSystem } from '../tb/models.js';
import { PROJECT_ID, asList } from '../tb/constants.js';
import { matchScore, taskMatches, expandSymptom } from './lib/symptoms.js';
import { buildIssueRows, renderIssues, isVersionTask, searchBoardTasks } from './lib/issues.js';
import { fixToolDefinitions } from './lib/bug/tools.js';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.join(PLUGIN_DIR, 'skills', 'tickets', 'SKILL.md');

/** 可替换的 fetch（离线测试用；运行时就是全局 fetch）。 */
let fetchImpl = (...args) => globalThis.fetch(...args);

function ageHoursOf(iso) {
  const ts = Date.parse(iso ?? '');
  return Number.isFinite(ts) ? (Date.now() - ts) / 3_600_000 : null;
}

/** 本地 TB 索引是否可用（board format 2 + subtasks 文件） */
async function issueIndexState(ctx, exec) {
  const dirs = await candidateDirs(ctx, exec);
  const board = await readBoardFromDirs(dirs);
  if (!board) return { ok: false, reason: 'no-board', dir: dirs[0] };
  const dir = dirs.find((d) => fs.existsSync(path.join(d, `board-${PROJECT_ID}.json`))) ?? dirs[0];
  if (board?.format !== 2) return { ok: false, reason: 'old-board', dir, board };
  const subtasks = readSubtasks(dir, PROJECT_ID);
  if (!subtasks) return { ok: false, reason: 'no-subtasks', dir, board };
  return { ok: true, dir, board, subtasks };
}

/* ------------------------------------------------------------------ *
 * issues 口径（版本任务下的子任务）
 * ------------------------------------------------------------------ */

async function issuesFromIndex(ctx, exec, args) {
  const state = await issueIndexState(ctx, exec);
  if (!state.ok) {
    return {
      status: 'needs_sync',
      hint:
        state.reason === 'no-subtasks'
          ? '本地看板有任务但没有子任务索引。先 /tickets sync（会同时抓子任务）。'
          : '本地 TB 索引缺失或还是旧格式。先 /tickets sync；只想快速看结果可以不 sync，改用实时搜索。',
      dataDir: state.dir,
    };
  }
  const { board, subtasks } = state;
  const model = String(args.model ?? '').trim();
  const query = String(args.query ?? '').trim();
  if (!model && !query) {
    return { status: 'needs_model', hint: '请给机型（如 spring2pro），或给一个现象关键词。' };
  }

  let needles = null;
  let resolvedModel = '';
  let variant = null;
  let candidates = [];
  if (model) {
    const groups = modelGroups(board);
    const resolved = resolveModel(model, groups);
    if (!resolved.hit) {
      return {
        status: 'needs_confirmation',
        query: model,
        note: '机型无法唯一确定，请让用户在候选里选一个，不要自行猜测',
        candidates: resolved.scored.slice(0, 8).map(([score, group]) => ({
          model: group.name,
          score,
          tasks: group.count,
          aliases: group.aliases,
          variants: variantList(group),
        })),
        rows: [],
        resolvedModel: model,
      };
    }
    resolvedModel = resolved.hit.name;
    variant = resolved.variant ?? null;
    const families = variant ? [resolved.hit.name] : resolved.hits?.length ? resolved.hits.map((g) => g.name) : [resolved.hit.name];
    needles = variant ? [variant.core] : [...new Set(families.flatMap((name) => modelVariants(name)))];
    candidates = resolved.scored ?? [];
  }

  let parents = board.items.filter((task) => isVersionTask(task));
  if (needles) parents = parents.filter((task) => hitModel(task, needles));
  if (args.system) parents = parents.filter((task) => hitSystem(task, args.system, args.mainline));
  if (args.stage) parents = parents.filter((task) => String(task.stage ?? '').includes(String(args.stage)));

  const pool = new Map();
  for (const task of parents) {
    for (const c of asList(task.fields?.['客户ID'])) {
      const key = String(c);
      pool.set(key, (pool.get(key) ?? 0) + 1);
    }
  }
  const requested = String(args.customer ?? '').trim();
  const customerDefaulted = !requested;
  const effective = customerDefaulted ? 'CP' : requested;
  const unlimited = /^(all|\*|不限)$/i.test(effective);
  const otherCustomers = [...pool.entries()]
    .filter(([c]) => !unlimited && !c.toUpperCase().includes(effective.toUpperCase()))
    .map(([c, count]) => ({ customer: c, count }))
    .sort((a, b) => b.count - a.count);
  const selected = unlimited
    ? parents
    : parents.filter((task) =>
        String(task.fields?.['客户ID'] ?? '')
          .toUpperCase()
          .includes(effective.toUpperCase()),
      );

  const records = [];
  for (const parent of selected) {
    for (const subtask of subtasks.byParent?.[parent.id] ?? []) records.push({ subtask, parent });
  }

  const result = buildIssueRows({
    records,
    customer: effective,
    customerDefaulted,
    otherCustomers,
    status: args.status ?? 'all',
    query,
    limit: Math.max(1, Math.min(20, Number(args.limit) || 5)),
    subtaskLimit: Math.max(1, Math.min(50, Number(args.subtaskLimit) || 30)),
    syncedAt: subtasks.syncedAt,
    ageHours: ageHoursOf(subtasks.syncedAt),
    source: 'index',
  });
  result.mode = 'issues';
  result.resolvedModel = resolvedModel || model;
  result.query = query;
  result.system = args.system ?? '';
  result.candidates = candidates;
  result.notes = [
    ...(result.notes ?? []),
    `数据来自本地 TB 索引（${subtasks.syncedAt || '未知时间'}），要最新状态请 /tickets sync 或改用 source=live。`,
  ];
  return result;
}

async function issuesFromLive(ctx, exec, args) {
  const auth = await liveAuth(ctx, exec);
  if (!auth.ok) {
    return {
      status: 'needs_auth',
      hint: 'Teambition 登录态不可用，先 /tickets login；或 /tickets sync 建全量索引后离线查。',
    };
  }
  const client = createTbClient({ cookie: auth.cookie, fetchImpl });
  let found;
  try {
    found = await findLiveRecords({
      client,
      projectId: PROJECT_ID,
      model: args.model ?? '',
      query: args.query ?? '',
      system: args.system ?? '',
      customer: args.customer ?? 'CP',
      pages: Math.max(1, Math.min(10, Number(args.pages) || 3)),
      maxHits: 60,
      maxParents: Math.max(1, Math.min(50, Number(args.limit) || 5) * 6),
    });
  } catch (error) {
    if (/登录态失效|401|InvalidAccessToken/i.test(String(error?.message))) {
      return { status: 'needs_auth', hint: 'Teambition 登录态失效，请 /tickets login；或先 /tickets sync 建全量索引。' };
    }
    throw error;
  }
  const result = buildIssueRows({
    records: found.records,
    customer: found.customer,
    customerDefaulted: found.customerDefaulted,
    otherCustomers: found.otherCustomers,
    status: args.status ?? 'all',
    query: args.query ?? '',
    limit: Math.max(1, Math.min(20, Number(args.limit) || 5)),
    subtaskLimit: Math.max(1, Math.min(50, Number(args.subtaskLimit) || 30)),
    syncedAt: new Date().toISOString(),
    ageHours: 0,
    source: 'live',
  });
  result.mode = 'issues';
  result.resolvedModel = args.model ?? '';
  result.query = args.query ?? '';
  result.system = args.system ?? '';
  result.searches = found.queries;
  result.notes = [
    ...(result.notes ?? []),
    '实时搜索结果只覆盖 TB 搜索接口命中的任务（单页 10 条）；要完整历史/全量状态请 /tickets sync 后加 source=index。',
  ];
  return result;
}

/* ------------------------------------------------------------------ *
 * tasks 口径（任意工单，含无子任务 / 无客户字段）
 * ------------------------------------------------------------------ */

function taskRowFromLive(task) {
  const isVersion = isVersionTask(task);
  return {
    kind: 'task',
    id: task.id,
    taskNo: task.uniqueId ?? null,
    title: String(task.title ?? ''),
    stage: String(task.stage ?? ''),
    isDone: task.isDone === true,
    isArchived: task.isArchived === true,
    created: task.created ?? '',
    accomplished: task.accomplished ?? '',
    updated: task.updated ?? '',
    executor: task.executor ?? '',
    url: task.url ?? '',
    outcome: task.isDone === true ? 'solved' : 'pending',
    score: 0,
    hits: [],
    parentVersion: isVersion ? '' : task.parentVersion || '',
    parentTask: task.parentTask ?? null,
  };
}

async function tasksFromLive(ctx, exec, args) {
  const auth = await liveAuth(ctx, exec);
  if (!auth.ok) {
    return { status: 'needs_auth', mode: 'tasks', hint: 'Teambition 登录态不可用，先 /tickets login；或 /tickets sync 后加 source=index。' };
  }
  const client = createTbClient({ cookie: auth.cookie, fetchImpl });
  const query = String(args.query ?? '').trim();
  let found;
  try {
    found = await findLiveRecords({
      client,
      projectId: PROJECT_ID,
      model: args.model ?? '',
      query,
      system: args.system ?? '',
      customer: args.customer ?? '',
      pages: Math.max(1, Math.min(10, Number(args.pages) || 3)),
      maxHits: 120,
      includeTasks: true,
      extraQueries: expandSymptom(query),
    });
  } catch (error) {
    if (/登录态失效|401|InvalidAccessToken/i.test(String(error?.message))) {
      return { status: 'needs_auth', mode: 'tasks', hint: 'Teambition 登录态失效，请 /tickets login；或先 /tickets sync。' };
    }
    throw error;
  }

  const wanted = String(args.status ?? 'all').toLowerCase();
  const stage = String(args.stage ?? '').trim();
  const scored = [];
  const low = [];
  for (const task of found.tasks ?? []) {
    const hay = `${task.title ?? ''} ${task.note ?? ''} ${Object.values(task.fields ?? {}).flat().join(' ')}`;
    const match = matchScore(query, hay);
    if (!taskMatches(match)) {
      low.push({ ...task, score: match.score, hits: match.hits });
      continue;
    }
    scored.push({ task, score: match.score, hits: match.hits, concepts: match.concepts?.length ?? 0 });
  }
  scored.sort(
    (a, b) => b.score - a.score || b.concepts - a.concepts || String(b.task.updated).localeCompare(String(a.task.updated)),
  );
  const picked = scored.slice(0, Math.max(1, Math.min(20, Number(args.limit) || 10)));
  const tasks = picked.map(({ task, score, hits, concepts }) => ({
    ...taskRowFromLive(task),
    score,
    hits,
    concepts,
    ...(stage && !String(task.stage ?? '').includes(stage) ? { hidden: true } : {}),
  }));
  const visible = tasks.filter((task) => !task.hidden);
  const filtered = visible.filter((task) => {
    if (wanted === 'all' || !wanted) return true;
    if (wanted === 'open') return task.isDone !== true;
    if (wanted === 'done') return task.isDone === true;
    if (wanted === 'rejected') return task.outcome === 'rejected';
    return true;
  });

  if (!filtered.length) {
    low.sort((a, b) => b.score - a.score);
    return {
      status: 'empty',
      mode: 'tasks',
      query,
      summary: { tasks: 0, open: 0, done: 0, rejected: 0 },
      tasks: [],
      lowConfidence: low.slice(0, 3).map((item) => ({ title: item.title, score: item.score, hits: item.hits, parentVersion: item.parentVersion || '' })),
      searches: found.queries,
      notes: ['没有达到阈值的工单；可换更具体的现象词，或 /tickets sync 后用 source=index 查全量历史。'],
    };
  }

  return {
    status: 'ok',
    mode: 'tasks',
    source: 'live',
    query,
    summary: {
      tasks: filtered.length,
      open: filtered.filter((t) => t.outcome === 'pending' || t.outcome === 'suspended').length,
      done: filtered.filter((t) => t.outcome === 'solved').length,
      rejected: filtered.filter((t) => t.outcome === 'rejected').length,
    },
    tasks: filtered,
    lowConfidence: [],
    searches: found.queries,
    notes: ['实时搜索只覆盖 TB 搜索接口命中的任务；要完整历史用 source=index（先 /tickets sync）。'],
  };
}

async function tasksFromIndex(ctx, exec, args) {
  const state = await issueIndexState(ctx, exec);
  if (!state.ok) {
    return {
      status: 'needs_sync',
      mode: 'tasks',
      hint: '本地 TB 索引缺失。先 /tickets sync（约 60–90 秒），或改用 source=live。',
      dataDir: state.dir,
    };
  }
  const result = searchTasksFromBoard(state.board, state.subtasks, args);
  result.syncedAt = state.subtasks.syncedAt;
  result.ageHours = ageHoursOf(state.subtasks.syncedAt);
  result.notes = [
    ...(result.notes ?? []),
    `数据来自本地 TB 索引（${state.subtasks.syncedAt || '未知时间'}），要最新状态请 /tickets sync 或改用 source=live。`,
  ];
  return result;
}

function searchTasksFromBoard(board, subtasks, args) {
  const query = String(args.query ?? '').trim();
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 10));
  const status = String(args.status ?? 'all');
  const model = String(args.model ?? '').trim();
  const system = String(args.system ?? '').trim();
  const stage = String(args.stage ?? '').trim();
  return searchBoardTasks(board, subtasks, { query, limit, status, model, system, stage });
}

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function ticketSearchToolFor(ctx) {
  return {
    name: 'ticket_search',
    description:
      '按现象/关键词查 TB「【研发部】CI/CD 发版流程」看板里的工单：返回 TB 任务号（#uniqueId）、标题、阶段/状态、创建与完成日期、执行人、链接，以及所属版本；scope=tasks 时覆盖全部任务（含无子任务、无客户字段、已归档的 ITR/缺陷单），scope=issues 时按版本任务下的子任务统计已解决/待解决/暂挂起/已拒绝。默认走实时 TB 搜索，不需要 sync；要完整历史时传 source=index（需先 ticket_sync）。它是业务记录，不等于代码已修复；代码层结论用 ticket_bug_check。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '现象关键词，如「单卡 出现两个卡 上不去网」「摄像头断层」' },
        scope: { type: 'string', enum: ['auto', 'tasks', 'issues'], description: 'auto=有 model 查版本子任务、只有 query 查全部工单（默认）；tasks=全部工单；issues=版本子任务' },
        model: { type: 'string', description: '机型，如 spring2pro、SP2-10PRO；tasks 模式下可选' },
        system: { type: 'string', description: '操作系统：Android / Debian / BuildRoot；linux 表示 Debian+BuildRoot' },
        customer: { type: 'string', description: '客户ID，默认 CP（仅 issues 口径）；传 * 表示不限客户' },
        status: { type: 'string', enum: ['all', 'open', 'done', 'rejected'], description: '状态过滤：all（默认）/open 待解决/done 已解决/rejected 已拒绝' },
        stage: { type: 'string', description: '父版本任务阶段过滤，如 生产库归档' },
        limit: { type: 'integer', description: '返回条数：tasks 默认 10，issues 默认 5，最大 20' },
        subtaskLimit: { type: 'integer', description: 'issues 模式下每个版本最多返回多少子任务，默认 30' },
        source: { type: 'string', enum: ['auto', 'live', 'index'], description: 'auto=有本地索引用索引，否则实时搜索（默认）；live=强制实时；index=只用本地全量索引（需 /tickets sync）' },
        pages: { type: 'integer', description: '实时搜索翻页数，默认 3（每页 10 条），最大 10' },
        full: { type: 'boolean', description: '等价 source=index：要全量历史时用' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'empty', 'needs_confirmation', 'needs_model', 'needs_setup', 'needs_sync', 'needs_auth', 'error'] },
          mode: { type: 'string' },
          source: { type: 'string' },
          query: { type: 'string' },
          resolvedModel: { type: 'string' },
          customer: { type: 'string' },
          customerDefaulted: { type: 'boolean' },
          otherCustomers: { type: 'array', items: { type: 'object' } },
          summary: { type: 'object' },
          rows: { type: 'array', items: { type: 'object' } },
          tasks: { type: 'array', items: { type: 'object' } },
          candidates: { type: 'array', items: { type: 'object' } },
          lowConfidence: { type: 'array', items: { type: 'object' } },
          searches: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
          syncedAt: { type: 'string' },
          ageHours: { type: 'number' },
          hint: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['status'],
        additionalProperties: true,
      },
      render: (_args, value) => [{ type: 'text', text: renderIssues(value) }],
    },
    async execute(args, exec) {
      try {
        const scope = String(args.scope ?? 'auto').toLowerCase();
        const query = String(args.query ?? '').trim();
        const hasModel = String(args.model ?? '').trim() !== '';
        const effectiveScope = scope === 'tasks' || scope === 'issues' ? scope : hasModel ? 'issues' : 'tasks';
        const source = String(args.source ?? 'auto').toLowerCase();
        const useIndex = source === 'index' || args.full === true;

        if (effectiveScope === 'tasks') {
          if (useIndex) return jsonSafe(await tasksFromIndex(ctx, exec, args));
          try {
            const live = await tasksFromLive(ctx, exec, args);
            if (live.status !== 'needs_auth' || source === 'live') return jsonSafe(live);
            const state = await issueIndexState(ctx, exec);
            if (!state.ok) return jsonSafe(live);
            const fallback = await tasksFromIndex(ctx, exec, args);
            fallback.notes = [...(fallback.notes ?? []), '实时检索需要登录，已回退本地索引（可能不是最新阶段）。'];
            return jsonSafe(fallback);
          } catch (error) {
            const state = await issueIndexState(ctx, exec);
            if (!state.ok) {
              return { status: 'needs_sync', mode: 'tasks', hint: `实时检索失败（${error?.message || error}）。可以先 /tickets sync 建全量索引。` };
            }
            const fallback = await tasksFromIndex(ctx, exec, args);
            fallback.notes = [...(fallback.notes ?? []), `实时检索失败（${error?.message || error}），已回退本地索引（可能不是最新阶段）。`];
            return jsonSafe(fallback);
          }
        }

        if (source === 'index' || args.full) return jsonSafe(await issuesFromIndex(ctx, exec, args));
        try {
          return jsonSafe(await issuesFromLive(ctx, exec, args));
        } catch (error) {
          const state = await issueIndexState(ctx, exec);
          if (!state.ok) {
            return { status: 'needs_sync', hint: `实时检索失败（${error?.message || error}）。可以先 /tickets sync 建全量索引。` };
          }
          const fallback = await issuesFromIndex(ctx, exec, args);
          fallback.notes = [...(fallback.notes ?? []), `实时检索失败（${error?.message || error}），已回退本地索引（可能不是最新阶段）。`];
          return jsonSafe(fallback);
        }
      } catch (err) {
        return { status: 'error', message: err?.message || String(err) };
      }
    },
  };
}

function ticketSyncToolFor(ctx) {
  return {
    name: 'ticket_sync',
    description:
      '从 Teambition 重新拉取「【研发部】CI/CD 发版流程」看板的全部任务、归档字段和子任务，重建本地全量索引（约 8760 个任务 + 3260 个子任务，耗时 60–90 秒）。索引过期、要看完整历史或实时搜索不够用时使用。传 issues:false 只同步任务（约 40 秒）。登录凭据缺失或即将过期时会自动处理：先尝试静默刷新，再弹出浏览器登录；失败时返回 needs_auth 并说明原因。',
    parameters: {
      type: 'object',
      properties: {
        issues: { type: 'boolean', description: '是否同时抓子任务，默认 true；false 时只同步看板任务' },
        force: { type: 'boolean', description: 'true 时忽略增量判断，强制重抓全部子任务' },
      },
    },
    output: {
      schema: { type: 'object', properties: { status: { type: 'string' }, message: { type: 'string' } }, required: ['status'], additionalProperties: true },
      render: (_a, v) => [
        {
          type: 'text',
          text:
            v.status === 'needs_auth'
              ? `需要登录 Teambition（${v.reason ?? '自动登录未完成'}）。先 /tickets login，再重试同步。`
              : v.status === 'ok'
                ? `TB 同步完成：${v.tasks ?? 0} 个任务${v.subtasks ? `、${v.subtasks.items ?? 0} 个子任务（抓取 ${v.subtasks.fetched ?? 0} / 跳过 ${v.subtasks.skipped ?? 0} / 失败 ${v.subtasks.failed ?? 0}）` : '（未同步子任务）'} -> ${v.file ?? v.dir ?? ''}`
                : `ticket_sync：${v.message ?? v.hint ?? v.status}`,
        },
      ],
    },
    async execute(args, exec) {
      const options = { issues: args.issues !== false, force: args.force === true };
      const dir = await tokenDir(ctx, exec);
      const state = checkToken(dir);
      let auth = 'cached';

      if (state.state === 'missing') {
        if (process.env.TBFW_AUTO_LOGIN === '0') {
          return jsonSafe({
            status: 'needs_auth',
            tokenState: state.state,
            reason: '自动登录已关闭（TBFW_AUTO_LOGIN=0）',
            hint: '把 cookie 粘给 ticket_login(cookie="...")',
          });
        }
        const login = await ensureToken(dir, { mode: process.env.TBFW_HEADLESS === '1' ? 'headless' : 'auto' });
        if (login.status !== 'ok') {
          return jsonSafe({
            status: 'needs_auth',
            tokenState: state.state,
            reason: login.reason ?? login.status,
            loginUrl: login.loginUrl,
            browser: login.browser,
            hint: login.hint,
          });
        }
        auth = login.via === 'silent' ? 'silent' : 'window';
      }

      try {
        const cookie = readCookie(path.join(dir, 'token.json'));
        if (!cookie) throw new Error('token.json 里没有 teambition cookie，请 /tickets login');
        const headers = { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
        const result = await syncBoard({ dir, headers, fetchImpl, ...options });
        return jsonSafe({ status: 'ok', ...result, auth, tokenState: state.state });
      } catch (error) {
        const message = error?.message || String(error);
        if (!/登录态失效|401|InvalidAccessToken/i.test(message)) return { status: 'error', message };
        const login = await ensureToken(dir, { mode: 'auto' });
        if (login.status !== 'ok') {
          return jsonSafe({ status: 'needs_auth', tokenState: 'rejected', reason: login.reason ?? login.status, hint: login.hint });
        }
        const cookie = readCookie(path.join(dir, 'token.json'));
        const headers = { Cookie: cookie, 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
        const result = await syncBoard({ dir, headers, fetchImpl, ...options });
        return jsonSafe({ status: 'ok', ...result, auth: login.via ?? 'window', tokenState: 'rejected' });
      }
    },
  };
}

function ticketLoginToolFor(ctx) {
  return {
    name: 'ticket_login',
    description:
      '获取或刷新 Teambition 登录凭据（firmware 与 tickets 共用同一份 token）。默认自动：先用持久化的浏览器 profile 静默换发 token（用户无感），失败则弹出浏览器窗口让用户登录。也可以直接粘贴 cookie 或 DevTools 的「Copy as cURL」整段。凭据缺失、过期，或 ticket_sync 返回 needs_auth 时调用。',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['auto', 'headless', 'window'], description: 'auto=先静默刷新再弹窗（默认）；headless=只试静默刷新；window=直接弹窗' },
        cookie: { type: 'string', description: '可选。粘贴完整 Cookie 串、单个 TB_ACCESS_TOKEN，或 DevTools 里 Network → 右键「Copy as cURL」的整段命令' },
        timeoutSeconds: { type: 'integer', description: '等待用户完成登录的秒数，默认 180' },
        browser: { type: 'string', description: '可选，指定浏览器路径或命令名（默认用系统默认的 Chromium 系浏览器）' },
      },
    },
    output: {
      schema: { type: 'object', properties: { status: { type: 'string' }, message: { type: 'string' } }, required: ['status'], additionalProperties: true },
      render: (_a, v) => [
        { type: 'text', text: v.status === 'ok' ? `TB 登录凭据已更新（${v.via ?? v.status}）` : `ticket_login：${v.status}${v.reason ? `（${v.reason}）` : ''}${v.hint ? ` — ${v.hint}` : ''}` },
      ],
    },
    async execute(args) {
      const dir = await tokenDir(ctx, undefined);
      if (args.cookie) return jsonSafe(loginWithCookie(dir, args.cookie));
      if (process.env.TBFW_NO_DISPLAY === '1') {
        return jsonSafe({ status: 'no_display', reason: '测试钩子 TBFW_NO_DISPLAY=1', hint: '把 cookie 粘给 ticket_login(cookie="...")' });
      }
      return jsonSafe(
        await ensureToken(dir, {
          mode: args.mode ?? 'auto',
          timeoutSeconds: Number(args.timeoutSeconds) || 180,
          browser: args.browser,
        }),
      );
    },
  };
}

function jsonSafe(value) {
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * fix_check 的 TB 证据
 * ------------------------------------------------------------------ */

async function buildTbEvidence(ctx, { args = {}, result = {}, exec } = {}) {
  const model = result.resolvedModel || args.model || '';
  const query = args.bug || args.ticket || '';
  const customer = args.customer || 'CP';
  const system = args.os || '';
  let issues = null;
  try {
    const state = await issueIndexState(ctx, exec);
    if (state.ok) {
      const local = await issuesFromIndex(ctx, exec, {
        model,
        query,
        customer,
        system,
        status: 'all',
        limit: 5,
        subtaskLimit: 6,
        scope: 'issues',
      });
      if (local.status === 'ok' || local.status === 'empty') issues = local;
    }
  } catch {
    /* 继续尝试实时 */
  }
  if (!issues) {
    try {
      const live = await issuesFromLive(ctx, exec, {
        model,
        query,
        customer,
        system,
        status: 'all',
        limit: 5,
        subtaskLimit: 6,
        pages: 3,
      });
      if (live.status === 'ok' || live.status === 'empty') issues = live;
    } catch (error) {
      return { ok: false, reason: error?.message || String(error) };
    }
  }
  if (!issues) return { ok: false, reason: 'TB 索引缺失且实时检索不可用' };

  const flat = [];
  for (const row of issues.rows ?? []) {
    for (const item of row.subtasks ?? []) {
      flat.push({
        content: item.content,
        status: item.status,
        isDone: item.isDone,
        outcome: item.outcome,
        version: row.version,
        buildDate: row.buildDate,
        stage: row.stage,
        customer: row.customer,
        task: item.url,
        score: item.score,
      });
    }
  }
  const summary = issues.summary ?? { versions: 0, subtasks: 0, open: 0, done: 0, rejected: 0 };
  const notes = [];
  if (result.verdict === 'fixed_released' && (summary.open ?? 0) > 0) {
    notes.push('代码日志显示已进入客户正式版，但 TB 仍有待解决子任务：确认是否同一问题，或 TB 记录未关闭。');
  }
  if ((result.verdict === 'not_found' || result.verdict === 'fixed_other_line_only') && (summary.done ?? 0) > 0) {
    notes.push('TB 有已解决记录，但代码日志未在客户线命中：可能日志缺失/来自未公开分支，需研发复核。');
  }
  if ((summary.rejected ?? 0) > 0) notes.push('TB 里有已拒绝/不解决的记录，未计入已解决。');
  return {
    ok: true,
    source: issues.source,
    summary,
    issues: flat.slice(0, 5),
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * 注册
 * ------------------------------------------------------------------ */

function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

export const name = 'cp-tickets';
export const inject = ['tools', 'skills'];

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(ticketSearchToolFor(ctx)));
  ctx.effect(() => ctx.tools.register(ticketSyncToolFor(ctx)));
  ctx.effect(() => ctx.tools.register(ticketLoginToolFor(ctx)));
  for (const definition of fixToolDefinitions(ctx, { tbEvidence: (input) => buildTbEvidence(ctx, input) })) {
    ctx.effect(() => ctx.tools.register(definition));
  }
  try {
    const skill = readBundledSkill();
    ctx.effect(() => ctx.skills.register(skill));
  } catch (error) {
    const message = `[cp-tickets] 注册运行时 skill 失败：${error?.message || error}`;
    if (ctx.logger?.warn) ctx.logger.warn(message);
    else console.warn(message);
  }
}

export const __internals = {
  PLUGIN_DIR,
  SKILL_FILE,
  readBundledSkill,
  issueIndexState,
  issuesFromIndex,
  issuesFromLive,
  tasksFromIndex,
  tasksFromLive,
  buildTbEvidence,
  syncBoard,
  readSubtasks,
  buildIssueRows,
  isVersionTask,
  setFetch: (impl) => {
    fetchImpl = impl;
  },
};
