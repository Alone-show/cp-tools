#!/usr/bin/env node
/**
 * Teambition 登录/刷新凭据（替代旧的 tools/login.sh + tools/capture_token.mjs）。
 *
 *   node scripts/tb-login.mjs                 # auto：先静默刷新，失败再弹浏览器
 *   node scripts/tb-login.mjs --check         # 只检查 token 状态
 *   node scripts/tb-login.mjs --mode headless # 只试静默刷新
 *   node scripts/tb-login.mjs --cookie '...'  # 直接粘贴 Cookie / Copy as cURL
 *   node scripts/tb-login.mjs --data-dir /path/to/.tbfw
 *
 * 默认数据目录：$DSH_TBFW_DIR / $DSH_FIRMWARE_DIR / ./.tbfw。
 */
import path from 'node:path';
import { checkToken, ensureToken, loginWithCookie } from '../src/tb/login.js';
import { dataDir } from './lib/paths.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const dir = path.resolve(
  arg('data-dir', dataDir(['DSH_TBFW_DIR', 'DSH_FIRMWARE_DIR'], '.tbfw') ?? path.join(process.cwd(), '.tbfw')),
);

if (process.argv.includes('--check')) {
  console.log(JSON.stringify(checkToken(dir), null, 2));
  process.exit(0);
}

const cookie = arg('cookie', '');
const result = cookie
  ? loginWithCookie(dir, cookie)
  : await ensureToken(dir, {
      mode: arg('mode', 'auto'),
      timeoutSeconds: Number(arg('timeout', 180)),
      browser: arg('browser', ''),
    });

console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'ok' ? 0 : 1);
