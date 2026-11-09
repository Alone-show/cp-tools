/**
 * 读取并解析插件自带的 SKILL.md。
 *
 * 运行时注册（`ctx.skills.register`）不会自己读 frontmatter，所以这里解析后显式放进
 * `invocation`，否则模型侧目录不会出现这个 skill。
 *
 * 与 `@deepseek-ai/dsh-skill-filesystem` 的 frontmatter 语义保持一致：
 * `disable-model-invocation` 关掉模型侧目录，`user-invocable` 关掉用户侧 `/` 菜单。
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} skillFile 绝对路径
 * @returns {{
 *   name: string, description: string, content: string, source: 'runtime',
 *   path: string, resourceBase: {kind: 'directory', path: string},
 *   invocation: {modelInvocable: boolean, userInvocable: boolean},
 * }}
 */
export function readBundledSkill(skillFile) {
  const raw = fs.readFileSync(skillFile, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/);
  const frontmatter = match ? match[1] : '';
  const field = (key) => {
    const found = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    return found ? found[1].trim() : '';
  };
  const flag = (key) => {
    const found = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (!found) return undefined;
    const value = found[1].trim().toLowerCase();
    if (['true', 'yes', 'on', '1'].includes(value)) return true;
    if (['false', 'no', 'off', '0'].includes(value)) return false;
    return undefined;
  };

  const skillName = field('name');
  const description = field('description');
  if (!skillName || !description) {
    throw new Error(`${skillFile} 缺少 name/description frontmatter`);
  }

  return {
    name: skillName,
    description,
    content: match ? raw.slice(match[0].length) : raw,
    source: 'runtime',
    path: skillFile,
    resourceBase: { kind: 'directory', path: path.dirname(skillFile) },
    invocation: {
      modelInvocable: flag('disable-model-invocation') !== true,
      userInvocable: flag('user-invocable') !== false,
    },
  };
}
