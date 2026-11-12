/**
 * BPMS 配置的 Web 侧接口（插件页里的「BPMS 配置」）。
 *
 * 只管理 state 路径下的 bpms.json；密码只写不回显，保存用 revision 防并发覆盖。
 * 路由仅在宿主提供 Connection 时注册（headless 下自动跳过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DEFAULT_BASE_URL, DEFAULT_TENANT_NAME, STATE_DIR, loadConfig } from './config.js';
import { BpmsError, createClient } from './client.js';

export const CONFIG_ROUTE_PATH = '/api/cp-tools/bpms/config';
export const TEST_ROUTE_PATH = '/api/cp-tools/bpms/test';
export const MANAGED_CONFIG_PATH = path.join(STATE_DIR, 'bpms.json');

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FIELD_LENGTH = 2048;
const MAX_PASSWORD_LENGTH = 512;
const EDITABLE_FIELDS = ['base_url', 'username', 'tenant_name', 'timeout_seconds'];

export class ConfigHttpError extends Error {
  constructor(code, message, status = 400, field) {
    super(message);
    this.name = 'ConfigHttpError';
    this.code = code;
    this.status = status;
    if (field) this.field = field;
  }
}

function configPathFor(target) {
  return path.resolve(target ?? MANAGED_CONFIG_PATH);
}

function readFileSafe(target) {
  try {
    const text = fs.readFileSync(target, 'utf8');
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ConfigHttpError('invalid-json', `${target} 不是合法 JSON`, 422);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ConfigHttpError('invalid-json', `${target} 顶层必须是对象`, 422);
    }
    return { exists: true, text, data };
  } catch (error) {
    if (error instanceof ConfigHttpError) throw error;
    if (error?.code === 'ENOENT') return { exists: false, text: '', data: null };
    throw new ConfigHttpError('unreadable', `读取 ${target} 失败：${error?.code ?? error?.message}`, 422);
  }
}

function revisionOf(text) {
  return createHash('sha1').update(text).digest('hex');
}

function writable(target) {
  try {
    fs.accessSync(path.dirname(target), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function clampTimeout(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new ConfigHttpError('invalid', 'timeout_seconds 必须是数字', 400, 'timeout_seconds');
  const rounded = Math.round(n);
  if (rounded < 3 || rounded > 300) {
    throw new ConfigHttpError('invalid', 'timeout_seconds 需在 3~300 之间', 400, 'timeout_seconds');
  }
  return rounded;
}

function normalizeField(field, raw) {
  if (typeof raw !== 'string') throw new ConfigHttpError('invalid', `${field} 必须是字符串`, 400, field);
  const value = raw.trim();
  if (/[\0\r\n]/.test(value)) throw new ConfigHttpError('invalid', `${field} 不能包含换行`, 400, field);
  if (value.length > MAX_FIELD_LENGTH) {
    throw new ConfigHttpError('invalid', `${field} 过长（上限 ${MAX_FIELD_LENGTH}）`, 400, field);
  }
  return value;
}

export function normalizeValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new ConfigHttpError('invalid-body', 'values 必须是对象', 400);
  }
  const out = {};
  if ('base_url' in values) {
    const url = normalizeField('base_url', values.base_url);
    if (!/^https?:\/\/[^\s]+$/i.test(url)) {
      throw new ConfigHttpError('invalid', 'base_url 需以 http(s):// 开头', 400, 'base_url');
    }
    out.base_url = url.replace(/\/+$/, '');
  }
  if ('username' in values) {
    const username = normalizeField('username', values.username);
    if (!username) throw new ConfigHttpError('invalid', 'username 不能为空', 400, 'username');
    out.username = username;
  }
  if ('tenant_name' in values) {
    const tenant = normalizeField('tenant_name', values.tenant_name);
    if (!tenant) throw new ConfigHttpError('invalid', 'tenant_name 不能为空', 400, 'tenant_name');
    out.tenant_name = tenant;
  }
  if ('timeout_seconds' in values) out.timeout_seconds = clampTimeout(values.timeout_seconds);
  return out;
}

export function normalizePassword(input) {
  if (input === undefined || input === null) return { action: 'keep' };
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigHttpError('invalid', 'password 必须是 {action,value} 对象', 400, 'password');
  }
  const action = input.action ?? 'keep';
  if (!['keep', 'set', 'clear'].includes(action)) {
    throw new ConfigHttpError('invalid', 'password.action 只接受 keep/set/clear', 400, 'password');
  }
  if (action !== 'set') return { action };
  const value = input.value;
  if (typeof value !== 'string' || value === '') {
    throw new ConfigHttpError('invalid', 'password.value 不能为空', 400, 'password');
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw new ConfigHttpError('invalid', 'password 过长', 400, 'password');
  }
  return { action, value };
}

/** 页面只读视图：密码只报告是否已配置。 */
export function configView(target) {
  const file = configPathFor(target);
  const { exists, text, data } = readFileSafe(file);
  let active = null;
  try {
    active = loadConfig();
  } catch {
    active = null;
  }
  return {
    path: file,
    activePath: active?.path ?? null,
    activeSource: active?.source ?? null,
    overridden: Boolean(active && active.path !== file),
    exists,
    writable: writable(file),
    revision: exists ? revisionOf(text) : 'missing',
    values: {
      base_url: typeof data?.base_url === 'string' ? data.base_url : DEFAULT_BASE_URL,
      username: typeof data?.username === 'string' ? data.username : '',
      tenant_name: typeof data?.tenant_name === 'string' ? data.tenant_name : DEFAULT_TENANT_NAME,
      timeout_seconds: Number.isFinite(Number(data?.timeout_seconds)) ? Number(data.timeout_seconds) : 20,
    },
    secrets: {
      password: { set: typeof data?.password === 'string' && data.password !== '' },
    },
  };
}

/** 保存：revision 防并发；只覆盖页面管理的键，其它键原样保留；写入 0600 原子替换。 */
export function applyConfigUpdate(input, target) {
  const file = configPathFor(target);
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ConfigHttpError('invalid-body', '请求体必须是对象', 400);
  }
  const current = readFileSafe(file);
  const actual = current.exists ? revisionOf(current.text) : 'missing';
  if (input.revision !== undefined && input.revision !== actual) {
    throw new ConfigHttpError('stale', '配置文件已被外部修改，请重新载入后再保存', 409);
  }

  const values = normalizeValues(input.values ?? {});
  const password = normalizePassword(input.password);
  const next = { ...(current.data ?? {}) };
  for (const key of EDITABLE_FIELDS) {
    if (key in values) next[key] = values[key];
  }
  if (password.action === 'set') next.password = password.value;
  if (password.action === 'clear') delete next.password;

  const missing = ['username', 'password'].filter((key) => !next[key]);
  if (missing.length > 0) {
    throw new ConfigHttpError('invalid', `还缺 ${missing.join('、')}`, 400, missing[0]);
  }

  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* 平台不支持时忽略 */
  }
  return configView(file);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** 认证后的精确 Fetch 路由；Connection 会在进入 handler 前完成认证。 */
export function createConfigRoute() {
  return {
    path: CONFIG_ROUTE_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        if (request.method === 'GET') return jsonResponse(configView());
        if (request.method !== 'POST') return jsonResponse({ error: { code: 'method' } }, 405);
        const text = await request.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
          return jsonResponse({ error: { code: 'too-large', message: '请求体过大' } }, 413);
        }
        let input;
        try {
          input = text === '' ? {} : JSON.parse(text);
        } catch {
          return jsonResponse({ error: { code: 'invalid-body', message: '请求体不是合法 JSON' } }, 400);
        }
        return jsonResponse(applyConfigUpdate(input));
      } catch (error) {
        if (error instanceof ConfigHttpError) {
          return jsonResponse(
            { error: { code: error.code, message: error.message, field: error.field } },
            error.status,
          );
        }
        console.warn(`[cp-bpms] 配置接口失败：${error?.name || 'Error'}`);
        return jsonResponse({ error: { code: 'internal', message: '配置操作失败' } }, 500);
      }
    },
  };
}

/**
 * 用「当前保存的配置 + 页面上还没保存的值」试登录一次。
 * 不写 token、不改配置文件；只回答能不能登进去。
 */
export async function testLogin(input = {}, options = {}) {
  let config;
  try {
    ({ config } = loadConfig());
  } catch (error) {
    if (error?.code !== 'needs_config') throw error;
    config = { base_url: DEFAULT_BASE_URL, tenant_name: DEFAULT_TENANT_NAME, timeout_seconds: 20 };
  }
  const username = String(input.username ?? config.username ?? '').trim();
  const password =
    input.clearPassword === true ? '' : String(input.password ?? config.password ?? '');
  if (!username) throw new ConfigHttpError('invalid', '请先填写用户名', 400, 'username');
  if (!password) throw new ConfigHttpError('invalid', '请先填写密码', 400, 'password');

  const client = createClient(
    { ...config, username, password },
    { fetchImpl: options.fetchImpl, persistToken: false },
  );
  try {
    const token = await client.login(true);
    return {
      ok: true,
      userId: Number(token.userId ?? 0) || null,
      tenantId: client.tenantId ?? null,
      expiresAt: token.expiresTime ? new Date(token.expiresTime).toISOString() : null,
      message: '登录成功',
    };
  } catch (error) {
    if (error instanceof BpmsError) return { ok: false, message: error.message };
    throw error;
  }
}

/** 试登录路由；body: { username?, password?, clearPassword? }。 */
export function createTestRoute() {
  return {
    path: TEST_ROUTE_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      try {
        const text = await request.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) {
          return jsonResponse({ error: { code: 'too-large', message: '请求体过大' } }, 413);
        }
        let input = {};
        try {
          input = text === '' ? {} : JSON.parse(text);
        } catch {
          return jsonResponse({ error: { code: 'invalid-body', message: '请求体不是合法 JSON' } }, 400);
        }
        return jsonResponse(await testLogin(input));
      } catch (error) {
        if (error instanceof ConfigHttpError) {
          return jsonResponse(
            { error: { code: error.code, message: error.message, field: error.field } },
            error.status,
          );
        }
        console.warn(`[cp-bpms] 试登录失败：${error?.name || 'Error'}`);
        return jsonResponse({ error: { code: 'internal', message: '试登录失败' } }, 500);
      }
    },
  };
}
