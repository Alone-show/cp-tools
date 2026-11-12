/**
 * BPMS（CPSales）HTTP 客户端：租户解析 → 登录 → 带 token 请求。
 *
 * 只依赖全局 fetch，方便离线测试注入；网络失败与业务失败分开报错，
 * 避免把「token 过期」「密码错」「连不上」混成一句「未登录」。
 */
import { readToken, writeToken } from './config.js';

export const AUTH_PATHS = new Set(['/admin-api/system/auth/login', '/admin-api/system/auth/refresh-token']);

export class BpmsError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'BpmsError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * @param {{base_url: string, username: string, password: string, tenant_name: string, timeout_seconds: number}} config
 * @param {{fetchImpl?: Function, now?: () => number, token?: object|null, persistToken?: boolean}} [options]
 */
export function createClient(config, options = {}) {
  const fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const now = options.now ?? (() => Date.now());
  const persist = options.persistToken !== false;

  let token = options.token ?? readToken();
  let tenantId = null;

  function headers(extra = {}) {
    const out = {
      Accept: 'application/json, text/plain, */*',
      Referer: `${config.base_url}/`,
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      ...extra,
    };
    if (tenantId !== null) out['tenant-id'] = String(tenantId);
    if (token?.accessToken) out.Authorization = `Bearer ${token.accessToken}`;
    return out;
  }

  async function requestRaw(path, { method = 'GET', body, form, headers: extra, auth = true } = {}) {
    const url = `${config.base_url}${path}`;
    const init = { method, headers: headers(auth ? extra : { ...extra, Authorization: '' }) };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    if (form) {
      init.body = form;
      delete init.headers['Content-Type'];
    }
    init.signal = AbortSignal.timeout(config.timeout_seconds * 1000);

    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      throw new BpmsError('network', `连不上 ${config.base_url}：${error.message}`, { cause: error });
    }
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    return { response, payload, text };
  }

  async function resolveTenant() {
    if (tenantId !== null) return tenantId;
    const { response, payload } = await requestRaw(
      `/admin-api/system/tenant/get-id-by-name?name=${encodeURIComponent(config.tenant_name)}`,
      { auth: false },
    );
    if (!response.ok || payload?.code !== 0) {
      throw new BpmsError('tenant', `租户名「${config.tenant_name}」无法解析：${payload?.msg ?? response.status}`, {
        status: response.status,
      });
    }
    tenantId = Number(payload.data);
    if (!Number.isFinite(tenantId)) throw new BpmsError('tenant', '租户接口没有返回有效的 tenant id');
    return tenantId;
  }

  async function login(force = false) {
    const sameAccount =
      token?.base_url === config.base_url && token?.username === config.username;
    if (!force && sameAccount && token?.accessToken && Number(token.expiresTime ?? 0) > now() + 60_000) {
      return token;
    }
    const id = await resolveTenant();
    const { response, payload } = await requestRaw('/admin-api/system/auth/login', {
      method: 'POST',
      body: { username: config.username, password: config.password },
      auth: false,
      headers: { 'tenant-id': String(id), 'Content-Type': 'application/json' },
    });
    if (!response.ok || payload?.code !== 0 || !payload?.data?.accessToken) {
      const reason = payload?.msg || `HTTP ${response.status}`;
      throw new BpmsError('auth_failed', `BPMS 登录失败：${reason}`, { status: response.status });
    }
    token = {
      accessToken: payload.data.accessToken,
      refreshToken: payload.data.refreshToken ?? null,
      userId: payload.data.userId ?? null,
      expiresTime: Number(payload.data.expiresTime ?? 0),
      base_url: config.base_url,
      username: config.username,
    };
    if (persist) writeToken(token);
    return token;
  }

  /** 业务请求：自动登录、401 重登一次；返回 payload（已确认 code===0）。 */
  async function request(path, options = {}) {
    await login();
    let result = await requestRaw(path, options);
    if (result.response.status === 401) {
      await login(true);
      result = await requestRaw(path, options);
    }
    const { response, payload, text } = result;
    if (!response.ok) {
      throw new BpmsError('http', `${path} 返回 HTTP ${response.status}：${text.slice(0, 200)}`, {
        status: response.status,
      });
    }
    if (payload && typeof payload.code === 'number' && payload.code !== 0) {
      throw new BpmsError('api', `${path} 业务失败（code=${payload.code}）：${payload.msg ?? ''}`, {
        code: payload.code,
      });
    }
    return payload;
  }

  return {
    config,
    login,
    request,
    resolveTenant,
    get token() {
      return token;
    },
    get tenantId() {
      return tenantId;
    },
  };
}
