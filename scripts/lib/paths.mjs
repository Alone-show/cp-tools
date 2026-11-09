/**
 * 脚本用的路径工具：从 cwd 向上找数据目录/工作区，避免从包目录运行时找错。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 从 start 向上找名为 name 的文件/目录，返回绝对路径或 null。 */
export function findUp(name, start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** 会话工作区根目录：以 .cpdocs / .tbfw / .fixfinder 为锚点，找不到返回 cwd。 */
export function workspaceRoot(start = process.cwd()) {
  for (const anchor of ['.cpdocs', '.tbfw', '.fixfinder']) {
    const hit = findUp(anchor, start);
    if (hit) return path.dirname(hit);
  }
  return path.resolve(start);
}

/** 数据目录：环境变量优先，其次从 cwd 向上找。 */
export function dataDir(envNames, subdir, start = process.cwd()) {
  for (const name of envNames) {
    if (process.env[name]) return path.resolve(process.env[name]);
  }
  return findUp(subdir, start);
}
