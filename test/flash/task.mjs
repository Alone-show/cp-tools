import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { flashToolFor, flashArgv, progressDecoder, validateArgs } from '../../src/flash/task.js';
import { apply, inject } from '../../src/flash/index.js';

const event = (extra = {}) => `FLASH_PROGRESS ${JSON.stringify({ stage: 'download', state: 'running', elapsedSeconds: 3, message: '下载中', ...extra })}\n`;
function fakeServices({ mode = 'danger-full-access', spawnError } = {}) {
  let proc, spec, registration, hooks;
  const appended = [], progress = [];
  const controller = new AbortController();
  const agent = { id: 'owner-session', session: { id: 'owner-session' } };
  const exec = { agent, callId: 'inner-call', rootCallId: 'root-call', signal: controller.signal };
  const ctx = {
    sandboxPolicy: { resolve(request) { assert.equal(request.session, agent.session); return { mode, workspaceRoot: '/tmp' }; } },
    subprocess: { spawn(input) {
      spec = input;
      if (spawnError) throw new Error(spawnError);
      let resolveDone, rejectDone, resolveExit;
      const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
      const exited = new Promise((resolve) => { resolveExit = resolve; });
      proc = {
        stdout: new PassThrough(), stderr: new PassThrough(), done,
        terminated: 0, waits: 0,
        terminate() { this.terminated++; },
        async waitForExit() { this.waits++; return exited; },
        finish(exitCode = 0) { this.stdout.end(); this.stderr.end(); resolveDone({ exitCode, signal: null }); },
        fail() { this.stdout.end(); this.stderr.end(); rejectDone(new Error('provider failure')); },
        release() { resolveExit(true); },
      };
      input.signal.addEventListener('abort', () => { proc.finish(null); proc.release(); }, { once: true });
      return proc;
    } },
    jobs: { start(input) {
      registration = input;
      hooks = input.run({ id: 'flash-offline', append(text, options) { appended.push({ text, ...options }); }, updateProgress(line) { progress.push(line); } });
      return 'flash-offline';
    } },
  };
  return { ctx, exec, controller, appended, progress, get proc() { return proc; }, get spec() { return spec; }, get registration() { return registration; }, get hooks() { return hooks; } };
}

for (const mode of ['read-only', 'workspace-write', undefined]) {
  test(`permission rejects ${mode ?? 'missing'} before starting any process`, async () => {
    const fake = fakeServices({ mode });
    if (mode === undefined) fake.ctx.sandboxPolicy.resolve = () => ({});
    const tool = flashToolFor(fake.ctx, '/trusted/flash.sh');
    for (const action of ['plan', 'flash', 'verify']) {
      await assert.rejects(tool.execute({ action, ...(action === 'verify' ? {} : { sources: ['image.img'] }) }, fake.exec), /danger-full-access/);
    }
    assert.equal(fake.proc, undefined);
    assert.equal(fake.registration, undefined);
  });
}

test('strict structured arguments reject arbitrary commands, flags and invalid types', () => {
  const invalid = [
    { command: 'evil' }, { sources: ['--check'] }, { sources: ['file:///etc/passwd'] },
    { sources: ['image.img\n--check evil'] }, { sources: 'image.img' }, { timeout_flash: 0 },
    { timeout_boot: Infinity }, { exact: 'true' }, { dry_run: 1 }, { sha256: 'bad' }, { rk_index: 0 },
    { serial: 'one\nother' }, { action: 'other' }, { sources: [] },
  ];
  for (const args of invalid) assert.throws(() => validateArgs({ action: 'flash', sources: ['image.img'], ...args }));
  assert.throws(() => validateArgs({ action: 'verify', sources: ['image.img'] }));
  assert.doesNotThrow(() => validateArgs({ action: 'verify' }));
  const args = validateArgs({ action: 'flash', sources: ['/tmp/a;$(touch NEVER).img', 'https://example.test/a.img?x=1&y=2'], serial: 's', expect_version: 'v', sha256: 'a'.repeat(64), timeout_flash: 30, timeout_boot: 10, exact: true, dry_run: true, rk_index: 2 });
  const argv = flashArgv('/trusted/flash.sh', args, '/tmp/log');
  assert.deepEqual(argv.slice(0, 5), ['bash', '/trusted/flash.sh', 'flash', ...args.sources]);
  assert.ok(argv.includes('--progress-json')); assert.ok(argv.includes('--quiet'));
  assert.ok(argv.includes('--dry-run')); assert.ok(argv.includes('--exact'));
  assert.equal(argv[argv.indexOf('--rk-index') + 1], '2');
  assert.equal(argv.includes('-c'), false);
});

test('progress handles every possible byte split including UTF-8 and EOF', () => {
  const bytes = Buffer.from(`ordinary\n${event({ percent: 32, currentBytes: 32, totalBytes: 100 })}last`);
  for (let split = 0; split <= bytes.length; split++) {
    const out = [], updates = [];
    const parser = progressDecoder((x) => out.push(x), (x) => updates.push(x));
    parser.write(bytes.subarray(0, split)); parser.write(bytes.subarray(split)); parser.end();
    assert.equal(out.join(''), 'ordinary\nlast');
    assert.equal(updates.length, 1);
    assert.match(updates[0], /下载镜像.*3s.*32%.*32 B\/100 B.*下载中/);
  }
});

test('malformed, invalid, overlong and CRLF protocol is filtered with bounded buffers', () => {
  const out = [], updates = [];
  const parser = progressDecoder((x) => out.push(x), (x) => updates.push(x));
  parser.write('FLASH_PRO'); parser.write('GRESS {broken}\n');
  for (const extra of [{ stage: 'evil' }, { elapsedSeconds: -1 }, { percent: 101 }, { totalBytes: '30' }, { state: '???' }]) parser.write(event(extra));
  parser.write('FLASH_PROGRESS ' + 'x'.repeat(70000)); parser.write('ignored continuation\n');
  parser.write('y'.repeat(70000)); parser.write('FLASH_PROGRESS not-a-record\n');
  parser.write('FLASH_PROGRESS ' + 'z'.repeat(70000) + '\n');
  parser.write(event().replace(/\n$/, '\r\n'));
  parser.write(event({ stage: 'complete', state: 'completed' }).trimEnd()); parser.end();
  assert.equal(out.join(''), 'y'.repeat(70000) + 'FLASH_PROGRESS not-a-record\n');
  assert.equal(updates.length, 2);
});

test('flash immediately returns owned job, logs regular output and updates live progress', async () => {
  const fake = fakeServices();
  const tool = flashToolFor(fake.ctx, '/trusted/flash.sh');
  const result = await tool.execute({ action: 'flash', sources: ['image.img'], expect_version: 'V1' }, fake.exec);
  assert.equal(result.job_id, 'flash-offline'); assert.match(result.log, /Downloads\/image_flash_.*\.log$/);
  assert.equal(fake.registration.owner, fake.exec.agent.id);
  assert.deepEqual(fake.registration.toolCall, { callId: 'inner-call', rootCallId: 'root-call' });
  assert.equal(fake.spec.argv[1], '/trusted/flash.sh');
  assert.equal(fake.spec.argv[fake.spec.argv.indexOf('--log') + 1], result.log);
  assert.equal(fake.spec.stdio.stdin, 'ignore');
  fake.proc.stdout.write('hello\n');
  fake.proc.stderr.write('warning\nFLASH_PRO');
  fake.proc.stderr.write('GRESS {bad}\n' + event({ percent: 50 }));
  assert.match(fake.progress[0], /50%/);
  fake.proc.finish();
  let settled = false; fake.hooks.done.then(() => { settled = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false, 'resource release must precede producer settlement');
  fake.proc.release();
  assert.equal((await fake.hooks.done).status, 'completed');
  assert.equal(fake.appended.map((x) => x.text).join(''), 'hello\nwarning\n');
  assert.ok(fake.proc.terminated > 0); assert.ok(fake.proc.waits > 0);
});

test('job cancellation uses managed termination, does not inherit completed tool call signal', async () => {
  const fake = fakeServices();
  await flashToolFor(fake.ctx, '/trusted/flash.sh').execute({ action: 'flash', sources: ['image.img'] }, fake.exec);
  fake.controller.abort('tool completed');
  assert.equal(fake.spec.signal.aborted, false);
  fake.hooks.cancel('user requested'); fake.hooks.cancel('again');
  assert.equal(fake.spec.signal.aborted, true);
  assert.equal((await fake.hooks.done).status, 'killed');
  assert.ok(fake.proc.terminated > 0);
});

for (const action of ['plan', 'verify']) {
  test(`${action} waits for managed cleanup and returns foreground result`, async () => {
    const fake = fakeServices();
    const pending = flashToolFor(fake.ctx, '/trusted/flash.sh').execute({ action, ...(action === 'plan' ? { sources: ['image.img'] } : {}) }, fake.exec);
    fake.proc.stdout.write('result\n'); fake.proc.stderr.write(event() + 'diagnostic\n');
    fake.proc.finish(5); fake.proc.release();
    const result = await pending;
    assert.equal(result.exit_code, 5); assert.equal(result.stdout, 'result\n'); assert.equal(result.stderr, 'diagnostic\n');
    assert.equal(result.job_id, undefined); assert.equal(fake.registration, undefined);
  });
}

test('foreground cancellation waits for teardown and throws abort', async () => {
  const fake = fakeServices();
  const pending = flashToolFor(fake.ctx, '/trusted/flash.sh').execute({ action: 'verify' }, fake.exec);
  fake.controller.abort(new Error('cancel foreground'));
  await assert.rejects(pending, /cancel foreground/);
  assert.ok(fake.proc.waits > 0);
});

test('spawn/provider failures settle jobs without unhandled rejection', async () => {
  const fake = fakeServices({ spawnError: 'cannot spawn' });
  await flashToolFor(fake.ctx, '/trusted/flash.sh').execute({ action: 'flash', sources: ['image.img'] }, fake.exec);
  assert.equal((await fake.hooks.done).status, 'failed');
  const live = fakeServices();
  await flashToolFor(live.ctx, '/trusted/flash.sh').execute({ action: 'flash', sources: ['image.img'] }, live.exec);
  live.proc.fail(); live.proc.release();
  assert.equal((await live.hooks.done).status, 'failed');
  assert.ok(live.proc.terminated > 0);
});

test('broken output pipe triggers managed teardown before producer settlement', async () => {
  const fake = fakeServices();
  await flashToolFor(fake.ctx, '/trusted/flash.sh').execute({ action: 'flash', sources: ['image.img'] }, fake.exec);
  fake.proc.stderr.destroy(new Error('broken protocol pipe'));
  fake.proc.release();
  const result = await fake.hooks.done;
  assert.equal(result.status, 'failed');
  assert.match(result.detail, /broken protocol pipe/);
  assert.ok(fake.proc.terminated > 0);
});

test('foreground output cap and already-aborted invocation', async () => {
  const fake = fakeServices();
  const pending = flashToolFor(fake.ctx, '/trusted/flash.sh').execute({ action: 'verify' }, fake.exec);
  fake.proc.stdout.write('x'.repeat(200000)); fake.proc.finish(); fake.proc.release();
  const result = await pending;
  assert.equal(result.truncated, true); assert.equal(result.stdout.length, 131072);
  const aborted = fakeServices(); aborted.controller.abort(new Error('already stopped'));
  await assert.rejects(flashToolFor(aborted.ctx, '/trusted/flash.sh').execute({ action: 'verify' }, aborted.exec), /already stopped/);
  assert.equal(aborted.proc, undefined);
});

test('plugin declares host services and exposes flash_run only after flash skill activation', async () => {
  assert.deepEqual(inject, ['skills', 'tools', 'subprocess', 'jobs', 'sandboxPolicy']);
  let registered, condition;
  const listeners = new Map();
  const ctx = {
    skills: { register() { return () => {}; } },
    tools: { register(tool, options) { registered = tool; condition = options.when; return () => {}; } },
    effect(fn) { fn(); }, on(name, fn) { listeners.set(name, fn); return () => {}; }, logger: { warn() {} },
  };
  apply(ctx);
  const agent = {};
  assert.equal(registered.name, 'flash_run');
  assert.equal(await condition({ agent }), false);
  listeners.get('tools/result')({ name: 'skill', arguments: { name: 'firmware' }, agent }, {});
  assert.equal(await condition({ agent }), false);
  listeners.get('tools/result')({ name: 'skill', arguments: { name: 'flash' }, agent }, {});
  assert.equal(await condition({ agent }), true);
});

test('installed SDK: real Cordis tools registration and jobs-local ownership/progress/settlement', async (t) => {
  const require = createRequire(process.env.DSH_SDK_PACKAGE ?? '/home/my/.local/share/dsh/npm/lib/node_modules/@deepseek-ai/dsh/package.json');
  let paths;
  try { paths = ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-jobs-local'].map((name) => require.resolve(name)); }
  catch { t.skip('Installed DSH SDK not found; set DSH_SDK_PACKAGE to its package.json'); return; }
  const [{ Context }, { ToolsService }, { LocalJobRegistry }] = await Promise.all(paths.map((file) => import(file)));
  const fake = fakeServices();
  const ctx = new Context();
  const events = [];
  let tool;
  const fiber = await ctx.plugin((c) => {
    fake.exec.agent.ctx = c;
    fake.exec.agent.session.append = (type, data) => events.push({ type, data });
    c.provide('logger', { warn() {} });
    c.provide('agents', { get: (id) => id === fake.exec.agent.id ? fake.exec.agent : undefined });
    c.provide('systemPrompt', { tools() {} });
    c.provide('sandboxPolicy', fake.ctx.sandboxPolicy);
    c.provide('subprocess', fake.ctx.subprocess);
    new ToolsService(c);
    new LocalJobRegistry(c, { maxConcurrentJobsPerOwner: 4, retainBytes: 65536, settledRetainBytes: 16384, pumpPollMs: 150 });
    c.jobs.attachController('offline-tests');
    tool = flashToolFor(c, '/trusted/flash.sh');
    c.tools.register(tool);
  });
  try {
    const value = await tool.execute({ action: 'flash', sources: ['https://example.test/CP_TEST.img?sign=SECRET'] }, fake.exec);
    const running = ctx.jobs.get(value.job_id, fake.exec.agent.id);
    assert.equal(running.owner, fake.exec.agent.id);
    assert.equal(running.label.includes('SECRET'), false);
    assert.match(value.log, /CP_TEST_flash_/);
    assert.throws(() => ctx.jobs.get(value.job_id, 'other-session'));
    fake.proc.stderr.write(event({ percent: 75, currentBytes: 1073741824, totalBytes: 2147483648 }));
    assert.match(ctx.jobs.get(value.job_id, fake.exec.agent.id).progress, /下载镜像.*75%.*1.0 GiB\/2.0 GiB/);
    fake.proc.stderr.write(event({ stage: 'flash', state: 'completed' }));
    fake.proc.stderr.write(event({ stage: 'reconnect', state: 'failed', message: '回线超时' }));
    fake.proc.finish(5); fake.proc.release();
    const finished = await ctx.jobs.wait(value.job_id, 1000, fake.exec.agent.id);
    assert.equal(finished.status, 'failed');
    assert.match(finished.detail, /固件刷写已完成.*勿直接重刷.*log:/);
    assert.deepEqual(events.map((x) => x.type), ['job/registered', 'job/settled']);
    assert.deepEqual(events[0].data.toolCall, { callId: 'inner-call', rootCallId: 'root-call' });
    assert.equal(events[0].data.owner, fake.exec.agent.id);
    const cancelled = await tool.execute({ action: 'flash', sources: ['offline.img'] }, fake.exec);
    assert.equal(ctx.jobs.kill(cancelled.job_id, fake.exec.agent.id, 'offline cancel'), 'requested');
    const killed = await ctx.jobs.wait(cancelled.job_id, 1000, fake.exec.agent.id);
    assert.equal(killed.status, 'killed');
    assert.match(killed.detail, /取消不能回滚/);
    assert.ok(fake.proc.terminated > 0);
  } finally { await fiber.dispose(); }
});
