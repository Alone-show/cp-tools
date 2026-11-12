#!/usr/bin/env node
/**
 * 固定同步流程：TB 看板/子任务、alist commit 索引、产品资料。
 *
 *   node scripts/sync.mjs --docs
 *   node scripts/sync.mjs --tb [--force]
 *   node scripts/sync.mjs --fix [--only SP2-10PRO] [--force]
 *   node scripts/sync.mjs --all
 *
 * 通过真实的工具定义执行（与模型调用同一条路径），数据目录仍走
 * DSH_TBFW_DIR / DSH_FIXFINDER_DIR / 工作区 .tbfw / .fixfinder。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply as applyTickets } from '../src/tickets/index.js';
import { importData } from '../src/docs/lib/import.js';
import { dataDir, workspaceRoot } from './lib/paths.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const tbfw = dataDir(['DSH_TBFW_DIR', 'DSH_FIRMWARE_DIR'], '.tbfw');
const fixfinder = dataDir(['DSH_FIXFINDER_DIR'], '.fixfinder');
if (!process.env.DSH_TBFW_DIR && tbfw) process.env.DSH_TBFW_DIR = tbfw;
if (!process.env.DSH_FIXFINDER_DIR && fixfinder) process.env.DSH_FIXFINDER_DIR = fixfinder;

const tools = [];
const ctx = {
  get: () => undefined,
  effect: (fn) => {
    fn();
    return () => {};
  },
  on: () => () => {},
  tools: {
    register(definition) {
      tools.push(definition);
      return () => {};
    },
  },
  skills: { register: () => () => {} },
};
applyTickets(ctx);

function tool(name) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`未注册工具 ${name}`);
  return found;
}

async function runTool(name, args) {
  const started = Date.now();
  const result = await tool(name).execute(args, { agent: undefined, signal: undefined });
  return { result, ms: Date.now() - started };
}

const doDocs = argv.has('--docs') || argv.has('--all');
const doTb = argv.has('--tb') || argv.has('--all');
const doFix = argv.has('--fix') || argv.has('--all');
if (!doDocs && !doTb && !doFix) {
  console.error('用法：node scripts/sync.mjs --docs | --tb | --fix | --all [--only <片段>] [--force]');
  process.exit(2);
}

let failed = false;

if (doDocs) {
  const src = path.resolve(arg('src', path.join(workspaceRoot(), 'work', 'cpdoc', 'ai-readable')));
  const out = path.resolve(arg('out', dataDir(['DSH_CPDOCS_DIR'], '.cpdocs') ?? path.join(process.cwd(), '.cpdocs')));
  try {
    const started = Date.now();
    importData({ src, out, log: (m) => console.log(`· ${m}`) });
    console.log(`✓ docs 导入：${out}（${Date.now() - started}ms）`);
  } catch (err) {
    failed = true;
    console.error(`✗ docs 导入失败：${err.message}`);
  }
}

if (doTb) {
  try {
    const { result, ms } = await runTool('ticket_sync', {
      issues: true,
      force: argv.has('--force'),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'ok') {
      failed = true;
      console.error(`✗ TB 同步未完成：${result.status} ${result.reason ?? ''}`);
    } else {
      console.log(`✓ TB 同步完成（${ms}ms）`);
    }
  } catch (err) {
    failed = true;
    console.error(`✗ TB 同步失败：${err.stack || err.message}`);
  }
}

if (doFix) {
  try {
    const { result, ms } = await runTool('ticket_bug_sync', {
      force: argv.has('--force'),
      ...(arg('only', '') ? { only: arg('only', '') } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status !== 'ok') {
      failed = true;
      console.error(`✗ commit 索引同步失败：${result.message ?? result.status}`);
    } else {
      console.log(`✓ commit 索引同步完成（${ms}ms）`);
    }
  } catch (err) {
    failed = true;
    console.error(`✗ commit 索引同步失败：${err.stack || err.message}`);
  }
}

process.exit(failed ? 1 : 0);
