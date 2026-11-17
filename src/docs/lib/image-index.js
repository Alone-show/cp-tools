/**
 * 图片索引：把「抓取清单（manifest.json）」和「结构化转写（spec.json）」按 sha256 合并成
 * 每条机型一份可检索的图片清单，并解决运行时路径。
 *
 * 为什么必须两份合并：
 *   - spec 只收「转写过表/图内文字」的图，线束外观图、正面/背面图被降级进 skipped（或干脆没记录）；
 *   - manifest 收的是页面上出现过的全部图（含未转写），但没有作用说明，category 还有已知误判。
 * 合并后：manifest 保证「一张不漏」，spec 保证「标题/作用/针脚数据准确」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { purposeFor, mergeOverride, KEYWORD_SYNONYMS } from './image-purpose.js';

const SLUG_RE = /[\\/:*?"<>|\s]+/g;
const NAMED_RE = /^(\d{2})-([0-9a-f]{8})-/i;

export function slugModel(name) {
  return String(name ?? '').trim().replace(SLUG_RE, '-');
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function addUniq(list, value) {
  const v = clean(value);
  if (v && !list.includes(v)) list.push(v);
}

/** spec → Map(sha256 → { captions, sections, titles, kind, category, reason, isTable }) */
function collectSpecImages(spec) {
  const map = new Map();
  const put = (rec, kind, isTable, reason) => {
    const sha = rec?.sha256;
    if (!sha) return;
    if (!map.has(sha)) {
      map.set(sha, { captions: [], sections: [], titles: [], kind: '', category: '', reason: '', isTable: false });
    }
    const it = map.get(sha);
    addUniq(it.captions, rec.caption);
    addUniq(it.sections, rec.section);
    addUniq(it.titles, rec.title);
    if (kind && !it.kind) it.kind = kind;
    if (rec.category && !it.category) it.category = rec.category;
    if (reason) it.reason = reason;
    if (isTable) it.isTable = true;
  };
  for (const t of spec?.tables || []) put(t, t.kind || 'interface', true);
  for (const f of spec?.figures || []) put(f, f.kind || 'drawing', false);
  for (const s of spec?.skipped || []) put(s, 'skipped', false, s.reason);
  return map;
}

/** 扫机型硬链接目录，拿到 sha8 → 已命名文件（build_manifest.py 的 NN-sha8-原名 约定） */
function scanNamedFiles(imageRoot, dirName) {
  const dir = path.join(imageRoot, dirName);
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const m = name.match(NAMED_RE);
    if (!m) continue;
    const sha8 = m[2].toLowerCase();
    if (!out.has(sha8)) out.set(sha8, path.join('images', dirName, name));
  }
  return out;
}

/**
 * @param {object}   p
 * @param {object?}  p.manifest   work/cpdoc/manifest.json（可为 null：降级为 spec-only）
 * @param {Array}    p.specs      [{ file, data }]（data 为 spec.json 内容）
 * @param {string}   p.srcRoot    ai-readable 根目录（其下有 images/）
 * @param {object?}  p.overrides  Figure purpose 覆盖表：sha256 → { purpose, tags }
 * @param {string?}  p.purposeDoc 规则标识（写进索引，便于判断是否需要重建）
 */
export function buildImageIndex({
  manifest,
  specs = [],
  srcRoot,
  overrides = {},
  purposeDoc = 'image-purpose.js v1',
  recordAbsRoot = true,
}) {
  const imageRoot = path.join(srcRoot, 'images');
  const storeExists = (rel) => {
    if (!rel) return false;
    return fs.existsSync(path.join(srcRoot, rel));
  };

  // manifest：按机型分组的全部出现（同机型同 sha 只留最小 idx）
  const byModel = new Map();
  for (const rec of manifest?.records || []) {
    const no = rec.no;
    if (!no) continue;
    if (!byModel.has(no)) byModel.set(no, []);
    byModel.get(no).push(rec);
  }

  const metaByName = new Map();
  for (const m of manifest?.models || []) metaByName.set(m.no, m);

  const models = {};
  let total = 0;
  let missing = 0;

  for (const { data: spec } of specs) {
    if (!spec?.no) continue;
    const no = spec.no;
    const dirName = `${no}-${slugModel(spec.model)}`;
    const specImages = collectSpecImages(spec);
    const named = scanNamedFiles(imageRoot, dirName);

    const rows = [];
    const seen = new Set();

    const pushRow = (base, idx) => {
      const sha = base.sha256;
      if (seen.has(sha)) return;
      seen.add(sha);
      const specHit = specImages.get(sha);
      const captions = [];
      for (const c of specHit?.captions || []) addUniq(captions, c);
      if (!captions.length) addUniq(captions, base.caption);
      const sections = [];
      for (const s of specHit?.sections || []) addUniq(sections, s);
      if (!sections.length) addUniq(sections, base.heading);
      const titles = [];
      for (const t of specHit?.titles || []) addUniq(titles, t);

      const kind = specHit?.kind || '';
      const category = specHit?.category || base.category || '';
      const purposeBase = purposeFor({
        kind,
        category,
        caption: captions[0] || '',
        section: sections[0] || '',
        title: titles[0] || '',
        reason: specHit?.reason || '',
      });
      const purpose = mergeOverride(purposeBase, overrides?.[sha]);

      const sha8 = sha.slice(0, 8);
      const storeFile = base.file || `images/store/${sha}.png`;
      const namedFile = named.get(sha8) || '';
      const exists = storeExists(storeFile) || (namedFile ? storeExists(namedFile) : false);
      if (!exists) missing += 1;

      rows.push({
        idx,
        sha256: sha,
        sha8,
        caption: captions[0] || '',
        captions,
        title: titles[0] || '',
        section: sections[0] || '',
        sections,
        kind: kind || (specHit ? 'skipped' : ''),
        category,
        purpose: purpose.purpose,
        tags: purpose.tags,
        detectedBy: purpose.detectedBy,
        confidence: purpose.confidence,
        storeFile,
        namedFile,
        width: base.width ?? 0,
        height: base.height ?? 0,
        bytes: base.bytes ?? 0,
        src: base.src || '',
        missing: !exists,
      });
    };

    const records = (byModel.get(no) || [])
      .slice()
      .sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
    for (const rec of records) pushRow(rec, rec.idx ?? rows.length);

    // spec 里有、manifest 里没有（抓取清单缺失/过期）：补进来，排在后面
    let extra = 1000;
    for (const [sha, hit] of specImages) {
      if (seen.has(sha)) continue;
      const known = rows.find((r) => r.sha256 === sha);
      if (known) continue;
      pushRow(
        {
          sha256: sha,
          caption: hit.captions[0] || '',
          heading: hit.sections[0] || '',
          category: hit.category || '',
          file: `images/store/${sha}.png`,
        },
        extra++,
      );
    }

    rows.sort((a, b) => (a.idx ?? 0) - (b.idx ?? 0));
    total += rows.length;
    models[no] = {
      no,
      model: spec.model,
      family: spec.family || '',
      dir: dirName,
      page: metaByName.get(no)?.page || spec.doc_url || '',
      imageCount: rows.length,
      missing: rows.filter((r) => r.missing).length,
      images: rows,
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'work/cpdoc/ai-readable（manifest.json + specs/*.json）',
    srcRoot: recordAbsRoot ? srcRoot : '',
    // 随包数据不记绝对路径（换机会误导）；工作区数据记下来，运行时优先用它
    imageRoot: recordAbsRoot ? imageRoot : '',
    imageRootRel: 'images',
    purposeDoc,
    hasManifest: Boolean(manifest),
    models: Object.keys(models).length,
    total,
    missing,
    byModel: models,
  };
}

/* ------------------------------------------------------------------ *
 * 运行时：路径解析 + 检索
 * ------------------------------------------------------------------ */

/**
 * 图片根目录解析顺序：环境变量 → 索引记录的绝对路径 → 数据目录内 → 包内数据 → 会话工作区。
 * 返回绝对路径或 null（找不到时调用方应报 missing，而不是静默跳过）。
 */
export function resolveImageRoot({ dataDir, index, env = process.env, workspace } = {}) {
  const candidates = [];
  if (env?.DSH_CPDOCS_IMAGES) candidates.push(env.DSH_CPDOCS_IMAGES);
  if (index?.imageRoot) candidates.push(index.imageRoot);
  if (dataDir) candidates.push(path.join(dataDir, 'images'));
  candidates.push(path.resolve(import.meta.dirname, '..', 'data', 'images'));
  if (workspace) candidates.push(path.join(workspace, 'work', 'cpdoc', 'ai-readable', 'images'));
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return path.resolve(c);
    } catch {
      /* 忽略不可读路径，继续下一个候选 */
    }
  }
  return null;
}

/** 单张图的实际路径：优先已命名的硬链接，其次 store 原文件 */
export function locateImage(image, root) {
  if (!root) return { path: null, exists: false, via: 'none' };
  const srcRoot = path.dirname(root);
  const named = image.namedFile ? path.join(srcRoot, image.namedFile) : null;
  if (named && fs.existsSync(named)) return { path: named, exists: true, via: 'named' };
  const rel = image.storeFile ? path.relative('images', image.storeFile) : '';
  const store = rel ? path.join(root, rel) : null;
  if (store && fs.existsSync(store)) return { path: store, exists: true, via: 'store' };
  return { path: named || store, exists: false, via: 'missing' };
}

/** 建议文件名：<机型>-<章节号>-<标题>.png（去掉「图」前缀与非法字符） */
export function suggestName(model, image) {
  const modelSlug = slugModel(model) || 'CP';
  const caption = clean(image.caption || image.captions?.[0] || '').replace(/^图\s*/, '');
  const secMatch = caption.match(/^([\d.]+)\s+(.*)$/);
  const sec = secMatch ? secMatch[1] : clean(image.section).match(/^[\d.]+/)?.[0] || '';
  const rest = secMatch ? secMatch[2] : caption;
  const base = [modelSlug, sec, rest].filter(Boolean).join('-');
  const safe = (base || `${modelSlug}-${String(image.idx ?? 0).padStart(2, '0')}`)
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120);
  return `${safe}.png`;
}

/** 关键词检索：命中标题/章节/作用/标签；同义词见 image-purpose.KEYWORD_SYNONYMS */
export function searchImages(images = [], keyword = '', limit = 20) {
  const q = clean(keyword);
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50);
  if (!q) return images.slice(0, cap);

  const tokens = q.split(/[\s,，、/]+/).filter(Boolean);
  const expanded = new Set();
  for (const t of tokens) {
    expanded.add(t);
    for (const s of KEYWORD_SYNONYMS[t] || []) expanded.add(s);
  }

  const scored = [];
  for (const img of images) {
    const hay = [
      img.caption,
      img.title,
      ...(img.captions || []),
      img.section,
      ...(img.sections || []),
      img.purpose,
      ...(img.tags || []),
    ]
      .join(' ')
      .toLowerCase();
    let score = 0;
    for (const t of expanded) if (t && hay.includes(t.toLowerCase())) score += 1;
    if (score > 0) scored.push({ img, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.img.idx ?? 0) - (b.img.idx ?? 0));
  return scored.slice(0, cap).map((x) => x.img);
}

/** 人读索引（.cpdocs/images.md）：按机型列表，可直接 grep/编辑器查看 */
export function renderImageIndexMarkdown(index) {
  const lines = [
    '# 产品图片索引（自动生成，勿手改）',
    '',
    `- 生成时间：${index.generatedAt}`,
    `- 来源：${index.source}`,
    `- 图片根目录：\`${index.imageRoot}\``,
    `- 规模：${index.models} 款机型 / ${index.total} 条记录 / 缺文件 ${index.missing}`,
    index.hasManifest ? '' : '- ⚠ 未找到 manifest.json，本索引仅覆盖已转写的图（线束外观图等可能缺失）',
    '',
    '作用列由 `image-purpose.js` 按标题模板生成；逐张覆盖写在 `ai-readable/figure-purpose.json`。',
    '',
  ];
  const ids = Object.keys(index.byModel).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  for (const id of ids) {
    const m = index.byModel[id];
    lines.push(`## ${id} ${m.model}（${m.images.length} 张${m.missing ? `，缺 ${m.missing}` : ''}）`, '');
    lines.push('| # | 图号 / 标题 | 作用 | 标签 | 文件 |');
    lines.push('|---|---|---|---|---|');
    for (const img of m.images) {
      const title = img.caption || '（无标题）';
      const file = img.namedFile || img.storeFile || '';
      lines.push(
        `| ${String(img.idx).padStart(2, '0')} | ${title} | ${img.purpose} | ${(img.tags || []).join(' / ')} | \`${file}\` |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}
