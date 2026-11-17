#!/usr/bin/env node
/**
 * 图片检索 CLI：不经过 agent，直接从 .cpdocs/images.json 查「某机型有哪些图、各是干什么的、文件在哪」。
 *
 *   node scripts/cp-docs-images.mjs TANK2
 *   node scripts/cp-docs-images.mjs TANK2 --grep 线束
 *   node scripts/cp-docs-images.mjs TANK2 --json
 *   node scripts/cp-docs-images.mjs --list          # 只列机型与图片数
 *
 * --grep 与 cp_docs_images 的 keyword 同义（支持同义词：接线/针脚/孔位/原理…）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, workspaceRoot } from './lib/paths.mjs';
import { searchImages, resolveImageRoot, locateImage, suggestName } from '../src/docs/lib/image-index.js';

function arg(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const json = process.argv.includes('--json');
const listOnly = process.argv.includes('--list');
const grep = arg('grep');
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const modelQuery = (positional[0] || '').trim();

const dir = dataDir(['DSH_CPDOCS_DIR'], '.cpdocs');
if (!dir || !fs.existsSync(path.join(dir, 'models.json'))) {
  console.error('没有找到 .cpdocs（先运行 node scripts/import-docs.mjs，或用 DSH_CPDOCS_DIR 指定）。');
  process.exit(2);
}

const indexFile = path.join(dir, 'images.json');
if (!fs.existsSync(indexFile)) {
  console.error(`没有图片索引：${indexFile}`);
  console.error('重建：node scripts/import-docs.mjs');
  process.exit(2);
}

const images = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const dataset = JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8'));
const root = resolveImageRoot({ dataDir: dir, index: images, workspace: workspaceRoot() });

if (listOnly || !modelQuery) {
  const rows = dataset.models
    .map((m) => {
      const e = images.byModel?.[m.id];
      return { id: m.id, model: m.model, count: e?.images?.length ?? 0, missing: e?.missing ?? 0 };
    })
    .filter((r) => !listOnly || r.count > 0);
  if (json) {
    console.log(JSON.stringify({ imageRoot: root, models: rows }, null, 1));
    process.exit(0);
  }
  console.log(`图片根目录：${root || '⚠ 未找到'}`);
  console.log(`共 ${rows.length} 款机型，${images.total} 条记录，缺文件 ${images.missing}`);
  for (const r of rows) console.log(`- ${r.id} ${r.model}：${r.count} 张${r.missing ? `（缺 ${r.missing}）` : ''}`);
  if (!modelQuery) {
    console.log('\n用法：node scripts/cp-docs-images.mjs <机型> [--grep 线束] [--json]');
  }
  process.exit(0);
}

// 机型归一沿用插件里的同一套解析（拉丁串 + 别名/CP 编码）
const { resolveModel } = await import('../src/docs/lib/models.js');
const { hit, scored } = resolveModel(modelQuery, dataset.models);
if (!hit) {
  console.error(`没认出机型「${modelQuery}」。候选：`);
  for (const [, g] of scored.slice(0, 6)) console.error(`- ${g.id} ${g.model}`);
  process.exit(1);
}

const entry = images.byModel?.[hit.id];
if (!entry) {
  console.error(`${hit.id} ${hit.model} 没有图片记录（索引可能过期）。重建：node scripts/import-docs.mjs`);
  process.exit(1);
}

const hits = searchImages(entry.images, grep, 50);
const rows = hits.map((img) => {
  const loc = locateImage(img, root);
  return {
    idx: img.idx,
    caption: img.caption,
    section: img.section,
    purpose: img.purpose,
    tags: img.tags,
    sha8: img.sha8,
    path: loc.path || '',
    exists: loc.exists,
    via: loc.via,
    deliverAs: suggestName(hit.model, img),
  };
});

if (json) {
  console.log(JSON.stringify({ model: `${hit.id} ${hit.model}`, keyword: grep, imageRoot: root, total: entry.images.length, count: rows.length, images: rows }, null, 1));
  process.exit(0);
}

console.log(`${hit.id} ${hit.model}：共 ${entry.images.length} 张${grep ? `，关键词「${grep}」命中 ${rows.length}` : ''}`);
console.log(`图片根目录：${root || '⚠ 未找到'}`);
for (const r of rows) {
  console.log(`\n[${r.idx.toString().padStart(2, '0')}] ${r.caption || r.sha8}${r.section ? `（${r.section}）` : ''}`);
  console.log(`  作用：${r.purpose}`);
  if (r.tags?.length) console.log(`  标签：${r.tags.join(' / ')}`);
  console.log(`  文件：${r.exists ? r.path : '⚠ 缺失'}${r.via === 'store' ? '（store 原文件）' : ''}`);
  console.log(`  建议名：${r.deliverAs}`);
}
