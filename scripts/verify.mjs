#!/usr/bin/env node
/**
 * 一条命令跑完合并包的全部离线验证。
 *
 *   node scripts/verify.mjs          # 离线（默认）
 *   node scripts/verify.mjs --live   # 追加在线冒烟（无凭据/断网时 SKIP）
 *   node scripts/verify.mjs --fast   # 跳过 firmware 全量套件，只跑契约 + docs + cpservice + flash
 *
 * 退出码 0 表示全部通过；任何一步失败都会打印失败命令的尾部输出并返回 1。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const fast = args.has('--fast');
const live = args.has('--live');

const baseEnv = {
  ...process.env,
  DSH_FIRMWARE_NO_PROBE: '1',
  DSH_ALIST_DISABLE: '1',
};

const steps = [
  { name: 'shared + contract', cmd: ['node', '--test', 'test/shared/*.test.mjs', 'test/contract/*.test.mjs'] },
  { name: 'docs', cmd: ['node', '--test', 'test/docs/*.test.mjs'] },
  { name: 'cpservice smoke', cmd: ['node', 'test/cpservice/smoke.mjs'] },
  { name: 'flash smoke', cmd: ['node', 'test/flash/smoke.mjs'] },
];

if (!fast) {
  steps.push(
    { name: 'firmware gate', cmd: ['node', 'test/firmware/gate-smoke.mjs'] },
    { name: 'firmware model', cmd: ['node', 'test/firmware/model-resolve.test.mjs'] },
    { name: 'firmware alist', cmd: ['node', 'test/firmware/alist.test.mjs'] },
    { name: 'firmware suite', cmd: ['node', '--test', 'test/firmware/*.test.mjs'] },
  );
}

let failed = 0;
for (const step of steps) {
  process.stdout.write(`\n▶ ${step.name}\n`);
  const started = Date.now();
  const result = spawnSync(step.cmd[0], step.cmd.slice(1), {
    cwd: ROOT,
    env: baseEnv,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  const ms = Date.now() - started;
  if (result.status === 0) {
    console.log(`✓ ${step.name} (${ms}ms)`);
    continue;
  }
  failed += 1;
  console.error(`✗ ${step.name} (${ms}ms, exit ${result.status})`);
  const out = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trimEnd().split('\n');
  console.error(out.slice(-30).join('\n'));
}

if (live) {
  process.stdout.write('\n▶ live smoke\n');
  const result = spawnSync('node', ['scripts/live-smoke.mjs'], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`\n${failed} 个步骤失败`);
  process.exit(1);
}
console.log('\n全部离线验证通过');
