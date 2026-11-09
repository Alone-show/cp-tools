/**
 * 数据目录解析的公共实现。
 *
 * 三个子插件的数据目录约定不同（.cpdocs / .tbfw / .fixfinder），但查找顺序一致：
 *   环境变量 → 会话工作区 → workingDirectory.defaultDirectory → 进程 cwd
 * 这里只抽查找/创建/复制，不改变各域的环境变量名和默认子目录，旧数据无需迁移。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * 按统一顺序给出候选目录（已去重）。
 * @param {object|undefined} ctx Cordis ctx（只用到 get('workingDirectory')）
 * @param {{agent?: object, signal?: AbortSignal}|undefined} exec
 * @param {{envNames?: string[], subdir: string, includeCwd?: boolean}} options
 * @returns {Promise<string[]>}
 */
export async function candidateDirs(ctx, exec, { envNames = [], subdir, includeCwd = true } = {}) {
  const out = [];
  for (const name of envNames) {
    const value = process.env[name];
    if (value) out.push(path.resolve(value));
  }

  const wd = ctx?.get?.('workingDirectory');
  if (wd && exec?.agent) {
    try {
      const dir = await wd.ensure(exec.agent, exec.signal);
      if (dir) out.push(path.join(dir, subdir));
    } catch {
      /* 继续试下一个 */
    }
  }
  if (wd?.defaultDirectory) out.push(path.join(wd.defaultDirectory, subdir));
  if (includeCwd) out.push(path.join(process.cwd(), subdir));

  return [...new Set(out)];
}

/** 第一个包含 marker 文件的候选目录；没有则返回 undefined。 */
export function findExistingDir(dirs, marker) {
  return dirs.find((dir) => fs.existsSync(path.join(dir, marker)));
}

/**
 * 依次尝试创建候选目录，返回第一个可写的。
 * @param {string[]} dirs
 * @param {(dir: string) => void|Promise<void>} [prepare] 额外的子目录/文件准备
 */
export async function resolveWritableDir(dirs, prepare) {
  let lastErr;
  for (const dir of dirs) {
    try {
      await fs.promises.mkdir(dir, { recursive: true });
      if (prepare) await prepare(dir);
      return dir;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`无法创建数据目录，候选：${dirs.join(' | ')}（${lastErr?.message || ''}）`);
}

/** 递归复制目录（同步，保持 cp-docs 首次使用 copy-once 的语义）。 */
export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}
