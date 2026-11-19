import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

export const STAGES = ['prepare', 'download', 'checksum', 'preflight', 'loader', 'flash', 'reconnect', 'verify', 'complete'];
const PREFIX = 'FLASH_PROGRESS ';
const MAX_LINE = 65536;
const STAGE_NAMES = { prepare: '准备', download: '下载镜像', checksum: '镜像校验', preflight: '刷前检查', loader: '进入下载模式', flash: '刷写固件', reconnect: '等待设备回线', verify: '验证版本', complete: '完成' };
const STATE_NAMES = { running: '进行中', completed: '完成', failed: '失败', cancelled: '已取消' };
function humanBytes(value) {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${unit ? value.toFixed(1) : value} ${units[unit]}`;
}
function imageStem(source) {
  let filename = source ?? 'verify';
  try { filename = new URL(filename).pathname; } catch { /* local image path */ }
  try { filename = decodeURIComponent(filename); } catch { /* malformed encoding remains a harmless name */ }
  return path.basename(filename).replace(/\.img$/i, '').replace(/[^\p{L}\p{N}._-]/gu, '_').slice(0, 160) || 'image';
}

/** Incremental stderr framing. Protocol records (including malformed ones) never enter ordinary output. */
export function progressDecoder(append, update) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let dropping = false;
  let ordinaryContinuation = false;
  function line(text) {
    const raw = text.replace(/\r?\n$/, '');
    if (!raw.startsWith(PREFIX)) { append(text); return; }
    if (raw.length > MAX_LINE) return;
    try {
      const event = JSON.parse(raw.slice(PREFIX.length));
      if (!STAGES.includes(event.stage) || !['running', 'completed', 'failed', 'cancelled'].includes(event.state)
          || typeof event.message !== 'string' || !Number.isFinite(event.elapsedSeconds) || event.elapsedSeconds < 0) return;
      for (const field of ['percent', 'currentBytes', 'totalBytes']) {
        if (event[field] !== undefined && (!Number.isFinite(event[field]) || event[field] < 0)) return;
      }
      if (event.percent !== undefined && event.percent > 100) return;
      const bytes = event.currentBytes === undefined ? '' : ` · ${humanBytes(event.currentBytes)}/${event.totalBytes === undefined ? '?' : humanBytes(event.totalBytes)}`;
      const message = event.message.replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 500);
      update(`${STAGE_NAMES[event.stage]} · ${STATE_NAMES[event.state]} · ${event.elapsedSeconds}s${event.percent === undefined ? '' : ` · ${event.percent}%`}${bytes} · ${message}`, { ...event, message });
    } catch { /* malformed protocol is discarded, not a task failure */ }
  }
  function feed(text, final = false) {
    pending += text;
    let pos;
    while ((pos = pending.indexOf('\n')) !== -1) {
      const current = pending.slice(0, pos + 1);
      pending = pending.slice(pos + 1);
      if (!dropping) {
        if (ordinaryContinuation) append(current);
        else line(current);
      }
      dropping = false; ordinaryContinuation = false;
    }
    if (pending.length > MAX_LINE) {
      if (!ordinaryContinuation && pending.startsWith(PREFIX)) dropping = true;
      if (!dropping) { append(pending); ordinaryContinuation = true; }
      pending = '';
    }
    if (final) {
      if (pending && !dropping) {
        if (ordinaryContinuation) append(pending);
        else line(pending);
      }
      pending = ''; dropping = false; ordinaryContinuation = false;
    }
  }
  return { write: (chunk) => feed(typeof chunk === 'string' ? chunk : decoder.write(chunk)), end: () => feed(decoder.end(), true) };
}

const properties = {
  action: { type: 'string', enum: ['plan', 'flash', 'verify'] },
  sources: { type: 'array', items: { type: 'string' }, description: '镜像本地路径或 http(s) URL；alist 优先、minio 备用。verify 不传。' },
  serial: { type: 'string' }, expect_version: { type: 'string' },
  dry_run: { type: 'boolean' }, exact: { type: 'boolean' },
  sha256: { type: 'string' },
  timeout_flash: { type: 'integer', minimum: 1, maximum: 86400 },
  timeout_boot: { type: 'integer', minimum: 1, maximum: 86400 },
  rk_index: { type: 'integer', minimum: 1, maximum: 100 },
};

/** Explicit validation also protects direct calls; no arbitrary argv, executable, shell or assertion hooks. */
export function validateArgs(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('flash_run 参数必须是对象');
  for (const key of Object.keys(args)) if (!Object.hasOwn(properties, key)) throw new Error(`不支持参数：${key}`);
  if (!properties.action.enum.includes(args.action)) throw new Error('action 必须是 plan/flash/verify');
  for (const key of ['serial', 'expect_version', 'sha256']) {
    if (args[key] !== undefined && (typeof args[key] !== 'string' || !args[key] || /[\x00-\x1f\x7f]/.test(args[key]) || args[key].length > 4096)) throw new Error(`${key} 无效`);
  }
  if (args.sha256 !== undefined && !/^[a-f\d]{64}$/i.test(args.sha256)) throw new Error('sha256 必须是 64 位十六进制');
  for (const key of ['dry_run', 'exact']) if (args[key] !== undefined && typeof args[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
  for (const key of ['timeout_flash', 'timeout_boot', 'rk_index']) {
    if (args[key] !== undefined && (!Number.isInteger(args[key]) || args[key] < 1 || args[key] > properties[key].maximum)) throw new Error(`${key} 超出范围`);
  }
  if (args.sources !== undefined && (!Array.isArray(args.sources) || args.sources.length > 8)) throw new Error('sources 必须是至多 8 项数组');
  const sources = args.sources ?? [];
  if (args.action !== 'verify' && sources.length === 0) throw new Error('plan/flash 需要 sources');
  if (args.action === 'verify' && sources.length) throw new Error('verify 不接受 sources');
  for (const source of sources) {
    if (typeof source !== 'string' || !source || source.length > 16384 || /^[\s-]/.test(source) || /[\x00-\x1f\x7f]/.test(source)) throw new Error('镜像来源无效');
    if (/^[a-z][a-z\d+.-]*:/i.test(source) && !/^https?:\/\//i.test(source)) throw new Error('仅支持本地路径或 http(s) URL');
  }
  return args;
}

export function flashArgv(script, args, log) {
  const argv = ['bash', script, args.action, ...(args.sources ?? []), '--progress-json', '--log', log];
  const flags = { serial: '--serial', expect_version: '--expect-version', sha256: '--sha256', timeout_flash: '--timeout-flash', timeout_boot: '--timeout-boot', rk_index: '--rk-index' };
  for (const [key, flag] of Object.entries(flags)) if (args[key] !== undefined) argv.push(flag, String(args[key]));
  if (args.action === 'flash') argv.push('--quiet');
  if (args.dry_run) argv.push('--dry-run');
  if (args.exact) argv.push('--exact');
  return argv;
}

/** Hooks settle only after managed-range cleanup, including errors and cancellation. */
function startProcess(ctx, spec, append, update, externalSignal) {
  const controller = new AbortController();
  let proc;
  const cancel = (reason) => { if (!controller.signal.aborted) controller.abort(reason); proc?.terminate(); };
  const abort = () => cancel(externalSignal.reason);
  externalSignal?.addEventListener('abort', abort, { once: true });
  if (externalSignal?.aborted) abort();
  const done = (async () => {
    let failure;
    let outcome;
    let lastEvent;
    let flashCompleted = false;
    const stderr = progressDecoder((text) => append(text, 'stderr'), (line, event) => {
      lastEvent = event;
      if (event.stage === 'flash' && event.state === 'completed') flashCompleted = true;
      update(line);
    });
    const stdout = new StringDecoder('utf8');
    const onOut = (chunk) => append(typeof chunk === 'string' ? chunk : stdout.write(chunk), 'stdout');
    const onErr = (chunk) => stderr.write(chunk);
    try {
      controller.signal.throwIfAborted();
      proc = ctx.subprocess.spawn({ ...spec, signal: controller.signal });
      const drains = [proc.stdout, proc.stderr].map((stream) => new Promise((resolve, reject) => {
        if (!stream || stream.readableEnded) return resolve();
        stream.once('end', resolve); stream.once('close', resolve); stream.once('error', reject);
      }));
      // Attach rejection handlers immediately, even while the subprocess is still running.
      const drained = Promise.all(drains); drained.catch(() => {});
      proc.stdout?.on('data', onOut); proc.stderr?.on('data', onErr);
      // A broken pipe must also trigger teardown instead of waiting indefinitely for the command.
      outcome = await Promise.race([proc.done, drained.then(() => proc.done)]);
      proc.terminate();
      await proc.waitForExit();
      await drained;
    } catch (error) { failure = error; }
    finally {
      try { if (proc) { proc.terminate(); await proc.waitForExit(); } }
      catch (error) { failure ??= error; }
      proc?.stdout?.off('data', onOut); proc?.stderr?.off('data', onErr);
      append(stdout.end(), 'stdout'); stderr.end();
      externalSignal?.removeEventListener('abort', abort);
    }
    return { outcome, failure, cancelled: controller.signal.aborted, lastEvent, flashCompleted };
  })();
  return { cancel, done };
}

export function flashToolFor(ctx, script) {
  return {
    name: 'flash_run',
    description: '【flash 技能】整机覆盖刷写，会清 userdata。结构化 plan/flash/verify；所有操作要求会话 danger-full-access，不提供权限升级参数。plan/verify 前台返回；flash 立即返回 job_id 与日志路径，使用 job_output/job_kill 跟踪或取消。取消会终止托管进程，不能回滚已写入固件，刷写中取消可能导致设备无法启动。不接受任意 shell。',
    parameters: { type: 'object', properties, required: ['action'], additionalProperties: false },
    output: { schema: { type: 'object', properties: {
      action: properties.action, job_id: { type: 'string' }, log: { type: 'string' },
      exit_code: { oneOf: [{ type: 'integer' }, { type: 'null' }] }, signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
      stdout: { type: 'string' }, stderr: { type: 'string' }, truncated: { type: 'boolean' },
    }, required: ['action', 'log'], additionalProperties: false }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(input, exec) {
      const args = validateArgs(input);
      exec.signal.throwIfAborted();
      if (!exec.agent?.id || !exec.agent?.session) throw new Error('flash_run 需要所属会话');
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
      if (policy?.mode !== 'danger-full-access') throw new Error('flash_run 要求 danger-full-access；当前权限不允许，不会启动进程。');
      const stem = imageStem(args.sources?.[0]);
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
      const log = path.join(os.homedir(), 'Downloads', `${stem}_flash_${stamp}_${randomUUID()}.log`);
      const spec = { argv: flashArgv(script, args, log), cwd: policy.workspaceRoot, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' }, graceMs: 3000 };
      if (args.action === 'flash') {
        const job_id = ctx.jobs.start({
          kind: 'flash', label: `刷机 ${args.expect_version ?? stem}`,
          owner: exec.agent.id, toolCall: { callId: exec.callId, rootCallId: exec.rootCallId ?? exec.callId },
          run(job) {
            const hooks = startProcess(ctx, spec, (text, channel) => job.append(text, { channel }), (line) => job.updateProgress(line));
            return { cancel: hooks.cancel, done: hooks.done.then(({ outcome, failure, cancelled, lastEvent, flashCompleted }) => {
              const stage = lastEvent ? `${STAGE_NAMES[lastEvent.stage]}：${lastEvent.message}` : '尚无阶段事件';
              const reconnect = flashCompleted && lastEvent?.stage === 'reconnect' && outcome?.exitCode !== 0
                ? '；固件刷写已完成，但设备未成功回线，请检查日志与 OTG，勿直接重刷' : '';
              return {
                status: cancelled ? 'killed' : failure || outcome?.exitCode !== 0 ? 'failed' : 'completed',
                detail: `${failure ? String(failure.message ?? failure) : `exit code: ${outcome?.exitCode}`}; ${stage}${reconnect}; log: ${log}${cancelled ? '；取消不能回滚已写入固件' : ''}`,
              };
            }) };
          },
        });
        return { action: args.action, job_id, log };
      }
      const output = { stdout: '', stderr: '' };
      let truncated = false;
      const hooks = startProcess(ctx, spec, (text, channel) => {
        output[channel] += text;
        if (output[channel].length > 131072) { output[channel] = output[channel].slice(-131072); truncated = true; }
      }, () => {}, exec.signal);
      const { outcome, failure, cancelled } = await hooks.done;
      if (cancelled) exec.signal.throwIfAborted();
      if (failure) throw failure;
      return { action: args.action, log, exit_code: outcome.exitCode, signal: outcome.signal, ...output, truncated };
    },
  };
}
