/**
 * 机型归一：按「文档机型」分组，每组挂多个 core（文档名/业务写法/CP 编码）。
 *
 * 打分原语与 firmware-finder 共用 `src/shared/model-core.js`；这里保留文档域的
 * `resolveModel`（cores 数组、厂商权重、更严的歧义阈值）和 cp-docs 特有的中文 token。
 */
import {
  nz,
  splitVendor,
  canonCore as sharedCanonCore,
  canonModel as sharedCanonModel,
  queryCores,
  gapScore,
  scoreCore,
  CP_DOC_TOKENS,
} from '../../shared/model-core.js';

export { nz, splitVendor, queryCores, gapScore, scoreCore };

/** 文档机型：特别版/电台/雷沃/华测 必须先转 token，否则会被 nz 抹掉与基础机型撞车。 */
export function canonCore(name) {
  return sharedCanonCore(name, CP_DOC_TOKENS);
}

export function canonModel(raw) {
  return sharedCanonModel(raw, CP_DOC_TOKENS);
}

/**
 * @param {string} query 用户写的机型串
 * @param {Array} groups models.json 的 models（每组有 cores）
 * @returns {{hit: object|null, scored: Array<[number, object]>}}
 */
export function resolveModel(query, groups) {
  const { vendor: qv, core: qc } = canonModel(query);
  if (!qc) return { hit: null, scored: [] };
  const cores = queryCores(qc);
  const scored = [];
  for (const g of groups) {
    let score = 0;
    for (const c of g.cores ?? []) {
      for (const q of cores) score = Math.max(score, scoreCore(q, c));
    }
    if (qv && g.vendor === qv) score += 10;
    else if (qv && g.vendor && g.vendor !== qv) score -= 10;
    if (score >= 40) scored.push([score, g]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  const top = scored[0];
  if (top) {
    // 精确命中(≥95)只被另一个精确命中阻断；gap 命中(85)才被同级 gap 阻断。
    // 这一处比 firmware-finder 略严：避免 "APOLLO X"(精确) 被 "APOLLO 12X"(gap 85) 拖成歧义。
    const strong = top[0] >= 95 ? 95 : 85;
    const rivals = scored.slice(1).filter(([sc]) => sc >= strong);
    // 文档机型没有厂商维度：查询带厂商前缀时不作为阻断条件（g.vendor 为空视为通配）
    if (rivals.length === 0 && top[0] >= strong && (!qv || !top[1].vendor || top[1].vendor === qv)) return { hit: top[1], scored };
  }
  return { hit: null, scored };
}

export function modelVariants(model) {
  const base = nz(model);
  const v = new Set([base]);
  if (base.includes('apollo2')) v.add(base.replaceAll('apollo2', 'apollo'));
  else if (base.includes('apollo')) v.add(base.replaceAll('apollo', 'apollo2'));
  if (base.includes('spring2')) v.add(base.replaceAll('spring2', 'sp2'));
  if (base.includes('sp2')) v.add(base.replaceAll('sp2', 'spring2'));
  return [...v].filter(Boolean);
}
