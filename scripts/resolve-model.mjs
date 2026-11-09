#!/usr/bin/env node
/**
 * 机型归一排查：对 docs / TB 看板 / alist 产品线三套目录分别打分。
 *
 *   node scripts/resolve-model.mjs SPRING2PRO --catalog docs
 *   node scripts/resolve-model.mjs APOLLO2-7A --catalog tb
 *   node scripts/resolve-model.mjs SP2-10PRO --catalog alist
 *
 * 数据目录优先读环境变量，其次从 cwd 向上找 .cpdocs / .tbfw / .fixfinder。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function findUp(name, start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function dataDir(envName, subdir) {
  if (process.env[envName]) return path.resolve(process.env[envName]);
  return findUp(subdir);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const query = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '';
const catalog = arg('catalog', 'docs');
if (!query) {
  console.error('用法：node scripts/resolve-model.mjs <机型> --catalog docs|tb|alist');
  process.exit(2);
}

if (catalog === 'docs') {
  const { resolveModel, canonModel } = await import('../src/docs/lib/models.js');
  const dir = dataDir('DSH_CPDOCS_DIR', '.cpdocs') ?? path.join(ROOT, 'src/docs/data');
  const models = readJson(path.join(dir, 'models.json')).models ?? [];
  const normalized = canonModel(query);
  const { hit, scored } = resolveModel(query, models);
  console.log(`catalog: docs (${dir})`);
  console.log(`normalized: vendor=${normalized.vendor || '-'} core=${normalized.core}`);
  console.log(`hit: ${hit ? `${hit.id} ${hit.model}` : 'none'}`);
  for (const [score, m] of scored.slice(0, 6)) console.log(`  ${String(score).padStart(3)}  ${m.id} ${m.model}`);
} else if (catalog === 'tb') {
  const { __internals } = await import('../src/firmware/index.js');
  const dir = dataDir('DSH_TBFW_DIR', '.tbfw') ?? dataDir('DSH_FIRMWARE_DIR', '.tbfw');
  if (!dir) {
    console.error('找不到 .tbfw（可用 DSH_TBFW_DIR 指定）');
    process.exit(2);
  }
  const boardFile = fs.readdirSync(dir).find((f) => /^board-.*\.json$/.test(f));
  if (!boardFile) {
    console.error(`找不到 ${path.join(dir, 'board-*.json')}，先运行 npm run sync -- --tb`);
    process.exit(2);
  }
  const board = readJson(path.join(dir, boardFile));
  const groups = __internals.modelGroups(board);
  const normalized = __internals.canonModel(query);
  const result = __internals.resolveModel(query, groups);
  console.log(`catalog: tb (${path.join(dir, boardFile)})`);
  console.log(`normalized: vendor=${normalized.vendor || '-'} core=${normalized.core}`);
  console.log(`hit: ${result.hit ? result.hit.name : 'none'}${result.variant ? ` variant=${result.variant.label}` : ''}`);
  for (const [score, g] of (result.scored ?? []).slice(0, 6)) {
    console.log(`  ${String(score).padStart(3)}  ${g.name}${g.aliases?.length ? ` (${g.aliases.join(' / ')})` : ''}`);
  }
} else if (catalog === 'alist') {
  const { resolveModel } = await import('../src/firmware/lib/fix/models.js');
  const dir = dataDir('DSH_FIXFINDER_DIR', '.fixfinder');
  if (!dir || !fs.existsSync(path.join(dir, 'index.json'))) {
    console.error('找不到 .fixfinder/index.json，先运行 npm run sync -- --fix');
    process.exit(2);
  }
  const index = readJson(path.join(dir, 'index.json'));
  const result = resolveModel(index, { model: query });
  console.log(`catalog: alist (${path.join(dir, 'index.json')})`);
  console.log(`status: ${result.status}`);
  if (result.resolved) console.log(`hit: ${result.resolved.platform} / ${result.resolved.product}`);
  for (const c of result.candidates ?? []) {
    console.log(`  ${String(c.score).padStart(3)}  ${c.platform} / ${c.product}${c.matchKind ? ` (${c.matchKind})` : ''}`);
  }
} else {
  console.error(`未知 catalog: ${catalog}（可选 docs / tb / alist）`);
  process.exit(2);
}
