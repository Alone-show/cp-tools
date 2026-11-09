/**
 * 数据目录与加载：.cpdocs（会话工作区）→ DSH_CPDOCS_DIR → 默认目录 → cwd。
 * 加载结果按 mtime 缓存。
 */
import fs from 'node:fs';
import path from 'node:path';
import { importData } from './import.js';
import { candidateDirs, findExistingDir, resolveWritableDir, copyDir } from '../../shared/data-dir.js';

const PKG_ROOT = path.resolve(import.meta.dirname, '..');
const BUNDLED_DATA = path.join(PKG_ROOT, 'data');

const cache = new Map();

export async function resolveDataDir(ctx, agent, signal) {
  const candidates = await candidateDirs(ctx, { agent, signal }, {
    envNames: ['DSH_CPDOCS_DIR'],
    subdir: '.cpdocs',
  });
  const existing = findExistingDir(candidates, 'models.json');
  if (existing) return existing;

  const dir = candidates[0];
  // 仓库自带 data/：首次使用复制到会话工作区 .cpdocs（失败则直接只读使用包内数据）
  if (fs.existsSync(path.join(BUNDLED_DATA, 'models.json'))) {
    try {
      await resolveWritableDir([dir], () => copyDir(BUNDLED_DATA, dir));
      return dir;
    } catch {
      return BUNDLED_DATA;
    }
  }
  // 没有自带数据时尝试就地导入（首次使用）
  const wd = ctx?.get?.('workingDirectory');
  const src = wd?.defaultDirectory
    ? path.join(wd.defaultDirectory, 'work', 'cpdoc', 'ai-readable')
    : path.resolve('work/cpdoc/ai-readable');
  if (fs.existsSync(src)) {
    await resolveWritableDir([dir]);
    importData({ src, out: dir });
    return dir;
  }
  throw new Error(`没有本地资料索引（.cpdocs/models.json）。已查找：${candidates.join(' | ')}。请先运行：node scripts/import-docs.mjs`);
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

export function loadDataset(dir) {
  const file = path.join(dir, 'models.json');
  const st = fs.statSync(file);
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.dataset;
  const dataset = readJson(file);
  cache.set(file, { mtimeMs: st.mtimeMs, dataset });
  return dataset;
}

export function loadModelFiles(dir, entry) {
  const read = (rel) => (rel && fs.existsSync(path.join(dir, rel)) ? readJson(path.join(dir, rel)) : null);
  return { spec: read(entry.spec), programming: read(entry.programming), workpoints: read(entry.workpoints) };
}

const labelCache = new Map();

/** params_flat 键 → { label, unit }（fields.json）；缺失的键由渲染方回落键名 */
export function loadLabels(dir) {
  const file = path.join(dir, 'fields.json');
  if (!fs.existsSync(file)) return {};
  const st = fs.statSync(file);
  const hit = labelCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.labels;
  const data = readJson(file);
  const labels = {};
  for (const f of data?.fields || []) {
    if (f?.key) labels[f.key] = { label: f.label || f.key, unit: f.unit || '' };
  }
  labelCache.set(file, { mtimeMs: st.mtimeMs, labels });
  return labels;
}
