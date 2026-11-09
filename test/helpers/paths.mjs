/**
 * 测试用路径工具：合并后测试目录变深，不再写死 `../../../.cpdocs`。
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

/** 会话工作区里的 .cpdocs（找不到返回 null）。 */
export function cpDocsDir(start = process.cwd()) {
  return findUp('.cpdocs', start);
}

/** 会话工作区根目录（以 .cpdocs 为锚点，找不到返回 null）。 */
export function workspaceDir(start = process.cwd()) {
  const hit = findUp('.cpdocs', start);
  return hit ? path.dirname(hit) : null;
}
