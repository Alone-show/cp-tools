#!/usr/bin/env node
/**
 * 产品资料导入：work/cpdoc/ai-readable → .cpdocs（运行期数据）。
 *
 *   node scripts/import-docs.mjs
 *   node scripts/import-docs.mjs --src /path/to/ai-readable --out /path/to/.cpdocs
 *   node scripts/import-docs.mjs --check
 *
 * 导入是确定性的：只读源目录，写出 models.json / fields.json / models/<id>/*.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importData } from '../src/docs/lib/import.js';
import { dataDir, workspaceRoot } from './lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const check = process.argv.includes('--check');
const src = path.resolve(arg('src', path.join(workspaceRoot(), 'work', 'cpdoc', 'ai-readable')));
const out = path.resolve(arg('out', dataDir(['DSH_CPDOCS_DIR'], '.cpdocs') ?? path.join(process.cwd(), '.cpdocs')));

if (!fs.existsSync(src)) {
  console.error(`源目录不存在：${src}`);
  console.error('用 --src 指定 AI 可读资料目录（包含 *.json / *.md 的 specs 目录）。');
  process.exit(2);
}

if (check) {
  const modelsFile = path.join(out, 'models.json');
  const imagesFile = path.join(out, 'images.json');
  const sourceCount = fs.readdirSync(src).filter((f) => f.endsWith('.json')).length;
  const current = fs.existsSync(modelsFile) ? (JSON.parse(fs.readFileSync(modelsFile, 'utf8')).models ?? []).length : 0;
  console.log(`源 JSON：${sourceCount} 个；现有 ${modelsFile}：${current} 款机型`);
  if (fs.existsSync(imagesFile)) {
    const idx = JSON.parse(fs.readFileSync(imagesFile, 'utf8'));
    console.log(
      `图片索引：${idx.models} 款 / ${idx.total} 条记录 / 缺文件 ${idx.missing}`
        + `${idx.hasManifest ? '' : '（无 manifest，线束外观图等可能缺失）'}`
        + `；imageRoot=${idx.imageRoot}`,
    );
  } else {
    console.log('图片索引：缺 images.json（去 --check 运行导入即可生成）');
  }
  console.log(fs.existsSync(modelsFile) ? '数据已存在；如需重建，去掉 --check 再运行。' : '尚无运行期数据，去掉 --check 运行导入。');
  process.exit(0);
}

const started = Date.now();
importData({
  src,
  out,
  log: (msg) => console.log(`· ${msg}`),
});
const models = JSON.parse(fs.readFileSync(path.join(out, 'models.json'), 'utf8')).models ?? [];
const images = fs.existsSync(path.join(out, 'images.json'))
  ? JSON.parse(fs.readFileSync(path.join(out, 'images.json'), 'utf8'))
  : null;
console.log(`✓ 导入完成：${models.length} 款机型 → ${out}（${Date.now() - started}ms）`);
if (images) console.log(`  图片索引：${images.total} 条记录（缺文件 ${images.missing}）→ images.json / images.md`);
console.log('  下一步：node scripts/check-package.mjs 校验包内数据。');
