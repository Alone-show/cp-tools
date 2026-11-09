#!/usr/bin/env node
/**
 * 安装前/发布前的包清单校验：exports → 文件、bundle patch 三行、locale/icon、
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
    ['cp-docs', '@local/cp-tools/docs'],
    ['firmware-finder', '@local/cp-tools/firmware'],
    ['e9631service', '@local/cp-tools/cpservice'],
  ];
  for (const [id, name] of expected) {
    if (!new RegExp(`id:\\s*${id}\\b`).test(patch)) fail(`patch 缺 id: ${id}`);
    if (!patch.includes(`name: '${name}'`) && !patch.includes(`name: "${name}"`)) fail(`patch 缺 name: ${name}`);
  }
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
  { key: 'cpservice', mod: 'src/cpservice/index.js', locale: 'locale/cpservice', icon: 'icons/cpservice.svg' },
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

// 5) skill 与资源
const skills = [
  ['firmware', 'src/firmware/skills/firmware/SKILL.md'],
  ['cpservice', 'src/cpservice/skills/cpservice/SKILL.md'],
];
for (const [name, file] of skills) {
  const abs = path.join(ROOT, file);
  if (!fs.existsSync(abs)) {
    fail(`${name}: 缺 SKILL.md（${file}）`);
    continue;
  }
  const text = fs.readFileSync(abs, 'utf8');
  if (!new RegExp(`^name:\\s*${name}\\s*$`, 'm').test(text)) fail(`${name}: SKILL.md frontmatter name 不是 ${name}`);
  if (!/^description:\s*\S+/m.test(text)) fail(`${name}: SKILL.md 缺 description`);
}
for (const f of ['references/rk-android.md', 'references/t3-android.md', 'references/rk-debian.md', 'references/t3-linux.md', 'assets/verify.sh', 'assets/flash.sh']) {
  if (!fs.existsSync(path.join(ROOT, 'src/cpservice/skills/cpservice', f))) fail(`cpservice: 缺 ${f}`);
}

// 6) 数据与可复用二进制
const dataDir = path.join(ROOT, 'src/docs/data');
if (!fs.existsSync(path.join(dataDir, 'models.json'))) fail('docs: 缺 src/docs/data/models.json');
else {
  const models = readJson(path.join(dataDir, 'models.json')).models ?? [];
  note(`docs 数据：${models.length} 款机型`);
  if (models.length === 0) fail('docs: models.json 没有机型');
}
const vendorDir = path.join(ROOT, 'src/cpservice/skills/cpservice/vendor');
for (const f of ['README.md', 'fw_cyw43438.bin', 'nvram_cyw43438.txt']) {
  if (!fs.existsSync(path.join(vendorDir, f))) fail(`cpservice: 缺 vendor/${f}`);
}
if (!fs.existsSync(vendorDir) || !fs.readdirSync(vendorDir).some((f) => /^VanCoreT3-.*\.apk$/.test(f))) {
  fail('cpservice: 缺 vendor/VanCoreT3-*.apk');
}

// 7) files 覆盖
const files = pkg.files ?? [];
for (const required of ['src/**', 'locale/**', 'icons/**', 'scripts/**', 'cordis.patch.yml', 'README.md']) {
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

// 9) 运行期 JS 不应写死本机绝对路径
for (const file of walk(path.join(ROOT, 'src')).filter((p) => p.endsWith('.js'))) {
  const text = fs.readFileSync(file, 'utf8');
  if (text.includes('/home/my/')) fail(`${rel(file)} 写死了本机绝对路径`);
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
