#!/usr/bin/env node
/**
 * 安装前/发布前的包清单校验：exports → 文件、bundle patch 六行、locale/icon、
 * skill、vendor、files 覆盖、禁止进入包内的产物。
 *
 *   node scripts/check-package.mjs
 *
 * 退出码 0 = 可以安装/发布；1 = 有必须修复的问题。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const fail = (msg) => problems.push(msg);
const note = (msg) => notes.push(msg);
const rel = (p) => path.relative(ROOT, p);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const pkg = readJson(path.join(ROOT, 'package.json'));

// 1) 包清单
if (pkg.name !== '@local/cp-tools') fail(`package.name 应为 @local/cp-tools，实际 ${pkg.name}`);
if (pkg.type !== 'module') fail('package.type 应为 module');
if (!pkg.dsh?.bundle?.patch) fail('package.dsh.bundle.patch 缺失');

// 2) bundle patch：三行、名称与 id
const patchFile = path.join(ROOT, pkg.dsh?.bundle?.patch ?? 'cordis.patch.yml');
if (!fs.existsSync(patchFile)) {
  fail(`bundle patch 不存在：${rel(patchFile)}`);
} else {
  const patch = fs.readFileSync(patchFile, 'utf8');
  const expected = [
    ['cp-tools-web', '@local/cp-tools'],
    ['cp-docs', '@local/cp-tools/docs'],
    ['firmware-finder', '@local/cp-tools/firmware'],
    ['cp-tickets', '@local/cp-tools/tickets'],
    ['e9631service', '@local/cp-tools/cpservice'],
    ['cp-flash', '@local/cp-tools/flash'],
    ['cp-bpms', '@local/cp-tools/bpms'],
  ];
  for (const [id, name] of expected) {
    if (!new RegExp(`id:\\s*${id}\\b`).test(patch)) fail(`patch 缺 id: ${id}`);
    if (!patch.includes(`name: '${name}'`) && !patch.includes(`name: "${name}"`)) fail(`patch 缺 name: ${name}`);
  }
}

// 2.5) Web 客户端入口：声明了 dsh.client 就必须有 ./client 且能加载
if (pkg.dsh?.client) {
  if (pkg.dsh.client.platform !== 'web') fail(`dsh.client.platform 目前只支持 web，实际 ${pkg.dsh.client.platform}`);
  const clientExport = pkg.exports?.['./client'];
  if (typeof clientExport !== 'string') fail('声明了 dsh.client 但 exports 缺 "./client"');
  else if (!fs.existsSync(path.join(ROOT, clientExport))) fail(`exports["./client"] 目标不存在：${clientExport}`);
  // client-modules 只扫描「模块名正好等于包名」的插件行；缺这一行，浏览器端永远不加载。
  const rootExport = pkg.exports?.['.'];
  if (typeof rootExport !== 'string') fail('声明了 dsh.client 但 exports 缺 "."（包根入口）');
  else if (!fs.existsSync(path.join(ROOT, rootExport))) fail(`exports["."] 目标不存在：${rootExport}`);
  const rootRow = new RegExp(`name:\\s*['"]${pkg.name.replace(/[/@]/g, (c) => `\\${c}`)}['"]`).test(
    fs.readFileSync(patchFile, 'utf8'),
  );
  if (!rootRow) fail(`bundle patch 缺包根行：name: '${pkg.name}'（否则 dsh.client 不会被发现）`);
}

// 3) exports → 目标文件
const exportsMap = pkg.exports ?? {};
for (const [key, target] of Object.entries(exportsMap)) {
  if (typeof target !== 'string') {
    fail(`exports[${key}] 不是字符串`);
    continue;
  }
  if (key.includes('*')) {
    const dir = path.dirname(path.join(ROOT, target));
    if (!fs.existsSync(dir)) fail(`exports[${key}] 目录不存在：${rel(dir)}`);
    continue;
  }
  const file = path.join(ROOT, target);
  if (!fs.existsSync(file)) fail(`exports[${key}] 目标不存在：${target}`);
}

// 4) 三个子插件：模块 / locale / icon
const subplugins = [
  { key: 'docs', mod: 'src/docs/index.js', locale: 'locale/docs', icon: 'icons/docs.svg' },
  { key: 'firmware', mod: 'src/firmware/index.js', locale: 'locale/firmware', icon: 'icons/firmware.svg' },
  { key: 'tickets', mod: 'src/tickets/index.js', locale: 'locale/tickets', icon: 'icons/tickets.svg' },
  { key: 'cpservice', mod: 'src/cpservice/index.js', locale: 'locale/cpservice', icon: 'icons/cpservice.svg' },
  { key: 'flash', mod: 'src/flash/index.js', locale: 'locale/flash', icon: 'icons/flash.svg' },
  { key: 'bpms', mod: 'src/bpms/index.js', locale: 'locale/bpms', icon: 'icons/bpms.svg' },
];
for (const sub of subplugins) {
  if (!fs.existsSync(path.join(ROOT, sub.mod))) fail(`${sub.key}: 缺模块 ${sub.mod}`);
  for (const lang of ['zh', 'en']) {
    const file = path.join(ROOT, sub.locale, `${lang}.json`);
    if (!fs.existsSync(file)) {
      fail(`${sub.key}: 缺 ${rel(file)}`);
      continue;
    }
    try {
      const meta = readJson(file)?.meta ?? {};
      if (!meta.title) fail(`${sub.key}/${lang}: meta.title 为空`);
      if (!meta.description) fail(`${sub.key}/${lang}: meta.description 为空`);
    } catch (err) {
      fail(`${sub.key}/${lang}: JSON 解析失败 ${err.message}`);
    }
  }
  const icon = path.join(ROOT, sub.icon);
  if (!fs.existsSync(icon)) fail(`${sub.key}: 缺图标 ${sub.icon}`);
  else {
    const size = fs.statSync(icon).size;
    if (size > 256 * 1024) fail(`${sub.key}: 图标超过 256KiB（${size}）`);
  }
}

// 5) skill：Anthropic Agent Skills 规范（skill-creator/quick_validate.py）+ DSH 契约
//    规范里这些是硬约束，写错了不会报错，只会让 skill 静默不触发，所以放进包里必须拦。
const SKILL_KEYS = new Set([
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
const SKILL_MAX_LINES = 500;
const DESC_MAX = 1024;
// DSH 的模型侧 skill catalog 默认把 description 截到 500 字符（@deepseek-ai/dsh-tool-skill
// 的 catalogDescriptionMaxLength 默认值）。超出部分模型看不到，所以这里按 500 硬拦，
// 避免再出现「写了 200 个关键词、后 500 字符全是死重」的 skill。
const CATALOG_DESC_MAX = 500;
const skills = [
  ['firmware', 'src/firmware/skills/firmware/SKILL.md'],
  ['tickets', 'src/tickets/skills/tickets/SKILL.md'],
  ['cpservice', 'src/cpservice/skills/cpservice/SKILL.md'],
  ['flash', 'src/flash/skills/flash/SKILL.md'],
  ['bpms', 'src/bpms/skills/bpms/SKILL.md'],
];
for (const [name, file] of skills) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    fail(`${name}: 缺 SKILL.md（${file}）`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) {
    fail(`${name}: SKILL.md 缺 YAML frontmatter`);
    continue;
  }
  for (const line of fm[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s/.test(line) || line.trim().startsWith('#')) continue;
    const key = (line.match(/^([A-Za-z0-9_-]+):/) || [])[1];
    if (!key) {
      fail(`${name}: frontmatter 无法解析：${line}`);
      continue;
    }
    if (!SKILL_KEYS.has(key)) fail(`${name}: frontmatter 键 ${key} 不在规范允许列表内`);
  }
  const nameLine = /^name:\s*(.+)$/m.exec(fm[1]);
  if (!nameLine) fail(`${name}: SKILL.md 缺 name`);
  else if (nameLine[1].trim() !== name) fail(`${name}: SKILL.md frontmatter name 不是 ${name}`);
  const descLine = /^description:\s*(.+)$/m.exec(fm[1]);
  if (!descLine) fail(`${name}: SKILL.md 缺 description`);
  else {
    const description = descLine[1].trim();
    if (/^[>|][+-]?$/.test(description)) fail(`${name}: description 是 YAML 块标量，运行时只支持单行`);
    else {
      const len = description.replace(/^(["'])(.*)\1$/, '$2').length;
      if (len > DESC_MAX) fail(`${name}: description ${len} 字符，超出规范上限 ${DESC_MAX}`);
      else if (len > CATALOG_DESC_MAX) {
        fail(
          `${name}: description ${len} 字符，超出 DSH 模型目录默认截断长度 ${CATALOG_DESC_MAX}（超出部分模型看不到）`,
        );
      }
      if (/[<>]/.test(description)) fail(`${name}: description 不能含尖括号（规范要求）`);
    }
  }
  const lines = text.split(/\r?\n/).length;
  if (lines > SKILL_MAX_LINES) fail(`${name}: SKILL.md ${lines} 行，超出 ${SKILL_MAX_LINES} 行预算`);
  const skillDir = path.dirname(abs);
  const refs = new Set(
    [...text.matchAll(/`((?:references|assets|scripts)\/[^`\s]+)`/g)].map((m) => m[1].replace(/\/+$/, '')),
  );
  for (const ref of refs) {
    if (ref.includes('*')) continue; // `references/*.md` 是说明用的通配写法，不是具体路径
    if (!fs.existsSync(path.join(skillDir, ref))) fail(`${name}: SKILL.md 引用了不存在的 ${ref}`);
  }
  for (const sh of walk(skillDir).filter((p) => p.endsWith('.sh'))) {
    if (!(fs.statSync(sh).mode & 0o111)) fail(`${name}: ${rel(sh)} 缺可执行位（SKILL 里按一条命令跑）`);
  }
}
for (const f of ['references/rk-android.md', 'references/t3-android.md', 'references/rk-debian.md', 'references/t3-linux.md', 'assets/verify.sh']) {
  if (!fs.existsSync(path.join(ROOT, 'src/cpservice/skills/cpservice', f))) fail(`cpservice: 缺 ${f}`);
}
if (fs.existsSync(path.join(ROOT, 'src/cpservice/skills/cpservice/assets/flash.sh'))) {
  fail('cpservice: assets/flash.sh 应已迁到 src/flash（避免两份脚本漂移）');
}
const flashSkillDir = path.join(ROOT, 'src/flash/skills/flash');
for (const f of ['SKILL.md', 'references/flash.md', 'assets/flash.sh', 'assets/tools/rk_upgrade_tool', 'assets/tools/openixcli', 'assets/tools/VERSIONS.md']) {
  if (!fs.existsSync(path.join(flashSkillDir, f))) fail(`flash: 缺 ${f}`);
}

// 6) 数据与可复用二进制
const dataDir = path.join(ROOT, 'src/docs/data');
if (!fs.existsSync(path.join(dataDir, 'models.json'))) fail('docs: 缺 src/docs/data/models.json');
else {
  const models = readJson(path.join(dataDir, 'models.json')).models ?? [];
  note(`docs 数据：${models.length} 款机型`);
  if (models.length === 0) fail('docs: models.json 没有机型');
  // 运行期 data 只在用户第一次 /cp-docs 时才读，缺文件要等到现场才炸，所以这里逐个核。
  const ids = new Set();
  for (const entry of models) {
    if (!entry?.id) fail('docs: models.json 有缺 id 的机型');
    else if (ids.has(entry.id)) fail(`docs: models.json 机型 id 重复：${entry.id}`);
    else ids.add(entry.id);
    for (const key of ['spec', 'programming', 'workpoints']) {
      const refPath = entry?.[key];
      if (!refPath) continue;
      const abs = path.join(dataDir, refPath);
      if (!abs.startsWith(dataDir)) fail(`docs: ${entry.id}.${key} 指向数据目录之外（${refPath}）`);
      else if (!fs.existsSync(abs)) fail(`docs: 缺 ${refPath}（${entry.id}.${key}）`);
      else {
        try {
          readJson(abs);
        } catch {
          fail(`docs: ${refPath} 不是合法 JSON`);
        }
      }
    }
  }
}
const vendorDir = path.join(ROOT, 'src/cpservice/skills/cpservice/vendor');
for (const f of ['README.md', 'MDM', 'fw_cyw43438.bin', 'nvram_cyw43438.txt']) {
  if (!fs.existsSync(path.join(vendorDir, f))) fail(`cpservice: 缺 vendor/${f}`);
}
if (!fs.existsSync(vendorDir) || !fs.readdirSync(vendorDir).some((f) => /^VanCoreT3-.*\.apk$/.test(f))) {
  fail('cpservice: 缺 vendor/VanCoreT3-*.apk');
}

// 7) files 覆盖
const files = pkg.files ?? [];
for (const required of ['src/**', 'locale/**', 'icons/**', 'scripts/**', 'cordis.patch.yml', 'README.md', 'bpms_config.example.json']) {
  if (!files.includes(required)) fail(`package.files 缺 ${required}`);
}
if (files.some((f) => f.startsWith('test') || f.startsWith('docs/'))) fail('package.files 不应包含 test/ 或 docs/');

// 8) 禁止进入包内的产物
const forbidden = walk(ROOT).filter((p) => {
  const r = rel(p);
  return /(^|\/)(node_modules|\.tbfw|\.fixfinder|\.cpdocs)(\/|$)/.test(r)
    || /\.bak-/.test(r)
    || /\/\.DS_Store$/.test(r);
});
for (const p of forbidden) fail(`包内不应出现：${rel(p)}`);

// 9) 随包文本不应写死本机绝对路径
//    之前只扫 *.js，结果 src/docs/data/models.json（会真的发给用户）里带着构建机路径也放行；
//    这里按「会随包发布的文本」整体扫，二进制（vendor/、tools/）跳过。
const HOME_PATH_RE = /\/home\/[A-Za-z0-9._-]+\/|\/Users\/[A-Za-z0-9._-]+\//;
for (const file of walk(path.join(ROOT, 'src')).filter((p) => /\.(js|mjs|json|md|sh|txt)$/.test(p))) {
  const text = fs.readFileSync(file, 'utf8');
  if (HOME_PATH_RE.test(text)) fail(`${rel(file)} 写死了本机绝对路径`);
}

// 10) 体积报告
const size = walk(ROOT)
  .filter((p) => !rel(p).startsWith('test/') && !rel(p).startsWith('docs/'))
  .reduce((sum, p) => sum + fs.statSync(p).size, 0);
note(`预计安装体积：${(size / 1024 / 1024).toFixed(1)} MiB`);

for (const n of notes) console.log(`· ${n}`);
if (problems.length) {
  console.error(`\n✗ ${problems.length} 个问题：`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('\n✓ 包清单校验通过');
