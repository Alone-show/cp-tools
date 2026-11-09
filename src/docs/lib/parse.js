/**
 * 自然语言 → { modelText, question, intent }。
 * 意图：query（有机型）/ catalog（问机型列表）/ sync（维护）/ help。
 */
import { resolveModel } from './models.js';

const CATALOG_RE = /(支持|有哪些|哪些|所有|全部|清单|列表).*(机型|型号|设备|产品)|(机型|型号)清单|有哪些机型/;
const SYNC_RE = /(更新|同步|刷新|重抓).*(资料|文档|快照|索引)|重新抓取/;
const CN_SUFFIX_RE = /^((?:(?:二代|特别版|电台|雷沃|华测)\s*)+)/;

/** 抽出文中所有「拉丁/数字串 + 可选中文后缀」的候选机型片段（长 → 短） */
function modelCandidates(text) {
  const out = [];
  const re = /[A-Za-z0-9][A-Za-z0-9 _\-/.]{0,36}/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    let raw = m[0];
    // 允许中文后缀（二代/特别版/电台/雷沃/华测）
    const after = text.slice(start + raw.length);
    const suf = after.match(CN_SUFFIX_RE);
    if (suf) raw = raw + suf[1];
    const cleaned = raw.trim().replace(/[._]+$/, '');
    if (!cleaned) continue;
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    // 从长到短生成候选
    for (let take = tokens.length; take >= 1; take--) {
      out.push({ text: tokens.slice(0, take).join(' '), start, end: start + cleaned.length, raw: cleaned });
    }
  }
  // 去重，长的优先，包含位置用于算 question
  const seen = new Set();
  return out.filter((c) => {
    const key = c.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.text.length - a.text.length);
}

/**
 * @param {string} input rawInput
 * @param {Array} models dataset.models
 */
export function parseQuery(input, models) {
  const text = String(input ?? '').trim();
  if (!text) return { modelText: '', question: '', intent: 'help' };
  if (SYNC_RE.test(text)) return { modelText: '', question: text, intent: 'sync' };
  const cands = modelCandidates(text);
  for (const c of cands) {
    const { hit, scored } = resolveModel(c.text, models);
    if (hit) {
      const question = (text.slice(0, c.start) + ' ' + text.slice(c.end)).replace(/\s+/g, ' ').trim();
      return { modelText: c.text, question, intent: 'query', hit, scored };
    }
  }
  if (CATALOG_RE.test(text)) return { modelText: '', question: text, intent: 'catalog' };
  // 没有唯一命中：把最有希望的候选带出去，交给上层决定「列候选」还是「同值合并」
  for (const c of cands) {
    const r = resolveModel(c.text, models);
    if (r.scored.length) {
      return { modelText: c.text, question: text, intent: 'ambiguous', candidates: r.scored.slice(0, 6) };
    }
  }
  return { modelText: '', question: text, intent: 'help' };
}
