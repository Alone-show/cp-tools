/**
 * 机型归一与打分的公共原语。
 *
 * 这里只放三个子插件**行为完全一致**的部分：去符号、厂商前缀、语义核心、缩写展开、
 * 省略尺寸段的 gap 打分、core 打分。各域的 `resolveModel`（分组、厂商权重、阈值、
 * 变体/别名）仍留在各自模块里——它们的语义不同，强行合并会改变命中结果。
 */

/** 去符号 + 小写。 */
export function nz(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const VENDOR = {
  rk: 'rk',
  瑞芯微: 'rk',
  rockchip: 'rk',
  t3: 't3',
  sc60: 'sc60',
  全志: 'allwinner',
  高通: 'qualcomm',
};

export function vendorKey(token) {
  const t = String(token ?? '').trim();
  return VENDOR[t.toLowerCase()] ?? VENDOR[t] ?? '';
}

/**
 * 厂商前缀（RK /、T3 /、瑞芯微 /、(RK) 等）；只认已知厂商，避免把型号当前缀。
 * @returns {{vendor: string, rest: string}}
 */
export function splitVendor(raw) {
  const s = String(raw ?? '').trim();
  const paren = s.match(/^(.+?)\s*[（(]\s*([^)）]+?)\s*[)）]$/);
  if (paren) {
    const v = vendorKey(paren[2]);
    if (v) return { vendor: v, rest: paren[1].trim() };
  }
  const parts = s.split(/[/／]/);
  if (parts.length >= 2) {
    const v = vendorKey(parts[0]);
    if (v) return { vendor: v, rest: parts.slice(1).join('/').trim() };
  }
  const dashed = s.match(/^([A-Za-z0-9\u4e00-\u9fa5]{2,7})\s*[-_\s]\s*(.+)$/);
  if (dashed) {
    const v = vendorKey(dashed[1]);
    if (v) return { vendor: v, rest: dashed[2].trim() };
  }
  return { vendor: '', rest: s };
}

/** 基础中文标记：二代 → gen2（firmware / alist 共用）。 */
const BASE_TOKENS = [[/二代/g, 'gen2']];

/**
 * cp-docs 额外区分的业务写法。放在这里而不是复制一份 canonCore：
 * 特别版/电台/雷沃/华测 被 nz 抹掉后会与基础机型撞车，所以必须先转 token。
 */
export const CP_DOC_TOKENS = [
  [/2代/g, 'gen2'],
  [/特别版/g, 'special'],
  [/电台/g, 'radio'],
  [/雷沃/g, 'lovol'],
  [/华测/g, 'huace'],
];

/**
 * 语义核心：中文标记转 token → 去符号 → apollo2 折叠成 apollo。
 * @param {string} name
 * @param {Array<[RegExp, string]>} [extraTokens] 额外的中文标记替换（如 cp-docs 的特别版/电台）
 */
export function canonCore(name, extraTokens = []) {
  let base = String(name ?? '');
  for (const [re, rep] of BASE_TOKENS) base = base.replace(re, rep);
  for (const [re, rep] of extraTokens) base = base.replace(re, rep);
  return nz(base).replace(/apollo2/g, 'apollo');
}

/** @returns {{vendor: string, core: string}} */
export function canonModel(raw, extraTokens = []) {
  const { vendor, rest } = splitVendor(raw);
  return { vendor, core: canonCore(rest, extraTokens) };
}

/**
 * 比较用的等价 core（只影响匹配，不影响展示名）：
 * - 去掉尾部 `gen2`：`apollo7gen2` -> `apollo7`、`apollo7agen2` -> `apollo7a`；
 * - 尾部字母 `a` 折叠：仅当形如 `<字母><数字>a` 时去掉末尾 `a`（`apollo7a` -> `apollo7`、
 *   `apollo12a` -> `apollo12`）；`12pro` / `12plus` / `mix` 不匹配该形状，不会被误合并。
 */
export function equivCore(core) {
  let value = String(core ?? '');
  if (!value) return '';
  value = value.replace(/gen2$/, '');
  if (/^[a-z]+\d+a$/.test(value)) value = value.slice(0, -1);
  return value;
}

/** 查询侧缩写展开：SP2 <-> SPRING2、APOLLO <-> APOLLO2。 */
export function queryCores(qc) {
  const cores = new Set([qc]);
  for (const [a, b] of [
    ['sp2', 'spring2'],
    ['spring2', 'sp2'],
    ['apollo2', 'apollo'],
    ['apollo', 'apollo2'],
  ]) {
    if (qc.includes(a)) cores.add(qc.replaceAll(a, b));
  }
  return [...cores];
}

/**
 * 查询省略了型号里的尺寸数字段时仍应命中：spring2pro -> spring210pro。
 * 约束：查询以字母结尾（pro/plus/mix），字母骨架相同，且核心数字更多。
 */
export function gapScore(qc, core) {
  if (!/[a-z]$/.test(qc)) return 0;
  const qLetters = qc.replace(/\d/g, '');
  const cLetters = core.replace(/\d/g, '');
  if (!qLetters || qLetters !== cLetters) return 0;
  const qDigits = (qc.match(/\d/g) ?? []).length;
  const cDigits = (core.match(/\d/g) ?? []).length;
  return cDigits > qDigits ? 85 : 0;
}

/**
 * 单个 core 对查询 core 的分数（0..100）。
 * 第二个参数既接受 core 字符串，也接受 `{ core }` 分组对象（兼容 firmware 的调用点）。
 */
export function scoreCore(qc, coreOrGroup) {
  const core = typeof coreOrGroup === 'object' && coreOrGroup ? coreOrGroup.core : coreOrGroup;
  if (core === qc) return 100;
  if (core.startsWith(qc)) return 70;
  if (core.includes(qc)) return 50;
  if (qc.includes(core)) {
    // spring2 不该匹配 spring：只有当多出来的部分是字母（如 5g）时才算同一族
    if (/[a-z]/.test(qc.split(core).join(''))) return 40;
  }
  const gap = gapScore(qc, core);
  if (gap) return gap;
  const qt = new Set(qc.match(/[a-z]+|\d+/g) ?? []);
  const gt = new Set(core.match(/[a-z]+|\d+/g) ?? []);
  const inter = [...qt].filter((x) => gt.has(x));
  return inter.length >= 2 ? 20 + 5 * inter.length : 0;
}
