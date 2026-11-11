/**
 * 读取并解析插件自带的 SKILL.md。
 *
 * 运行时注册（`ctx.skills.register`）不会自己读 frontmatter，所以这里解析后显式放进
 * `invocation`，否则模型侧目录不会出现这个 skill。
 *
 * 与 `@deepseek-ai/dsh-skill-filesystem` 的 frontmatter 语义保持一致：
 * `disable-model-invocation` 关掉模型侧目录，`user-invocable` 关掉用户侧 `/` 菜单。
 *
 * 这里是**单行 frontmatter** 的最小解析器（不引入 YAML 依赖）。它只保证一件事：
 * 认不出来就立刻报错，而不是猜一个值。历史上它会把 `description: >` 解析成字面量 `>`、
 * 把多行值截成第一行——skill 照常出现，但目录里的描述是错的，几乎不可能排查。
 */
import fs from 'node:fs';
import path from 'node:path';

/** Anthropic skill 规范 + DSH 扩展；出现别的键说明写错了或被上游改名了。 */
const ALLOWED_KEYS = new Set([
  'name',
  'description',
  'license',
  'allowed-tools',
  'metadata',
  'compatibility',
  'whenToUse',
  'disable-model-invocation',
  'user-invocable',
]);

/** 名字要能直接当 `/命令` 用：小写字母/数字，单连字符分隔，≤64。 */
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const BLOCK_SCALAR_RE = /^[>|][+-]?$/;

function unquote(value) {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) return value.slice(1, -1);
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function parseLines(frontmatter, skillFile) {
  const values = new Map();
  for (const line of frontmatter.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    // 缩进行是上一行键的嵌套内容（metadata 之类），本解析器不消费。
    if (/^\s/.test(line)) continue;
    const found = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!found) throw new Error(`${skillFile} frontmatter 这一行看不懂：${line}`);
    const [, key, rawValue] = found;
    if (!ALLOWED_KEYS.has(key)) {
      throw new Error(`${skillFile} frontmatter 有未支持的键 "${key}"（允许：${[...ALLOWED_KEYS].join(', ')}）`);
    }
    if (values.has(key)) throw new Error(`${skillFile} frontmatter 重复定义 "${key}"`);
    if (BLOCK_SCALAR_RE.test(rawValue.trim())) {
      throw new Error(
        `${skillFile} 的 "${key}" 用了 YAML 块标量（${rawValue.trim()}），本解析器只支持单行；请写成一行再用`,
      );
    }
    values.set(key, unquote(rawValue.trim()));
  }
  return values;
}

function flag(values, key, skillFile) {
  if (!values.has(key)) return undefined;
  const value = values.get(key).toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(value)) return true;
  if (['false', 'no', 'off', '0'].includes(value)) return false;
  // 静默按默认值处理会让「关掉模型侧目录」这类开关悄悄失效，所以直接报错。
  throw new Error(`${skillFile} 的 "${key}" 不是布尔值：${values.get(key)}`);
}

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
  if (!match) throw new Error(`${skillFile} 缺 YAML frontmatter（文件必须以 --- 开头）`);
  const values = parseLines(match[1], skillFile);

  const skillName = values.get('name') ?? '';
  const description = values.get('description') ?? '';
  if (!skillName || !description) {
    throw new Error(`${skillFile} 缺少 name/description frontmatter`);
  }
  if (!NAME_RE.test(skillName) || skillName.length > 64) {
    throw new Error(`${skillFile} 的 name "${skillName}" 不是合法 skill 名（小写字母/数字，单连字符分隔，≤64）`);
  }

  return {
    name: skillName,
    description,
    content: raw.slice(match[0].length),
    source: 'runtime',
    path: skillFile,
    resourceBase: { kind: 'directory', path: path.dirname(skillFile) },
    invocation: {
      modelInvocable: flag(values, 'disable-model-invocation', skillFile) !== true,
      userInvocable: flag(values, 'user-invocable', skillFile) !== false,
    },
  };
}
