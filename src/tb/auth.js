/**
 * 共享 TB 层：凭据与看板索引的位置解析。
 *
 * firmware 与 tickets 两个子插件共用同一份数据目录（.tbfw）：环境变量、文件名、
 * 目录顺序都保持不变，已同步的缓存无需迁移。只有 tickets 写，firmware 只读。
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkToken } from './login.js';
import { candidateDirs as sharedCandidateDirs, findExistingDir } from '../shared/data-dir.js';

/** 依次尝试的数据目录：显式配置 -> 会话工作区 -> 部署默认 -> 进程 cwd */
export async function candidateDirs(ctx, exec) {
  return sharedCandidateDirs(ctx, exec, {
    envNames: ['DSH_TBFW_DIR', 'DSH_FIRMWARE_DIR'],
    subdir: '.tbfw',
  });
}

/** 凭据所在目录：优先已有 token.json 的候选目录 */
export async function tokenDir(ctx, exec) {
  const dirs = await candidateDirs(ctx, exec);
  return findExistingDir(dirs, 'token.json') ?? dirs[0];
}

/** 从 token.json 里拼出 teambition cookie（sync 与实时探测共用）。 */
export function readCookie(tokFile) {
  const tok = JSON.parse(fs.readFileSync(tokFile, 'utf8'));
  return (tok.cookies ?? [])
    .filter((c) => String(c.domain ?? '').includes('teambition'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/** 实时检索用的登录态：返回 {ok, dir, cookie, state}，不抛异常。 */
export async function liveAuth(ctx, exec) {
  const dir = await tokenDir(ctx, exec);
  const state = checkToken(dir);
  try {
    const tok = JSON.parse(fs.readFileSync(path.join(dir, 'token.json'), 'utf8'));
    const cookie = (tok.cookies ?? [])
      .filter((c) => String(c.domain ?? '').includes('teambition'))
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    if (!cookie) return { ok: false, dir, state };
    return { ok: true, dir, cookie, state };
  } catch (error) {
    return { ok: false, dir, state, error: error?.message };
  }
}
