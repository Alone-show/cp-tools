/**
 * BPMS 配置与凭据文件解析。
 *
 * 查找顺序（先命中先用）：
 *   1. 环境变量 BPMS_CONFIG 指向的文件（排障/临时切换用）
 *   2. DSH home 下的稳定路径 ~/.dsh/cp-tools/bpms.json（插件升级不会覆盖）
 *   3. 插件目录 bpms_config.json（本地填写方便，已 gitignore）
 *
 * 凭据只允许放在这三处之一；仓库里只有 bpms_config.example.json（全空占位）。
 * 密码/token 任何时候都不写进日志与工具返回值。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_DIR = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const DSH_HOME = path.resolve(
  (process.env.DSH_HOME || path.join(os.homedir(), '.dsh')).replace(/^~(?=$|\/)/, os.homedir()),
);
export const STATE_DIR = path.join(DSH_HOME, 'cp-tools');
export const TOKEN_PATH = path.join(STATE_DIR, 'bpms-token.json');
export const BACKUP_DIR = path.join(STATE_DIR, 'backups');

export const DEFAULT_BASE_URL = 'https://bpms.cpuniverse.cn';
export const DEFAULT_TENANT_NAME = '从平';
export const DEFAULT_TIMEOUT_SECONDS = 20;

/** 配置缺字段时给出的模板；字段名与 bpms_config.example.json 保持一致。 */
export const CONFIG_TEMPLATE = {
  base_url: DEFAULT_BASE_URL,
  username: '',
  password: '',
  tenant_name: DEFAULT_TENANT_NAME,
  timeout_seconds: DEFAULT_TIMEOUT_SECONDS,
};

export class ConfigError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/** 候选配置文件（按优先级）。 */
export function configCandidates(env = process.env) {
  const out = [];
  if (env.BPMS_CONFIG) out.push(path.resolve(expandHome(env.BPMS_CONFIG)));
  out.push(path.join(STATE_DIR, 'bpms.json'));
  out.push(path.join(PLUGIN_DIR, 'bpms_config.json'));
  return [...new Set(out)];
}

export function expandHome(value) {
  const raw = String(value ?? '');
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

/**
 * 读取并校验配置。
 * @returns {{config: {base_url: string, username: string, password: string, tenant_name: string, timeout_seconds: number}, path: string, source: 'env'|'state'|'plugin'}}
 */
export function loadConfig(env = process.env) {
  const candidates = configCandidates(env);
  const found = candidates.find((file) => fs.existsSync(file));
  if (!found) {
    throw new ConfigError('needs_config', '还没有配置 BPMS 账号', {
      paths: candidates,
      template: CONFIG_TEMPLATE,
    });
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(found, 'utf8'));
  } catch (error) {
    throw new ConfigError('bad_config', `${found} 不是合法 JSON：${error.message}`, { path: found });
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ConfigError('bad_config', `${found} 顶层必须是对象`, { path: found });
  }

  const merged = {
    ...CONFIG_TEMPLATE,
    ...data,
    ...envOverrides(env),
  };
  const config = {
    base_url: String(merged.base_url || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    username: String(merged.username || '').trim(),
    password: String(merged.password || ''),
    tenant_name: String(merged.tenant_name || DEFAULT_TENANT_NAME).trim(),
    timeout_seconds: normalizeTimeout(merged.timeout_seconds),
  };

  const missing = ['username', 'password'].filter((key) => !config[key]);
  if (missing.length > 0) {
    throw new ConfigError('needs_config', `${found} 缺少 ${missing.join('、')}`, {
      path: found,
      paths: candidates,
      template: CONFIG_TEMPLATE,
    });
  }

  return { config, path: found, source: sourceOf(found, candidates) };
}

function sourceOf(file, candidates) {
  if (file === candidates[0] && process.env.BPMS_CONFIG) return 'env';
  if (file === path.join(STATE_DIR, 'bpms.json')) return 'state';
  return 'plugin';
}

function envOverrides(env) {
  const out = {};
  if (env.BPMS_BASE_URL) out.base_url = env.BPMS_BASE_URL;
  if (env.BPMS_USERNAME) out.username = env.BPMS_USERNAME;
  if (env.BPMS_PASSWORD) out.password = env.BPMS_PASSWORD;
  if (env.BPMS_TENANT) out.tenant_name = env.BPMS_TENANT;
  return out;
}

function normalizeTimeout(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_SECONDS;
  return Math.min(300, Math.max(3, Math.round(n)));
}

/** 文件权限过宽时给一条提示（不阻断使用）。 */
export function permissionWarning(file) {
  try {
    const mode = fs.statSync(file).mode & 0o777;
    if (mode & 0o077) return `${file} 权限是 ${mode.toString(8)}，建议 chmod 600`;
  } catch {
    /* 读不到就不提示 */
  }
  return '';
}

/** 把对象里的口令类字段替换成 ***，供日志与工具返回值使用。 */
export function maskSecrets(value) {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|passwd|token|secret|cookie/i.test(key)) {
      out[key] = item ? '***' : item;
      continue;
    }
    out[key] = maskSecrets(item);
  }
  return out;
}

/** 写 token 缓存（0600）。 */
export function writeToken(token) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(TOKEN_PATH, `${JSON.stringify(token, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(TOKEN_PATH, 0o600);
  } catch {
    /* 某些平台不支持，忽略 */
  }
}

/** 读 token 缓存；损坏或过期由调用方决定是否重登。 */
export function readToken() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/** 写一份更新前的详情备份，返回路径。 */
export function writeBackup(id, detail) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(BACKUP_DIR, `${id}-${stamp}.json`);
  fs.writeFileSync(file, `${JSON.stringify(detail, null, 2)}\n`, { mode: 0o600 });
  return file;
}
