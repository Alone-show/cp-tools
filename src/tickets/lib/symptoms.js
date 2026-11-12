/**
 * 现象口语归一与打分。
 *
 * 用户描述工单时很少用和标题一样的词（「上不去网」vs「无法上网」，「出现两个卡」vs
 * 「出现两张」）。这里把常见同义说法折成 canonical 词，再对这些变体分别打分取最高，
 * 既提高召回，也把命中词打出来供人工判断。
 */
import { nlScore, bigrams } from './bug/nl.js';
import { nz } from './bug/parse.js';

/** canonical -> 口语变体（按长度从长到短替换，避免「两个卡」先被「两个」吃掉） */
export const SYMPTOM_ALIASES = {
  无法上网: ['上不去网', '上不了网', '连不上网', '不能上网', '无法联网', '上不了网络'],
  无网络: ['没网', '无网', '没有网络', '网络异常'],
  双卡: ['两个卡', '两张卡', '出现两个', '出现两张', '俩卡', '两个sim', '两张sim'],
  单卡: ['一张卡', '单个卡', '单sim'],
  断连: ['断线', '掉线', '断开', '老是断'],
  死机: ['卡死', '黑屏死机', '不能动'],
};

const REPLACEMENTS = Object.entries(SYMPTOM_ALIASES).flatMap(([canonical, variants]) =>
  variants.map((variant) => [variant, canonical]),
);

/** 把口语变体替换成 canonical 词（查询和文档都做，才能对齐「出现两张」与「双卡」） */
export function canonicalize(text) {
  let out = String(text ?? '');
  for (const [variant, target] of REPLACEMENTS) out = out.split(variant).join(target);
  return out;
}

/** 原始现象 + canonical 串 + 出现的 canonical 词，去重保序 */
export function expandSymptom(query) {
  const raw = String(query ?? '').trim();
  if (!raw) return [];
  const out = [raw];
  const canonical = canonicalize(raw).replace(/\s+/g, ' ').trim();
  if (canonical && canonical !== raw) out.push(canonical);
  for (const canonicalWord of Object.keys(SYMPTOM_ALIASES)) {
    if (canonical.includes(canonicalWord)) out.push(canonicalWord);
  }
  return [...new Set(out)];
}

/**
 * 现象 vs 文本的最优匹配。
 * @returns {{score:number,hits:string[],ratio:number,substring:boolean,variant:string}}
 */
export function matchScore(query, text) {
  const subject = String(text ?? '');
  const candidates = expandSymptom(query);
  let best = { score: 0, hits: [], ratio: 0, substring: false, variant: '', concepts: [] };
  const canonicalSubject = canonicalize(subject);
  const concepts = Object.keys(SYMPTOM_ALIASES).filter((word) => nz(canonicalize(query)).includes(nz(word)));
  for (const q of candidates) {
    const qCanon = canonicalize(q);
    const qq = nz(qCanon);
    const tt = nz(canonicalSubject);
    if (!qq || !tt) continue;
    const qb = bigrams(qq);
    const tb = new Set(bigrams(tt));
    const hits = [...new Set(qb.filter((b) => tb.has(b)))];
    const ratio = qb.length ? hits.length / qb.length : 0;
    const substring = tt.includes(qq);
    const hitConcepts = concepts.filter((word) => tt.includes(nz(word)));
    let score = nlScore(qCanon, canonicalSubject);
    if (substring) score += 200;
    score += Math.round(ratio * 120);
    // 同时命中「单卡/双卡 + 无法上网」这类多个症状概念的，优先于只命中一个泛词的
    score += hitConcepts.length * 60;
    // 「出现两张/两个卡」这种措辞本身很像工单标题，单独加一点分，避免被同义归一淹没
    const surface = /出现两个|出现两张|两个卡|两张卡/;
    if (surface.test(query) && surface.test(subject)) score += 100;
    if (score > best.score) {
      best = { score, hits: hits.slice(0, 8), ratio, substring, variant: q, concepts: hitConcepts };
    }
  }
  return best;
}

/** 工单检索阈值：比子任务口径更宽松，因为用户给的是口语描述 */
export function taskMatches(scored) {
  return scored.substring || scored.ratio >= 0.34 || scored.score >= 100;
}
