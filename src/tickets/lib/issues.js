/**
 * TB 版本任务 / 子任务（待解决、已解决）本地索引与检索。
 *
 * 数据形态：
 *   subtasks-<projectId>.json = { format, projectId, syncedAt, parents:{id:{updated,total,done,fetchedAt,error}}, byParent:{parentId:[subtask]} }
 * 子任务记录只存展示/检索需要的字段；父任务（版本任务）字段仍从 board-*.json 读。
 */
import { nz } from './bug/parse.js';
import { LINK_FIELDS, asList } from '../../tb/constants.js';
import { isVersionTask } from '../../tb/models.js';

export { isVersionTask };
import { matchScore, taskMatches } from './symptoms.js';


/** TB 富文本/HTML -> 纯文本，截断，用于匹配与展示 */
/** 子任务状态 -> 业务口径 */
export function issueOutcome(isDone, status) {
  const st = String(status ?? '');
  if (/拒绝|不解决|不执行/.test(st)) return 'rejected';
  if (/挂起/.test(st)) return 'suspended';
  if (isDone === true) return 'solved';
  if (isDone === false) return 'pending';
  return 'unknown';
}

const OUTCOME_ORDER = { pending: 0, suspended: 1, unknown: 2, solved: 3, rejected: 4 };

export function outcomeLabel(outcome) {
  return { solved: '已解决', pending: '待解决', suspended: '暂挂起', rejected: '已拒绝', unknown: '状态未知' }[outcome] || '状态未知';
}

export function linksOf(parent) {
  const out = {};
  for (const key of LINK_FIELDS) {
    const value = asList(parent?.fields?.[key])[0];
    if (value) out[key] = String(value);
  }
  return out;
}

/** 构建日期：优先固件版本字段，其次标题/链接 */
export function versionDate(parent) {
  const f = parent?.fields ?? {};
  const sources = [
    String(asList(f['固件版本'])[0] ?? ''),
    String(parent?.title ?? ''),
    String(asList(f['固件下载地址'])[0] ?? ''),
    String(asList(f['OSS 线刷地址'])[0] ?? ''),
  ];
  for (const src of sources) {
    const m = src.match(/_(20\d{6})(?:_|\.|\/|$)/);
    if (m) return m[1];
  }
  return '';
}

export function stageRank(stage) {
  const st = String(stage ?? '');
  if (st.includes('下架')) return 4;
  if (st.startsWith('生产库归档')) return 0;
  if (st.includes('发布')) return 1;
  return 2;
}

/** 子任务与查询的匹配：同义词归一后的最优分数 */
export function scoreIssue(query, subtask) {
  return matchScore(query, `${subtask.content ?? ''} ${subtask.note ?? ''}`);
}

export function issueMatches(query, scored) {
  return scored.substring || scored.ratio >= 0.45 || scored.score >= 120;
}

function pickStatus(records, status) {
  const wanted = String(status ?? 'all').toLowerCase();
  if (wanted === 'all' || !wanted) return records;
  return records.filter((record) => {
    const outcome = issueOutcome(record.subtask.isDone, record.subtask.status);
    if (wanted === 'open') return outcome === 'pending' || outcome === 'suspended' || outcome === 'unknown';
    if (wanted === 'done') return outcome === 'solved';
    if (wanted === 'rejected') return outcome === 'rejected';
    return true;
  });
}

/**
 * 把「子任务 + 父版本任务」记录分组为版本行。
 * 父任务字段已经由调用方归一（local: board item；live: task detail）。
 */
export function buildIssueRows({
  records,
  customer = 'CP',
  customerDefaulted = true,
  otherCustomers = [],
  status = 'all',
  query = '',
  limit = 5,
  subtaskLimit = 30,
  syncedAt = '',
  ageHours = null,
  source = 'index',
  notes = [],
} = {}) {
  const kept = [];
  const lowConfidence = [];
  let queryUsed = String(query ?? '').trim() !== '';
  const q = String(query ?? '').trim();

  for (const record of pickStatus(records ?? [], status)) {
    const parent = record.parent;
    if (!parent || !isVersionTask(parent)) continue;
    const subtask = record.subtask;
    if (q) {
      const scored = scoreIssue(q, subtask);
      if (!issueMatches(q, scored)) {
        lowConfidence.push({ ...subtask, score: scored.score, hits: scored.hits, parent });
        continue;
      }
      kept.push({ ...record, score: scored.score, hits: scored.hits, outcome: issueOutcome(subtask.isDone, subtask.status) });
    } else {
      kept.push({ ...record, score: 0, hits: [], outcome: issueOutcome(subtask.isDone, subtask.status) });
    }
  }

  const groups = new Map();
  for (const record of kept) {
    const parent = record.parent;
    const version = String(asList(parent.fields?.['固件版本'])[0] ?? '') || String(parent.title ?? '') || parent.id;
    const key = version;
    const group = groups.get(key) ?? { version, parent, subtasks: [] };
    // 同版本多任务时保留排序更靠前的父任务（生产库归档优先）
    const prevRank = group.parent ? [stageRank(group.parent.stage), -Number(versionDate(group.parent) || 0)] : null;
    const nextRank = [stageRank(parent.stage), -Number(versionDate(parent) || 0)];
    if (!prevRank || nextRank[0] < prevRank[0] || (nextRank[0] === prevRank[0] && nextRank[1] < prevRank[1])) {
      group.parent = parent;
    }
    if (!group.subtasks.some((s) => s.id === record.subtask.id)) {
      group.subtasks.push(record);
    }
    groups.set(key, group);
  }

  const rows = [...groups.values()];
  const latestArchived = Math.max(
    0,
    ...rows.filter((row) => stageRank(row.parent.stage) === 0).map((row) => Number(versionDate(row.parent) || 0)),
  );

  for (const row of rows) {
    const parent = row.parent;
    const buildDate = versionDate(parent);
    const counts = { total: row.subtasks.length, open: 0, solved: 0, rejected: 0, suspended: 0 };
    for (const item of row.subtasks) {
      if (item.outcome === 'solved') counts.solved += 1;
      else if (item.outcome === 'rejected') counts.rejected += 1;
      else if (item.outcome === 'suspended') counts.suspended += 1;
      else counts.open += 1;
    }
    row.buildDate = buildDate;
    row.stage = parent.stage ?? '';
    row.customer = asList(parent.fields?.['客户ID']).join(', ');
    row.models = asList(parent.fields?.['机型']).join(', ');
    row.system = asList(parent.fields?.['操作系统']).join(', ');
    row.task = parent.url ?? '';
    row.links = linksOf(parent);
    row.phase = stageRank(parent.stage) === 0 ? 'archived' : stageRank(parent.stage) === 1 ? 'published' : 'other';
    row.inProgress = stageRank(parent.stage) !== 0 && Number(buildDate || 0) > latestArchived && latestArchived > 0;
    row.latestArchived = Number(buildDate || 0) === latestArchived && latestArchived > 0;
    row.counts = counts;
    row.subtasks = row.subtasks
      .sort((a, b) =>
        q
          ? b.score - a.score || String(b.subtask.updated).localeCompare(String(a.subtask.updated))
          : OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] ||
            String(b.subtask.updated).localeCompare(String(a.subtask.updated)),
      )
      .slice(0, Math.max(1, subtaskLimit))
      .map((item) => ({
        id: item.subtask.id,
        content: item.subtask.content,
        note: item.subtask.note ? item.subtask.note.slice(0, 400) : '',
        status: item.subtask.status,
        isDone: item.subtask.isDone,
        outcome: item.outcome,
        created: item.subtask.created,
        updated: item.subtask.updated,
        accomplished: item.subtask.accomplished,
        executor: item.subtask.executor,
        uniqueId: item.subtask.uniqueId,
        url: item.subtask.url,
        score: item.score ?? 0,
        hits: item.hits ?? [],
      }));
  }

  rows.sort((a, b) => String(b.buildDate).localeCompare(String(a.buildDate)) || stageRank(a.stage) - stageRank(b.stage));
  const picked = rows.slice(0, Math.max(1, limit));
  const allSubs = kept.map((r) => r.subtask);
  const summary = {
    versions: picked.length,
    subtasks: picked.reduce((acc, row) => acc + row.counts.total, 0),
    open: picked.reduce((acc, row) => acc + row.counts.open, 0),
    done: picked.reduce((acc, row) => acc + row.counts.solved, 0),
    rejected: picked.reduce((acc, row) => acc + row.counts.rejected, 0),
    suspended: picked.reduce((acc, row) => acc + row.counts.suspended, 0),
  };

  if (!picked.length) {
    if (q && lowConfidence.length) {
      // 全都不达阈值时，给 3 条低置信候选，避免直接空结果
      lowConfidence.sort((a, b) => b.score - a.score);
      const fallback = lowConfidence.slice(0, 3).map((item) => ({
        content: item.content,
        outcome: issueOutcome(item.isDone, item.status),
        version: String(asList(item.parent.fields?.['固件版本'])[0] ?? '') || item.parent.title,
        buildDate: versionDate(item.parent),
        score: item.score,
        hits: item.hits,
      }));
      return {
        status: 'empty',
        lowConfidence: fallback,
        summary,
        rows: [],
        notes: [...notes, '没有达到阈值的子任务；下面是相似度最高的低置信候选，可换更具体的现象词重试。'],
      };
    }
    return {
      status: 'empty',
      summary,
      rows: [],
      notes: [...notes, q ? '没有匹配的子任务；可换关键词或放宽客户/系统/状态。' : '该机型/客户/系统下没有可用的子任务记录。'],
    };
  }

  return {
    status: 'ok',
    source,
    customer,
    customerDefaulted,
    otherCustomers,
    syncedAt,
    ...(Number.isFinite(ageHours) ? { ageHours } : {}),
    summary,
    lowConfidence: [],
    pending: [],
    rows: picked,
    notes,
  };
}

/* ------------------------------------------------------------------ *
 * 工单检索（跨全部看板任务 / 子任务，不要求版本父任务）
 * ------------------------------------------------------------------ */

function taskHaystack(task, note = '') {
  const fields = task?.fields ?? {};
  return [
    task?.title ?? '',
    note,
    ...Object.values(fields).flatMap((value) => (Array.isArray(value) ? value : [value])),
  ]
    .filter(Boolean)
    .join(' ');
}

function taskOutcome(task) {
  const stage = String(task?.stage ?? '');
  if (/拒绝|不解决/.test(stage)) return 'rejected';
  if (/挂起/.test(stage)) return 'suspended';
  if (task?.isDone === true) return 'solved';
  if (task?.isDone === false) return 'pending';
  return 'unknown';
}

function modelNeedlesOf(model) {
  const raw = String(model ?? '').trim();
  if (!raw) return [];
  const out = new Set([raw]);
  if (/SP2/i.test(raw)) out.add(raw.replace(/SP2/gi, 'SPRING2'));
  if (/SPRING2/i.test(raw)) out.add(raw.replace(/SPRING2/gi, 'SP2'));
  if (/APOLLO2/i.test(raw)) out.add(raw.replace(/APOLLO2/gi, 'APOLLO'));
  if (/APOLLO/i.test(raw)) out.add(raw.replace(/APOLLO/gi, 'APOLLO2'));
  return [...out].map((x) => nz(x)).filter(Boolean);
}

function taskRowOf(task, { parent = null, kind = 'task', score = 0, hits = [] } = {}) {
  const isVersion = isVersionTask(task);
  return {
    kind,
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
    outcome: taskOutcome(task),
    score,
    hits,
    parentVersion: isVersion ? '' : String(asList(parent?.fields?.['固件版本'])[0] ?? '') || String(parent?.title ?? ''),
    parentTask:
      isVersion || !parent
        ? null
        : { id: parent.id, taskNo: parent.uniqueId ?? null, title: parent.title, stage: parent.stage, url: parent.url },
  };
}

/**
 * 按现象搜索任意 TB 任务（含无子任务、无客户字段、已归档的 ITR/缺陷单）。
 * 命中子任务时挂回所属父任务。
 */
export function searchBoardTasks(board, subtasks, { query = '', limit = 10, status = 'all', model = '', system = '', stage = '' } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return { status: 'needs_model', mode: 'tasks', hint: '请给一个现象关键词，如「单卡 出现两个卡 上不去网」。', tasks: [] };
  const items = board?.items ?? [];
  const byId = new Map(items.map((task) => [task.id, task]));
  const needles = modelNeedlesOf(model);
  const wantedSystem = String(system ?? '').trim().toLowerCase();

  const docs = [];
  for (const task of items) {
    docs.push({
      kind: 'task',
      id: task.id,
      title: String(task.title ?? ''),
      task,
      parent: null,
      text: taskHaystack(task),
    });
  }
  for (const [parentId, list] of Object.entries(subtasks?.byParent ?? {})) {
    const parent = byId.get(parentId);
    if (!parent) continue;
    for (const sub of list ?? []) {
      docs.push({
        kind: 'subtask',
        id: sub.id,
        title: String(sub.content ?? ''),
        task: {
          ...sub,
          url: sub.url,
          uniqueId: sub.uniqueId,
          stage: parent.stage,
          isDone: sub.isDone,
          isArchived: parent.isArchived,
          created: sub.created,
          accomplished: sub.accomplished,
          updated: sub.updated,
          executor: sub.executor,
        },
        parent,
        text: taskHaystack({ title: sub.content, fields: parent.fields }, sub.note ?? ''),
      });
    }
  }

  const kept = [];
  const low = [];
  for (const doc of docs) {
    if (needles.length) {
      const hay = nz(doc.text);
      if (!needles.some((needle) => hay.includes(needle))) continue;
    }
    if (wantedSystem) {
      const systems = asList(doc.parent?.fields?.['操作系统'] ?? doc.task?.fields?.['操作系统'])
        .map((x) => String(x).toLowerCase())
        .join(' ');
      if (systems && !systems.includes(wantedSystem) && !(wantedSystem === 'linux' && /(debian|buildroot)/.test(systems))) continue;
    }
    if (stage && !String(doc.parent?.stage ?? doc.task?.stage ?? '').includes(String(stage))) continue;
    const scored = matchScore(q, doc.text);
    if (!taskMatches(scored)) {
      low.push({ ...doc, score: scored.score, hits: scored.hits, ratio: scored.ratio });
      continue;
    }
    if (status && status !== 'all') {
      const outcome = taskOutcome(doc.task);
      if (status === 'open' && outcome !== 'pending' && outcome !== 'suspended' && outcome !== 'unknown') continue;
      if (status === 'done' && outcome !== 'solved') continue;
      if (status === 'rejected' && outcome !== 'rejected') continue;
    }
    kept.push({ doc, scored });
  }

  const dedup = new Map();
  for (const item of kept) {
    const row = taskRowOf(item.doc.task, { parent: item.doc.parent, kind: item.doc.kind, score: item.scored.score, hits: item.scored.hits });
    row.concepts = item.scored.concepts?.length ?? 0;
    const prev = dedup.get(row.id);
    if (!prev || row.score > prev.score) dedup.set(row.id, row);
  }
  const tasks = [...dedup.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (b.concepts ?? 0) - (a.concepts ?? 0) ||
      String(b.accomplished || b.updated).localeCompare(String(a.accomplished || a.updated)),
  );

  if (!tasks.length) {
    low.sort((a, b) => b.score - a.score);
    return {
      status: 'empty',
      mode: 'tasks',
      query: q,
      summary: { tasks: 0, open: 0, done: 0, rejected: 0 },
      tasks: [],
      lowConfidence: low.slice(0, 3).map((item) => ({
        title: item.title,
        score: item.score,
        hits: item.hits,
        parentVersion: item.parent ? String(asList(item.parent.fields?.['固件版本'])[0] ?? '') || item.parent.title : '',
      })),
      notes: ['没有达到阈值的工单；下面是相似度最高的低置信候选，可换更具体的现象词。'],
    };
  }

  const picked = tasks.slice(0, Math.max(1, limit));
  return {
    status: 'ok',
    mode: 'tasks',
    query: q,
    summary: {
      tasks: picked.length,
      open: picked.filter((t) => t.outcome === 'pending' || t.outcome === 'suspended').length,
      done: picked.filter((t) => t.outcome === 'solved').length,
      rejected: picked.filter((t) => t.outcome === 'rejected').length,
    },
    tasks: picked,
    lowConfidence: [],
    notes: [],
  };
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

export function renderIssues(result) {
  if (result.status === 'needs_sync') return `还没有 TB 子任务索引。${result.hint || ''}`;
  if (result.status === 'needs_setup') return `还没有 TB 看板索引。${result.hint || ''}`;
  if (result.status === 'needs_model') return `请补充机型。${result.hint || ''}`;
  if (result.status === 'needs_auth') return `需要 Teambition 登录。${result.hint || ''}`;
  if (result.status === 'error') return `ticket_search 出错：${result.message}`;
  if (result.status === 'needs_confirmation') {
    const lines = [`机型「${result.query || result.resolvedModel || '-'}」无法唯一确定，需要用户确认：`, ''];
    for (const c of result.candidates || []) {
      const alias = c.aliases?.length ? `  (同族写法: ${c.aliases.join(' / ')})` : '';
      const vs = c.variants?.length ? `  变体: ${c.variants.map((x) => `${x.label}(${x.tasks})`).join(' / ')}` : '';
      lines.push(`- ${c.model}  [${c.score} 分, ${c.tasks} 个任务]${alias}${vs}`);
    }
    if (result.note) lines.push('', result.note);
    lines.push('', '请让用户选定一个后用 /tickets 重发，不要自行猜测。');
    return lines.join('\n');
  }

  if (result.mode === 'tasks' || (result.tasks && !result.rows)) {
    const lines = [];
    const scope = [result.query || '-', '全部系统', '不限客户'];
    lines.push(`范围：${scope.join(' | ')}`);
    if (result.summary) {
      lines.push(
        `共 ${result.summary.tasks ?? 0} 条工单命中：已解决 ${result.summary.done ?? 0}，待解决 ${result.summary.open ?? 0}，已拒绝 ${result.summary.rejected ?? 0}`,
      );
    }
    lines.push('');
    for (const task of result.tasks || []) {
      const tag = { solved: '已解决', pending: '待解决', suspended: '暂挂起', rejected: '已拒绝', unknown: '状态未知' }[task.outcome] || '状态未知';
      const no = task.taskNo != null ? `#${task.taskNo}` : '#-';
      const score = task.score ? ` [${task.score} 分]` : '';
      const hit = task.hits?.length ? `（命中：${task.hits.slice(0, 5).join('/')}）` : '';
      const dates = [
        task.created ? `创建 ${String(task.created).slice(0, 10)}` : '',
        task.accomplished ? `完成 ${String(task.accomplished).slice(0, 10)}` : '',
        task.executor ? `执行人 ${task.executor}` : '',
      ].filter(Boolean).join('，');
      lines.push(`- ${no} [${tag}] ${task.title}${score}${hit}`);
      const meta = [task.stage || '', task.parentVersion ? `所属版本 ${task.parentVersion}` : '', dates].filter(Boolean).join(' | ');
      if (meta) lines.push(`    ${meta}`);
      if (task.url) lines.push(`    ${task.url}`);
      if (/^ITR:/.test(String(task.title)) && !/ITR[\s-]*\d/i.test(String(task.title))) {
        lines.push('    注：标题只有「ITR:」前缀，TB 里没有对应的 ITR 编号。');
      }
    }
    if (result.status === 'empty') {
      lines.push('', '没有匹配的工单。');
      for (const item of result.lowConfidence || []) {
        lines.push(`  低置信：${item.title}（${item.parentVersion || '-'}，${item.score} 分）`);
      }
    }
    for (const note of result.notes || []) lines.push(`· ${note}`);
    return lines.join('\n').trim();
  }

  const lines = [];
  const scope = [result.resolvedModel || result.query || '-', result.system || result.requestedSystem || '全部系统', `客户 ${result.customer || 'CP'}${result.customerDefaulted ? '（默认）' : ''}`];
  lines.push(`范围：${scope.join(' | ')}`);
  if (result.otherCustomers?.length) {
    lines.push(`其他客户还有：${result.otherCustomers.map((c) => `${c.customer}(${c.count})`).join('、')}`);
  }

  if (result.status === 'empty') {
    lines.push('', '没有匹配的子任务。');
    for (const item of result.lowConfidence || []) {
      lines.push(`  低置信：${item.content}（${item.version}，${item.buildDate || '-'}，${item.score} 分）`);
    }
    for (const note of result.notes || []) lines.push(`· ${note}`);
    return lines.join('\n');
  }

  const s = result.summary || {};
  lines.push(
    `共 ${s.versions ?? 0} 个版本 / ${s.subtasks ?? 0} 个子任务：已解决 ${s.done ?? 0}，待解决 ${s.open ?? 0}，已拒绝 ${s.rejected ?? 0}${s.suspended ? `，暂挂起 ${s.suspended}` : ''}`,
  );
  lines.push('');

  for (const row of result.rows || []) {
    const phase = row.inProgress ? '在制' : row.phase === 'archived' ? '生产库归档' : row.stage || '-';
    lines.push(`[${row.version}] ${phase} | 构建 ${row.buildDate || '-'} | 客户 ${row.customer || '-'}`);
    if (row.models || row.system) lines.push(`    机型 ${row.models || '-'} | 系统 ${row.system || '-'}`);
    if (row.links?.['OSS 线刷地址']) lines.push(`    线刷：${row.links['OSS 线刷地址']}`);
    if (row.links?.['OSS OTA地址']) lines.push(`    OTA：${row.links['OSS OTA地址']}`);
    if (row.task) lines.push(`    任务：${row.task}`);
    for (const item of row.subtasks || []) {
      const tag = outcomeLabel(item.outcome);
      const score = item.score ? ` [${item.score} 分]` : '';
      const hit = item.hits?.length ? `（命中：${item.hits.slice(0, 5).join('/')}）` : '';
      lines.push(`    - [${tag}] ${item.content}${score}${hit}${item.executor ? `（${item.executor}，${(item.accomplished || item.updated || '').slice(0, 10)}）` : ''}`);
    }
    lines.push('');
  }

  for (const note of result.notes || []) lines.push(`· ${note}`);
  if (result.ageHours !== null && result.ageHours !== undefined) {
    lines.push(`索引：${Number(result.ageHours).toFixed(1)} 小时前${result.ageHours > 72 ? '（已过期，建议 /tickets sync）' : ''}`);
  }
  return lines.join('\n').trim();
}
