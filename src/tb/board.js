/**
 * 共享 TB 看板/子任务索引：读取、落盘、增量同步。
 *
 * 文件格式与文件名沿用 firmware 时代的约定（board-<projectId>.json /
 * subtasks-<projectId>.json），因此 tickets 同步后的缓存 firmware 可直接读。
 * 只有 tickets 子插件会调用 syncBoard / syncSubtasks；firmware 只调用 readBoard。
 */
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ID, UA } from './constants.js';
import { plainText } from './text.js';

export const BOARD_NAME = `board-${PROJECT_ID}.json`;
export const SUBTASKS_FORMAT = 1;

let boardCache = { file: null, mtimeMs: 0, board: null };

/** 读取看板索引；不存在时抛错（调用方决定降级策略）。 */
export async function readBoardFile(dir) {
  const file = path.join(dir, BOARD_NAME);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    throw new Error(`没有本地看板索引 ${file}。先运行 /tickets sync，或用环境变量 DSH_TBFW_DIR 指定 .tbfw 所在目录。`);
  }
  if (boardCache.file === file && boardCache.mtimeMs === st.mtimeMs && boardCache.board) return boardCache.board;
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  boardCache = { file, mtimeMs: st.mtimeMs, board };
  return board;
}

/** 在候选目录里找已有看板并读取；找不到返回 null。 */
export async function readBoardFromDirs(dirs) {
  const dir = dirs.find((d) => fs.existsSync(path.join(d, BOARD_NAME)));
  return dir ? readBoardFile(dir) : null;
}

export function clearBoardCache() {
  boardCache = { file: null, mtimeMs: 0, board: null };
}

async function fetchPaged(headers, baseUrl, fetchImpl = globalThis.fetch, maxPages = 300) {
  const out = [];
  let token = '';
  for (let i = 0; i < maxPages; i += 1) {
    const url = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}pageSize=200${
      token ? `&pageToken=${encodeURIComponent(token)}` : ''
    }`;
    const r = await fetchImpl(url, { headers });
    if (r.status === 401) throw new Error('Teambition 登录态失效，需要重新登录（ticket_login / /tickets 登录）');
    if (!r.ok) throw new Error(`${baseUrl} -> ${r.status}`);
    const j = await r.json();
    out.push(...(j.result ?? []));
    if (!j.nextPageToken) break;
    token = j.nextPageToken;
  }
  return out;
}

export function normalizeFields(cfs, defs) {
  const fields = {};
  for (const cf of cfs ?? []) {
    const def = defs[cf._customfieldId] ?? {};
    const name = def.name ?? cf._customfieldId;
    let val = cf.value;
    const scalar = (x) => (x && typeof x === 'object' ? (x.title ?? x.name ?? x) : x);
    if (['dropDown', 'multipleChoice', 'lookup', 'lookup2'].includes(cf.type)) {
      val = Array.isArray(val) ? val.map(scalar) : scalar(val);
    } else if (Array.isArray(val)) {
      val = val.map(scalar);
      if (val.length === 1) val = val[0];
    }
    val = Array.isArray(val) ? val.filter((x) => x !== '' && x != null) : val;
    if (val == null || val === '' || (Array.isArray(val) && val.length === 0)) continue;
    fields[name] = val;
  }
  return fields;
}

/**
 * 全量同步 TB 看板（可选同时抓子任务）。
 * @returns {{dir, file, tasks, subtasks}}
 */
export async function syncBoard({ dir, headers, fetchImpl = globalThis.fetch, issues = true, force = false } = {}) {
  const api = 'https://www.teambition.com/api';
  const defList = await fetchPaged(headers, `${api}/v2/projects/${PROJECT_ID}/customfields`, fetchImpl);
  const defs = Object.fromEntries(defList.map((d) => [d._id, d]));
  const tasks = await fetchPaged(headers, `${api}/v2/projects/${PROJECT_ID}/tasks`, fetchImpl);

  const items = tasks.map((t) => ({
    id: t._id,
    title: t.content,
    uniqueId: t.uniqueId,
    url: `https://www.teambition.com/task/${t._id}`,
    stage: t.taskflowstatus?.name ?? null,
    updated: t.updated,
    created: t.created ?? '',
    accomplished: t.accomplished ?? '',
    isDone: t.isDone === true,
    isArchived: t.isArchived,
    executor: t.executor?.name ?? '',
    subtaskCount: t.subtaskCount ?? { total: 0, done: 0 },
    fields: normalizeFields(t.customfields, defs),
  }));

  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, BOARD_NAME);
  fs.writeFileSync(
    out,
    JSON.stringify({
      format: 2,
      projectId: PROJECT_ID,
      syncedAt: new Date().toISOString(),
      fetched: items.length,
      items,
    }),
  );
  clearBoardCache();

  let subtasks = null;
  if (issues !== false) {
    try {
      subtasks = await syncSubtasks({
        dir,
        projectId: PROJECT_ID,
        tasks: items,
        headers,
        fetchImpl,
        force,
      });
    } catch (error) {
      subtasks = { ok: false, reason: error?.message || String(error) };
    }
  }

  return { dir, file: out, tasks: items.length, subtasks };
}

/* ------------------------------------------------------------------ *
 * 子任务
 * ------------------------------------------------------------------ */

function subtasksFile(dir, projectId) {
  return path.join(dir, `subtasks-${projectId}.json`);
}

let subtasksCache = { file: null, mtimeMs: 0, data: null };

export function readSubtasks(dir, projectId) {
  const file = subtasksFile(dir, projectId);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  if (subtasksCache.file === file && subtasksCache.mtimeMs === st.mtimeMs) return subtasksCache.data;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || data.format !== SUBTASKS_FORMAT || !data.byParent) return null;
    subtasksCache = { file, mtimeMs: st.mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

export function normalizeSubtask(raw, parentId) {
  if (!raw || !raw._id) return null;
  const status = raw.taskflowstatus?.name ?? '';
  return {
    id: raw._id,
    parentId,
    content: String(raw.content ?? '').trim(),
    note: plainText(raw.note ?? '', 2000),
    status,
    isDone: raw.isDone === true,
    created: raw.created ?? '',
    updated: raw.updated ?? '',
    accomplished: raw.accomplished ?? '',
    executor: raw.executor?.name ?? '',
    uniqueId: raw.uniqueId ?? null,
    url: `https://www.teambition.com/task/${raw._id}`,
  };
}

async function fetchSubtasks(headers, url, fetchImpl, maxPages = 20) {
  const out = [];
  let token = '';
  for (let i = 0; i < maxPages; i += 1) {
    const full = `${url}${url.includes('?') ? '&' : '?'}pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const res = await fetchImpl(full, { headers });
    if (res.status === 401) throw new Error('Teambition 登录态失效，需要重新登录（ticket_login / /tickets 登录）');
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const json = await res.json();
    out.push(...(json.result ?? []));
    if (!json.nextPageToken) break;
    token = json.nextPageToken;
  }
  return out;
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

/**
 * 抓取父任务的子任务。只抓 subtaskCount.total > 0 的父任务；未变化时复用旧记录。
 */
export async function syncSubtasks({
  dir,
  projectId,
  tasks,
  headers,
  fetchImpl = globalThis.fetch,
  force = false,
  concurrency = 8,
  onProgress,
} = {}) {
  const old = readSubtasks(dir, projectId);
  const parents = (tasks ?? []).filter((t) => Number(t.subtaskCount?.total ?? 0) > 0);
  const meta = { ...(old?.parents ?? {}) };
  const byParent = { ...(old?.byParent ?? {}) };
  const stats = { fetched: 0, skipped: 0, failed: 0 };
  const failures = [];

  await mapPool(parents, concurrency, async (task) => {
    const total = Number(task.subtaskCount?.total ?? 0);
    const done = Number(task.subtaskCount?.done ?? 0);
    const prev = meta[task.id];
    if (!force && prev && prev.updated === task.updated && prev.total === total && prev.done === done && byParent[task.id]) {
      stats.skipped += 1;
      return;
    }
    try {
      const raw = await fetchSubtasks(
        headers,
        `https://www.teambition.com/api/v2/tasks/${task.id}/subtasks`,
        fetchImpl,
      );
      byParent[task.id] = raw.map((item) => normalizeSubtask(item, task.id)).filter(Boolean);
      meta[task.id] = { updated: task.updated ?? '', total, done, fetchedAt: new Date().toISOString(), error: '' };
      stats.fetched += 1;
    } catch (error) {
      stats.failed += 1;
      const message = error?.message || String(error);
      failures.push({ parent: task.id, title: task.title, error: message });
      if (meta[task.id]) meta[task.id] = { ...meta[task.id], fetchedAt: new Date().toISOString(), error: message };
      else meta[task.id] = { updated: task.updated ?? '', total, done, fetchedAt: '', error: message };
    }
    onProgress?.({ fetched: stats.fetched, skipped: stats.skipped, failed: stats.failed, total: parents.length });
  });

  // 清掉已不再有子任务的父任务
  for (const id of Object.keys(byParent)) {
    if (!parents.some((task) => task.id === id)) {
      delete byParent[id];
      delete meta[id];
    }
  }

  const data = {
    format: SUBTASKS_FORMAT,
    projectId,
    syncedAt: new Date().toISOString(),
    parents: meta,
    byParent,
  };
  const file = subtasksFile(dir, projectId);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
  subtasksCache = { file: null, mtimeMs: 0, data: null };

  return {
    file,
    parents: parents.length,
    items: Object.values(byParent).reduce((acc, list) => acc + list.length, 0),
    ...stats,
    failures,
    syncedAt: data.syncedAt,
  };
}
