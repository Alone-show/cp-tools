/**
 * 机型目录：把看板里的机型族聚合成「可给模型挑选」的条目。
 *
 * 背景：`firmware_find` 以前对机型做模糊归一，于是 `APOLLO2_7` 会被等价 core
 * 静默归到 `APOLLO2-7A`（那是 SmartAG/YM 的目录），而 CP 的 7 寸记录写作
 * `RK / APOLLO2` + `LCD7`，结果 TB 一条都取不到。
 *
 * 现在的契约：只有规范名 / 别名 / 变体名（整串相等）才直接查固件；其余写法先返回
 * 这份目录，由模型按「系统 / 客户 / 尺寸 / 最新版本」自己挑，再带精确名字二次调用。
 */
import { nz, canonModel, splitVendor, equivCore, scoreCore, queryCores } from '../shared/model-core.js';
import { modelGroups, variantList, hitSystem } from '../tb/models.js';
import { asList } from '../tb/constants.js';

const LCD_RE = /lcd\s*(\d{1,2}(?:\s*-\s*\d{1,2})?)/i;
const DATE_RE = /_(20\d{6})(?:_|\.|\/|$)/;

/** 构建日期：字段缺版本号时，从标题或下载地址里捞（在制版本常常只有链接） */
export function versionDate(task) {
  const f = task?.fields ?? {};
  const sources = [
    String(f['固件版本'] || ''),
    String(task?.title || ''),
    String(f['固件下载地址'] || ''),
    String(f['OSS 线刷地址'] || ''),
  ];
  for (const src of sources) {
    const m = src.match(DATE_RE);
    if (m) return m[1];
  }
  return '';
}

/** 从固件版本 / 标题 / 链接里取屏幕尺寸段（`LCD7`、`LCD7-12`）；没有则空串 */
export function lcdOf(task) {
  const f = task?.fields ?? {};
  for (const raw of [f['固件版本'], task?.title, f['固件下载地址'], f['OSS 线刷地址'], f['OSS OTA地址']]) {
    const m = String(raw ?? '').match(LCD_RE);
    if (m) return `LCD${m[1].replace(/\s+/g, '')}`;
  }
  return '';
}

/** `LCD7` / `7` / `lcd 7-12` -> `LCD7` / `LCD7` / `LCD7-12`；无法识别返回空串 */
export function normalizeLcd(raw) {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (/^\d{1,2}(?:-\d{1,2})?$/.test(s)) return `LCD${s}`;
  const m = s.match(/^LCD(\d{1,2}(?:-\d{1,2})?)$/);
  return m ? `LCD${m[1]}` : '';
}

function lcdNumbers(value) {
  return String(value ?? '')
    .toUpperCase()
    .replace(/^LCD/, '')
    .split('-')
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x > 0);
}

/** 行尺寸是否满足查询尺寸：`LCD7` 能命中 `LCD7-12`，反之不行 */
export function lcdMatch(rowLcd, wantLcd) {
  if (!wantLcd) return true;
  const want = lcdNumbers(wantLcd);
  if (!want.length) return true;
  const row = lcdNumbers(rowLcd);
  if (!row.length) return false;
  return want.every((n) => row.includes(n));
}

/** 这条任务是否属于目录条目（按 机型 字段的 core + 厂商比较，不做前缀模糊） */
export function taskMatchesEntry(task, entry) {
  for (const raw of asList(task?.fields?.['机型'])) {
    const cm = canonModel(String(raw));
    if (!cm.core) continue;
    if (equivCore(cm.core) !== equivCore(entry.core)) continue;
    if (cm.vendor && entry.vendor && cm.vendor !== entry.vendor) continue;
    return true;
  }
  return false;
}

const stageRankOf = (stage) => (/生产库归档/.test(String(stage ?? '')) ? 0 : 1);

/** 目录里的「最新」优先生产库归档，其次构建日期（在制版本不能冒充最新量产） */
const newerThan = (a, b) => {
  if (!b) return true;
  const ra = stageRankOf(a.stage);
  const rb = stageRankOf(b.stage);
  if (ra !== rb) return ra < rb;
  return Number(a?.buildDate || 0) > Number(b?.buildDate || 0);
};

/**
 * 聚合机型目录。只读看板快照，不联网。
 * @param {object} board 看板快照
 * @param {{system?: string}} [options] 只统计某系统（Android/Debian/BuildRoot/linux）
 */
export function buildCatalog(board, { system = '' } = {}) {
  const groups = modelGroups(board);
  // 同族写法（APOLLO2-7A / APOLLO 7A 二代 / APOLLO 7 二代）在 modelGroups 里因为
  // raw core 不同会落成几个族，这里按 equivCore 合成一个目录条目，避免目录里出现
  // 只有 1 个任务的重复小族。
  const merged = new Map();
  for (const g of groups) {
    const key = `${g.vendor}\u0000${equivCore(g.core)}`;
    const acc = merged.get(key) ?? {
      vendor: g.vendor,
      core: g.core,
      names: [],
      aliases: [],
      variants: [],
      groupCount: 0,
    };
    acc.names.push([g.count, g.name]);
    acc.aliases.push(...(g.aliases ?? []));
    for (const v of variantList(g, 20)) acc.variants.push(v);
    acc.groupCount += g.count;
    merged.set(key, acc);
  }
  // 同分时优先「RK /」「T3 /」这类芯片前缀写法，避免中文族名在 tie-break 里占位
  const nameRank = (name) => (/^[A-Za-z]{2,4}\s*\/\s*\S/.test(name) ? 0 : 1);
  const entries = [...merged.entries()].map(([key, acc]) => {
    acc.names.sort(
      (a, b) => b[0] - a[0] || nameRank(a[1]) - nameRank(b[1]) || a[1].length - b[1].length || a[1].localeCompare(b[1]),
    );
    const model = acc.names[0][1];
    const aliases = [...new Set([...acc.names.slice(1).map((n) => n[1]), ...acc.aliases])].filter(
      (name) => name && name !== model,
    );
    const variantMap = new Map();
    for (const v of acc.variants) variantMap.set(v.label, (variantMap.get(v.label) ?? 0) + (v.tasks ?? 0));
    return {
      model,
      rest: splitVendor(model).rest,
      vendor: acc.vendor,
      core: acc.core,
      aliases,
      variants: [...variantMap.entries()].map(([label, tasks]) => ({ label, tasks })),
      tasks: 0,
      latest: null,
      _key: key,
      _sys: new Set(),
      _cust: new Map(),
      _lcd: new Map(),
    };
  });
  const byKey = new Map(entries.map((e) => [e._key, e]));

  for (const task of board.items ?? []) {
    if (system && !hitSystem(task, system)) continue;
    const lcd = lcdOf(task);
    const systems = asList(task.fields?.['操作系统']).map(String);
    const customers = asList(task.fields?.['客户ID']).map(String);
    const version = String(task.fields?.['固件版本'] ?? '') || String(task.title ?? '');
    const buildDate = versionDate(task);
    const cell = { version, buildDate, systems, customers, stage: task.stage ?? '', task: task.url };

    const matched = new Set();
    for (const raw of asList(task.fields?.['机型'])) {
      const { vendor, core } = canonModel(String(raw));
      if (!core) continue;
      const entry = byKey.get(`${vendor}\u0000${equivCore(core)}`);
      if (!entry || matched.has(entry)) continue;
      matched.add(entry);

      entry.tasks += 1;
      for (const s of systems) entry._sys.add(s);
      for (const c of customers) entry._cust.set(c, (entry._cust.get(c) ?? 0) + 1);
      if (newerThan(cell, entry.latest)) entry.latest = { ...cell, lcd };

      const key = lcd || '';
      const bucket = entry._lcd.get(key) ?? { tasks: 0, sys: new Set(), cust: new Map(), latest: null };
      bucket.tasks += 1;
      for (const s of systems) bucket.sys.add(s);
      for (const c of customers) bucket.cust.set(c, (bucket.cust.get(c) ?? 0) + 1);
      if (newerThan(cell, bucket.latest)) bucket.latest = { ...cell };
      entry._lcd.set(key, bucket);
    }
  }

  const sortCustomers = (map) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([id, tasks]) => ({ id, tasks }));

  return entries
    .filter((e) => e.tasks > 0)
    .map((e) => ({
      model: e.model,
      rest: e.rest,
      vendor: e.vendor,
      core: e.core,
      aliases: e.aliases,
      variants: e.variants,
      tasks: e.tasks,
      systems: [...e._sys].sort(),
      customers: sortCustomers(e._cust),
      latest: e.latest,
      lcds: [...e._lcd.entries()]
        .filter(([lcd]) => lcd)
        .map(([lcd, bucket]) => ({
          lcd,
          tasks: bucket.tasks,
          systems: [...bucket.sys].sort(),
          customers: sortCustomers(bucket.cust),
          latest: bucket.latest,
        }))
        .sort((a, b) => lcdNumbers(a.lcd)[0] - lcdNumbers(b.lcd)[0]),
    }))
    .sort((a, b) => b.tasks - a.tasks || a.model.localeCompare(b.model));
}

/**
 * 共享固件规则（业务口径，仅这两组开放）：
 * - APOLLO2-7A ≡ APOLLO2 的 7 寸固件（CP 写 RK / APOLLO2 + LCD7，别家写 APOLLO2-7A）
 * - APOLLO2-12A ≡ APOLLO2 的 12 寸固件
 * 只按「同厂商 + 同尺寸」共享；12PRO / 12PLUS / 10 寸等不参与，避免串型号。
 */
export const FIRMWARE_SHARING_GROUPS = [
  { lcd: 'LCD7', cores: ['apollo', 'apollo7'] },
  { lcd: 'LCD12', cores: ['apollo', 'apollo12'] },
];

/**
 * 解析出共享同一份固件的机型条目（含自身）。
 * @param {Array} entries 机型目录
 * @param {object} entry 已命中的条目
 * @param {string} lcd 已确定（或推断）的尺寸
 */
export function firmwareSharingScope(entries, entry, lcd) {
  const size = normalizeLcd(lcd);
  const group = FIRMWARE_SHARING_GROUPS.find(
    (g) => g.lcd === size && g.cores.includes(equivCore(entry.core)),
  );
  if (!group) return [entry];
  const scope = (entries ?? [entry]).filter(
    (e) => e.vendor === entry.vendor && group.cores.includes(equivCore(e.core)),
  );
  // 只有确实在该尺寸有记录的条目才算「共享」；没有尺寸信息的目录条目不要硬拉进来
  const withSize = scope.filter(
    (e) => e === entry || (e.lcds ?? []).some((cell) => lcdMatch(cell.lcd, size)),
  );
  if (!withSize.some((e) => e === entry)) withSize.unshift(entry);
  return withSize;
}

/**
 * 严格解析：整串相等才算命中（规范名 / 去厂商名 / 别名 / 变体名）。
 * @returns {{status:'hit'|'ambiguous'|'miss', matches:Array<{entry:object, matchedBy:string, variant?:object}>}}
 */
export function resolveExact(entries, query) {
  const q = nz(query);
  if (!q) return { status: 'miss', matches: [] };
  const matches = [];
  const seen = new Set();
  const push = (entry, matchedBy, variant) => {
    if (seen.has(entry.model)) return;
    seen.add(entry.model);
    matches.push({ entry, matchedBy, ...(variant ? { variant } : {}) });
  };
  for (const entry of entries) {
    if (nz(entry.model) === q) push(entry, 'exact-name');
  }
  for (const entry of entries) {
    if (nz(entry.rest) === q) push(entry, 'name-without-vendor');
  }
  for (const entry of entries) {
    if ((entry.aliases ?? []).some((a) => nz(a) === q)) push(entry, 'alias');
  }
  for (const entry of entries) {
    const variant = (entry.variants ?? []).find((v) => nz(v.label) === q);
    if (variant) push(entry, 'variant', variant);
  }
  // 去尾 A 等价：APOLLO2-7 ≡ APOLLO2-7A、APOLLO2-12 ≡ APOLLO2-12A
  const qForms = new Set(
    [canonModel(String(query ?? '')).core, canonModel(splitVendor(String(query ?? '')).rest).core]
      .map((core) => equivCore(core))
      .filter(Boolean),
  );
  for (const entry of entries) {
    const forms = [entry.model, entry.rest, ...(entry.aliases ?? [])]
      .map((name) => equivCore(canonModel(name).core))
      .filter(Boolean);
    if (forms.some((form) => qForms.has(form))) push(entry, 'equivalent-name');
  }
  if (!matches.length) return { status: 'miss', matches: [] };
  return { status: matches.length === 1 ? 'hit' : 'ambiguous', matches };
}

/**
 * 模糊写法的兜底候选（只用于排序展示，绝不自动采用）：
 * 字母骨架相同优先，其次 core 打分，最后按任务量。
 */
export function suggestMatches(entries, query, limit = 12) {
  const q = nz(query);
  if (!q) return [];
  const qLetters = q.replace(/\d/g, '');
  const { core } = canonModel(query);
  const cores = core ? queryCores(core) : [];
  const scored = [];
  for (const entry of entries) {
    const eLetters = nz(entry.rest).replace(/\d/g, '');
    let score = 0;
    if (qLetters && qLetters === eLetters) {
      score = 85;
      // 数字是型号身份的一部分：apollo7 与 apollo7a 同骨架又同尺寸，优先于 apollo12pro
      const qDigits = (q.match(/\d+/g) ?? []).join('');
      const eDigits = nz(entry.rest).match(/\d+/g) ?? [];
      if (qDigits && eDigits.some((d) => d.includes(qDigits) || qDigits.includes(d))) score = 90;
    }
    else if (qLetters && eLetters && (eLetters.startsWith(qLetters) || qLetters.startsWith(eLetters))) score = 70;
    for (const c of cores) score = Math.max(score, scoreCore(c, entry.core));
    if (score <= 0) continue;
    scored.push([score, entry]);
  }
  scored.sort((a, b) => b[0] - a[0] || b[1].tasks - a[1].tasks);
  return scored.slice(0, limit).map(([score, entry]) => ({ score, entry }));
}
