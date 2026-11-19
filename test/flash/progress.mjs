// 独立离线协议测试；所有 adb / USB / 下载 / 刷写工具均为临时假工具。
// node test/flash/progress.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../../src/flash/skills/flash/assets/flash.sh', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-progress-'));
const bin = path.join(root, 'bin');
fs.mkdirSync(bin);
const fake = path.join(bin, 'fake');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path');
const name = path.basename(process.argv[1]), args = process.argv.slice(2), env = process.env;
const delay = ms => new Promise(r => setTimeout(r, ms));
const state = () => fs.existsSync(env.STATE);
(async () => {
if (name === 'adb') {
  if (args[0] === 'devices') { console.log('List of devices attached'); if ((!env.NO_ADB || state()) && !(env.NEVER_RECONNECT && state())) console.log('fake\\tdevice'); return; }
  if (args[0] === '-s') args.splice(0,2);
  if (args[0] === 'get-state') { if (env.NEVER_RECONNECT && state()) process.exit(1); console.log('device'); return; }
  if (args[0] === 'reboot') return;
  const cmd = args.slice(1).join(' ');
  if (cmd.includes('os-release')) console.log(env.FAMILY === 't3' ? 'Buildroot' : 'Debian');
  else if (cmd.includes('boot_id')) console.log('fake-boot-id');
  else if (cmd.includes('Version=')) console.log(env.BAD_VERSION ? 'V9.99' : 'V1.23');
  else if (cmd.includes('is-system-running')) console.log('running');
  else if (cmd.includes('echo ok')) console.log('ok');
  return;
}
if (name === 'lsusb') { console.log(env.FAMILY === 't3' ? 'Bus 001 Device 002: ID 1f3a:efe8 Fake' : 'Bus 001 Device 002: ID 2207:330c Fake'); return; }
if (name === 'lsmod') return;
if (name === 'curl') {
  if (args.includes('-sIL')) { if (!env.UNKNOWN_SIZE) console.log('Content-Length: 4096\\r'); return; }
  const dest = args[args.indexOf('-o')+1];
  if (env.DOWNLOAD_FAIL || args.some(value => value.includes('bad.invalid'))) process.exit(22);
  fs.writeFileSync(dest, Buffer.concat([Buffer.from(env.FAMILY === 't3' ? 'IMAGEWTY' : 'RKFW'), Buffer.alloc(1024 - (env.FAMILY === 't3' ? 8 : 4))]));
  fs.writeFileSync(env.DOWNLOAD_PID, String(process.pid));
  console.error('FAKE_DOWNLOAD_STARTED');
  await delay(Number(env.DOWNLOAD_DELAY || 0));
  fs.appendFileSync(dest, Buffer.alloc(3072)); return;
}
if (name === 'sha256sum' && env.HASH_DELAY) await delay(Number(env.HASH_DELAY));
if (name === 'rk_upgrade_tool' || name === 'openixcli') {
  if (args[0] === 'LD') { console.log('List of rockusb connected(1)'); return; }
  if (args[0] === 'scan') { console.log('Found 1 device\\nBus 1, Port 2'); return; }
  fs.writeFileSync(env.TOOL_PID, String(process.pid));
  console.log('工具开始刷写');
  if (!env.NO_PERCENT) process.stdout.write('Download Image... 23%\\r');
  await delay(Number(env.FLASH_DELAY || 0));
  if (env.FLASH_FAIL) { console.log('Download Firmware Fail'); process.exit(7); }
  fs.writeFileSync(env.STATE, 'done');
  console.log(name === 'rk_upgrade_tool' ? 'Download Firmware Success' : 'All partitions flashed successfully');
}
})();
`);
fs.chmodSync(fake, 0o755);
for (const name of ['adb', 'lsusb', 'lsmod', 'curl', 'rk_upgrade_tool', 'openixcli']) fs.symlinkSync(fake, path.join(bin, name));
let count = 0;
const stages = new Set(['prepare', 'download', 'checksum', 'preflight', 'loader', 'flash', 'reconnect', 'verify', 'complete']);
function launch(options = {}) {
  const dir = path.join(root, `case-${++count}`);
  fs.mkdirSync(dir);
  const image = path.join(dir, 'CP_FAKE_D_V1.23.img');
  fs.writeFileSync(image, Buffer.concat([Buffer.from(options.env?.FAMILY === 't3' ? 'IMAGEWTY' : 'RKFW'), Buffer.alloc(4096)]));
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ADB: path.join(bin, 'adb'),
    FLASH_TOOLS_DIR: bin, RK_UPGRADE_TOOL: path.join(bin, 'rk_upgrade_tool'), OPENIXCLI: path.join(bin, 'openixcli'),
    DL_DIR: dir, STATE: path.join(dir, 'state'), TOOL_PID: path.join(dir, 'tool-pid'), DOWNLOAD_PID: path.join(dir, 'download-pid'), ...options.env };
  const log = path.join(dir, 'run.log');
  const args = [options.command || 'flash', ...(options.command === 'verify' ? [] : [options.url || image]),
    '--quiet', '--log', log, '--expect-version', 'V1.23', ...(options.progress === false ? [] : ['--progress-json']), ...(options.args || [])];
  const child = spawn('bash', [script, ...args], { env });
  let stdout = '', stderr = '';
  const events = [], timings = [], outputChunks = [];
  let buffered = '';
  child.stdout.on('data', data => { stdout += data; outputChunks.push({ text: String(data), time: Date.now() }); });
  child.stderr.on('data', data => {
    stderr += data;
    options.onStderr?.(String(data), child, dir);
    buffered += data;
    const lines = buffered.split('\n'); buffered = lines.pop();
    for (const line of lines) if (line.startsWith('FLASH_PROGRESS ')) {
      const event = JSON.parse(line.slice('FLASH_PROGRESS '.length));
      events.push(event); timings.push(Date.now());
      options.onEvent?.(event, child, dir);
    }
  });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`case timeout: ${stderr}`)); }, 45000);
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, events, timings, outputChunks, stdout, stderr, log, dir }); });
  });
  return result;
}
function validate(result, code = 0) {
  assert.equal(result.code, code, result.stderr);
  assert.ok(!result.stdout.includes('FLASH_PROGRESS '), '协议不得污染 stdout / 下载路径');
  for (const event of result.events) {
    assert.ok(stages.has(event.stage), JSON.stringify(event));
    assert.ok(['running', 'completed', 'failed'].includes(event.state));
    assert.ok(Number.isInteger(event.elapsedSeconds) && event.elapsedSeconds >= 0);
    assert.match(event.message, /[\u3400-\u9fff]/);
    if ('percent' in event) assert.ok(event.percent >= 0 && event.percent <= 100);
    for (const key of ['currentBytes', 'totalBytes']) if (key in event) assert.ok(Number.isInteger(event[key]) && event[key] >= 0);
  }
  assert.ok(result.events.length > 0);
  assert.ok(fs.readFileSync(result.log, 'utf8').includes('FLASH_PROGRESS '), '事件应落日志');
  if (code === 0) assert.deepEqual(result.events.at(-1).stage, 'complete');
  else assert.equal(result.events.at(-1).state, 'failed');
}
try {
  const ok = await launch(); validate(ok);
  assert.ok(ok.events.some(e => e.stage === 'flash' && e.percent === 23));
  assert.ok(!ok.events.some(e => e.stage === 'flash' && e.percent === 100), '不得伪造100%');
  for (const stage of ['prepare', 'checksum', 'preflight', 'loader', 'flash', 'reconnect', 'verify']) assert.ok(ok.events.some(e => e.stage === stage), stage);
  const noProgress = await launch({ progress: false });
  assert.equal(noProgress.code, 0); assert.equal(noProgress.events.length, 0);
  const silent = await launch({ env: { NO_PERCENT: '1', FLASH_DELAY: '11000' } }); validate(silent);
  const flashEvents = silent.events.filter(e => e.stage === 'flash' && e.state === 'running');
  assert.ok(flashEvents.length >= 2, '静默刷写至少10秒心跳');
  assert.ok(flashEvents.every(e => !('percent' in e)), '无工具百分比就省略');
  const toolStart = silent.outputChunks.find(chunk => chunk.text.includes('工具开始刷写'))?.time;
  const toolEnd = silent.timings[silent.events.findIndex(e => e.stage === 'flash' && e.state === 'completed')];
  assert.ok(toolStart && toolEnd - toolStart >= 9000, 'quiet应立即输出里程碑，不得tail阻塞到工具结束');
  assert.ok(flashEvents.some(e => e.elapsedSeconds >= 9 && e.elapsedSeconds <= 11), 'elapsedSeconds应是阶段耗时');
  const download = await launch({ url: 'https://fake.invalid/x.img', env: { DOWNLOAD_DELAY: '11000' } }); validate(download);
  const bytes = download.events.filter(e => e.stage === 'download' && 'currentBytes' in e);
  assert.ok(bytes.some(e => e.currentBytes === 1024 && e.totalBytes === 4096 && e.percent === 25), '下载心跳应报告真实落盘字节');
  assert.ok(bytes.some(e => e.currentBytes === 4096));
  assert.ok(fs.readFileSync(download.log, 'utf8').includes('下载中'), '下载前即初始化日志');
  const unknown = await launch({ url: 'https://fake.invalid/x.img', env: { UNKNOWN_SIZE: '1' } }); validate(unknown);
  assert.ok(unknown.events.filter(e => e.stage === 'download').every(e => !('percent' in e)), '未知总量不得估算百分比');
  const fallback = await launch({ url: 'https://bad.invalid/x.img', args: ['https://fake.invalid/x.img'] }); validate(fallback);
  assert.ok(fallback.events.some(event => event.stage === 'download' && event.message.includes('切换下一候选')));
  validate(await launch({ env: { FLASH_FAIL: '1' } }), 4);
  validate(await launch({ env: { FLASH_DELAY: '4000' }, args: ['--timeout-flash', '1'] }), 6);
  validate(await launch({ env: { BAD_VERSION: '1' } }), 5);
  const badChecksum = await launch({ args: ['--sha256', 'bad'] });
  validate(badChecksum, 3);
  assert.ok(fs.readFileSync(badChecksum.log, 'utf8').includes('ERROR: sha256 不匹配'), '前置失败的具体错误也必须写入日志');
  validate(await launch({ url: 'https://fake.invalid/x.img', env: { DOWNLOAD_FAIL: '1' } }), 3);
  validate(await launch({ command: 'verify' }));
  validate(await launch({ args: ['--dry-run'] }));
  const t3 = await launch({ env: { FAMILY: 't3' } }); validate(t3);
  assert.ok(t3.stdout.includes('刷写成功'));
  const reconnect = await launch({ env: { NEVER_RECONNECT: '1', NO_ADB: '1' }, args: ['--timeout-boot', '1'] });
  validate(reconnect, 6);
  assert.ok(reconnect.stderr.includes('切到 DEVICE'));
  const waitBody = fs.readFileSync(script, 'utf8').split('wait_adb() {')[1].split('# ---------------------------------------------------------------- 平台判定')[0];
  assert.ok(!waitBody.includes('120') && !waitBody.includes('切到 DEVICE'), '回线超时前不得提示切DEVICE');
  for (const phase of ['flash', 'download']) {
    let cancelled = false;
    const cancelledResult = await launch({ ...(phase === 'download' ? { url: 'https://fake.invalid/x.img' } : {}),
      env: { FLASH_DELAY: '30000', DOWNLOAD_DELAY: phase === 'download' ? '30000' : '0' },
      onEvent(event, child) { if (!cancelled && phase === 'flash' && event.stage === phase && event.percent === 23) { cancelled = true; child.kill('SIGTERM'); } },
      onStderr(text, child) { if (!cancelled && phase === 'download' && text.includes('FAKE_DOWNLOAD_STARTED')) { cancelled = true; child.kill('SIGINT'); } } });
    validate(cancelledResult, phase === 'flash' ? 143 : 130);
    const pid = Number(fs.readFileSync(path.join(cancelledResult.dir, phase === 'flash' ? 'tool-pid' : 'download-pid'), 'utf8'));
    assert.throws(() => process.kill(pid, 0), '取消必须回收刷写/下载工具进程');
  }
  console.log('progress OK: offline protocol, stages, heartbeat, real bytes/percent, failures, timeout, cancellation');
} finally {
  // 唯一删除目标是本测试刚创建的固定前缀私有临时目录。
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'flash-progress-')));
  fs.rmSync(root, { recursive: true, force: true });
}
