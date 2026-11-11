// 离线冒烟测试：不启动 dsh，直接用假 ctx 验证插件契约 + 文档结构。
//   node test/smoke.mjs
//
// 除「能注册」外，还守护整理后的结构约束（去重 / 链接 / 事实清单），
// 避免以后又把同一份内容抄回三个文件。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, inject, name, readBundledSkill, __internals } from '../../src/cpservice/index.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL_DIR = path.join(PKG_ROOT, 'src', 'cpservice', 'skills', 'cpservice');
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8');
const headingsOf = (text) => new Set([
  ...[...text.matchAll(/^## (\d+)\./gm)].map((x) => x[1]),
  ...[...text.matchAll(/^### (\d+\.\d+)/gm)].map((x) => x[1]),
]);

// 1) 插件契约
assert.equal(name, 'e9631service', 'cordis 插件名');
assert.deepEqual(inject, ['skills'], 'inject 需要 skills 服务');

// 2) frontmatter 与注册
const skill = readBundledSkill();
assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'skill 名必须符合 dsh 的 SKILL_NAME 正则');
assert.equal(skill.name, 'cpservice', 'skill 名（调用命令 /cpservice）');
assert.ok(skill.description.includes('E9631Service.xml'), 'description 含 T3 xml 名');
assert.ok(skill.description.includes('CpService'), 'description 含 RK 工具/xml 关键词');
assert.ok(skill.content.length > 2000, 'skill 正文非空');
assert.ok(!skill.content.startsWith('---'), '正文不含 frontmatter');
assert.equal(skill.resourceBase.kind, 'directory');
assert.equal(skill.resourceBase.path, SKILL_DIR, 'resourceBase 指向 skill/');
assert.equal(skill.invocation.modelInvocable, true);
assert.equal(skill.invocation.userInvocable, true);

const registered = [];
apply({ skills: { register: (s) => { registered.push(s); return () => {}; } } });
assert.equal(registered.length, 1, '注册了一个 skill');
assert.equal(registered[0].name, 'cpservice');

// 3) 平台分流
const refs = ['rk-android.md', 't3-android.md', 'rk-debian.md', 't3-linux.md'];
for (const f of refs) {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', f)), `缺少 references/${f}`);
  assert.ok(skill.content.includes(`references/${f}`), `SKILL.md 未指向 references/${f}`);
}

// 4) 判定入口
assert.ok(skill.content.includes('pm path com.cpdevice.cpservice'), 'SKILL.md 缺 RK 判定命令');
assert.ok(skill.content.includes('pm path com.android.guard'), 'SKILL.md 缺 T3 判定命令');
assert.ok(skill.content.includes('CpService.xml') && skill.content.includes('E9631Service.xml'), 'SKILL.md 缺两个 xml 名');
assert.ok(!/mmcblk0p7/.test(skill.content), '调度器里不应出现 T3 专用分区路径（留在 t3 参考）');
assert.ok(skill.content.includes('/etc/os-release') && skill.content.includes('unattendedinstallationtools'), 'SKILL.md 缺 Debian 判定依据');
assert.ok(skill.content.includes('/Launcher') && skill.content.includes('Buildroot'), 'SKILL.md 缺 T3 Linux 判定依据');
assert.ok(skill.content.includes('auto_unattended_installation/auto_unattended_installation.sh'), 'SKILL.md 缺 Debian udev 入口');
assert.ok(skill.content.includes('unattended_installation.sh') && skill.content.includes(':uisum'), 'SKILL.md 缺 Debian 手动入口/:uisum');
assert.ok(skill.description.includes('Debian'), 'description 含 Debian 关键词');
assert.ok(skill.description.includes('T3 Linux') && skill.description.includes('Buildroot'), 'description 含 T3 Linux/Buildroot 关键词');

// 5) 文件索引 == 磁盘
const listed = new Set();
for (const m of skill.content.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) listed.add(m[1]);
for (const f of fs.readdirSync(path.join(SKILL_DIR, 'assets'))) {
  assert.ok(listed.has(f), `assets/${f} 没有出现在 SKILL.md 文件索引里`);
}
for (const f of listed) {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'assets', f)), `SKILL.md 引用了不存在的 assets/${f}`);
}
assert.ok(!fs.existsSync(path.join(SKILL_DIR, 'assets', 'verify-rk.sh')), 'verify-rk.sh 应已并入 verify.sh');

// 6) verify.sh 统一入口
const verifier = read('assets/verify.sh');
assert.ok(verifier.includes('--rk') && verifier.includes('--t3') && verifier.includes('--debian') && verifier.includes('--t3linux') && verifier.includes('auto'), 'verify.sh 应支持 --rk/--t3/--debian/--t3linux/auto');
assert.ok(verifier.includes('ro.board.platform'), 'verify.sh 应能按平台自动判断');
assert.ok(verifier.includes('/etc/os-release'), 'verify.sh 应能识别 Debian');
assert.ok(verifier.includes('buildroot') || verifier.includes('Buildroot'), 'verify.sh 应能识别 T3 Linux（Buildroot）');

// 7) 平台差异表唯一（SKILL §5.2）
for (const f of refs) {
  const body = read(`references/${f}`);
  assert.ok(!/与 T3 的差异|与 RK 安卓的差异/.test(body), `references/${f} 不应再有镜像差异表`);
  assert.ok(!/^\| 维度 \|/m.test(body), `references/${f} 不应再有「维度」差异表`);
}

// 8) 验证策略唯一
assert.ok(skill.content.includes('只跑一轮'), 'SKILL.md 应保留「只跑一轮」策略');
for (const f of refs) {
  assert.ok(!read(`references/${f}`).includes('只跑一轮'), `references/${f} 不应重复「只跑一轮」`);
}

// 9) OTG 唯一权威（SKILL §7.3）
assert.ok(/### 7\.3 重启与 OTG/.test(skill.content), 'SKILL.md 应有 §7.3 重启与 OTG');
// 20261109：§7.3 改为「等回线，超时才提示」；不再要求一发出就提示
assert.ok(!skill.content.includes('一发出就提示'), 'SKILL.md 不应再要求 reboot 一发出就提示');
for (const f of refs) {
  const body = read(`references/${f}`);
  assert.ok(!/### .*OTG/.test(body), `references/${f} 不应再设 OTG 小节`);
  assert.ok(body.includes('§7.3'), `references/${f} 应引用 SKILL §7.3`);
}

// 20261109：通用规则只写一处——「安卓默认 OTG Host」只允许出现在 SKILL §7.3
const ruleHits = ['SKILL.md', ...refs.map((f) => `references/${f}`)].reduce(
  (n, f) => n + (read(f).match(/OTG Host/g) || []).length, 0);
assert.equal(ruleHits, 1, '「OTG Host」通用规则只能在 SKILL §7.3 写一次，其它地方引用 §7.3');
const sec73 = skill.content.split('### 7.3')[1].split('### 7.4')[0];
assert.ok(sec73.includes('安卓默认 OTG Host'), '§7.3 应写明通用规则「安卓默认 OTG Host」');
assert.ok(sec73.includes('RK 安卓') && sec73.includes('T3 安卓'), '规则应同时覆盖 RK 安卓与 T3 安卓');
assert.ok(sec73.includes('刷机') && sec73.includes('重启后'), '规则应覆盖刷机与重启两种入口');
assert.ok(sec73.includes('提示时机'), '§7.3 应说明什么时候提示');
assert.ok(sec73.includes('不预先提示'), '§7.3 应写明不预先提示');
assert.ok(sec73.includes('超时'), '§7.3 应写明超时才提示');
assert.ok(sec73.includes('loader/FEL'), '§7.3 应排除下载模式，避免线刷期间误报');
for (const f of refs) {
  const body = read(`references/${f}`);
  assert.ok(!/OTG Host/.test(body), `references/${f} 不应复述规则，引用 §7.3 即可`);
}

// 10) 事实清单（迁移不能丢）
const facts = {
  'references/t3-android.md': [
    'com.android.guard', 'E9631Service.xml', 'bootlogo', '/bootloader/', 'mmcblk0p7',
    'srcfile', 'udiskfile', 'dstdir', 'awk: not found', 'ls -ln', 'while read',
    'stat -c', 'no_reboot', 'otg_role', 'MEDIA_MOUNTED', 'USBReceiver', 'XmlPullParser',
    '55 s', '2.5 min', 'VanCoreT3', 'fw_cyw43438.bin', 'nvram_cyw43438.txt',
    'dmesg', 'launcher.db', 'udisk(id=TEST)', 'TaskThread',
  ],
  'references/rk-android.md': [
    'com.cpdevice.cpservice', 'CpService.xml', '7.5.4', 'param1', 'runlimit', 'copyout',
    'system uid', '/data/media/bootanimation.zip', '/dev/block/by-name/logo',
    'sm set-virtual-disk', 'rk-virtual-disk.sh', '511', '314', '62%', '70 s', '3～4 s',
    'dm-0', 'verity', 'wallpaper.set', 'install_apk.xml', 'Virtual SD 卡', '_Command',
    'vacay', '假挂载', '21',
  ],
  'references/rk-debian.md': [
    'unattendedinstallationtools', 'silentInstaller', 'auto_unattended_installation.sh',
    'unattended_installation.sh', '/media/usb_disk', '/mnt/installUsb', ':uisum',
    'eeprom_config.json', '391', 'flock', 'otg_mode', 'dpkg -i', 'journalctl',
    '/run/auto_unattended_installation.sh', 'x11grab', '1.0.4',
  ],
  'references/t3-linux.md': [
    'Buildroot', '/Launcher', '/mnt/usb/sda1', 'unattended_installation.sh',
    '/dev/mmcblk0p2', 'bootlogo.bmp', '/data/cp-unattended', 'udisk_setting.cpp',
    '静默安装', 'Permission denied', 'tar xf', 'bash 4.3', 'cwd',
    '--logo-frames', '不旋转', 'hflip,vflip',
  ],
  'SKILL.md': [
    '--xml---action---', 'PATH', 'NO_REBOOT', 'YYYYMMDD', 'verify-report.md',
    '§7.3', '§5.2', '只跑一轮', '超时才提示', 'Buildroot', '/Launcher',
    'assets/presets', '--logo-frames', '不旋转', '--model', 'SPRING2PRO',
  ],
};
for (const [file, needles] of Object.entries(facts)) {
  const body = read(file);
  for (const n of needles) assert.ok(body.includes(n), `${file} 丢了事实「${n}」`);
}

// 11) 链接与章节守卫
for (const file of ['SKILL.md', ...refs.map((f) => `references/${f}`)]) {
  const body = read(file);
  for (const m of body.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'assets', m[1])), `${file} 引用了不存在的 assets/${m[1]}`);
  }
  for (const m of body.matchAll(/references\/([A-Za-z0-9._-]+\.md)/g)) {
    assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', m[1])), `${file} 引用了不存在的 references/${m[1]}`);
  }
  const selfHeadings = headingsOf(body);
  const skHeadings = headingsOf(skill.content);
  const rkHeadings = headingsOf(read('references/rk-android.md'));
  const t3Headings = headingsOf(read('references/t3-android.md'));
  const debianHeadings = headingsOf(read('references/rk-debian.md'));
  const linuxHeadings = headingsOf(read('references/t3-linux.md'));
  for (const m of body.matchAll(/§(\d+(?:\.\d+)?)/g)) {
    const before = body.slice(Math.max(0, m.index - 40), m.index);
    const pool = /SKILL/i.test(before) ? skHeadings
      : /t3-linux/i.test(before) ? linuxHeadings
      : /rk-debian/i.test(before) ? debianHeadings
      : /t3-android/i.test(before) ? t3Headings
      : /rk-android/i.test(before) ? rkHeadings
      : selfHeadings;
    assert.ok(pool.has(m[1]), `${file} 引用了不存在的章节「§${m[1]}」（上下文：${before.slice(-20).trim()}）`);
  }
}

// 12) 行数预算（软提醒）
// 20261106：加 §8.4 logo 生成，SKILL 预算 340 → 380
// 20261111：加 §3.1 logo 方向（R180 / yuv 不旋转）与坑表，t3-linux 预算 285 → 300
const budgets = { 'SKILL.md': 430, 'references/rk-android.md': 310, 'references/t3-android.md': 240, 'references/rk-debian.md': 380, 'references/t3-linux.md': 300 };
for (const [file, max] of Object.entries(budgets)) {
  const n = read(file).split('\n').length;
  if (n > max) console.warn(`⚠ ${file} 现有 ${n} 行，超出预算 ${max}`);
}

// 13) 路径常量 + 可复用二进制（合并后从插件根移到 skill 目录，必须随包发布）
assert.equal(__internals.SKILL_FILE, path.join(SKILL_DIR, 'SKILL.md'));
const VENDOR_DIR = path.join(SKILL_DIR, 'vendor');
for (const f of ['README.md', 'fw_cyw43438.bin', 'nvram_cyw43438.txt']) {
  assert.ok(fs.existsSync(path.join(VENDOR_DIR, f)), `缺少 vendor/${f}`);
}
assert.ok(fs.readdirSync(VENDOR_DIR).some((f) => /^VanCoreT3-.*\.apk$/.test(f)), '缺少 vendor/VanCoreT3-*.apk');

// 14) logo 生成：驱动 + 上游原样副本 + 一致性
//   上游 sha256 固定在这里：上游一改，这条先红，提醒重录基准。
const UPSTREAM_SHA256 = '0687c04527849bf27190cbf1e6862f6098893d63d766432f21e79ec8d42646dc';
const DRIVER = path.join(SKILL_DIR, 'assets', 'generate-bootlogo.sh');
const VENDOR = path.join(SKILL_DIR, 'assets', 'vendor', 'generate_bootlogo.sh');
for (const f of [DRIVER, VENDOR]) {
  assert.ok(fs.existsSync(f), `缺少 ${path.relative(SKILL_DIR, f)}`);
  assert.ok(fs.statSync(f).mode & 0o100, `${path.relative(SKILL_DIR, f)} 需要可执行位`);
  assert.equal(execFileSync('bash', ['-n', f], { encoding: 'utf8' }).trim(), '', `${path.relative(SKILL_DIR, f)} 语法错误`);
}
assert.equal(createHash('sha256').update(fs.readFileSync(VENDOR)).digest('hex'), UPSTREAM_SHA256,
  'vendor 副本与上游不一致（上游改了？重录基准或更新副本）');

const driver = (...args) => spawnSync(DRIVER, args, { encoding: 'utf8', timeout: 120000 });
assert.equal(driver('--help').status, 0, '--help 应退出 0');
for (const word of ['RK_Android', 'RK_Linux', 'T3_Android', 'T3_Linux', '--rotate', '--logo-frames', '--model', '--no-video', '--assets-only', '--check']) {
  assert.ok(driver('--help').stdout.includes(word), `--help 缺 ${word}`);
}
assert.equal(driver('--chip', 'RK').status, 2, '缺 --image 应退出 2');

// yuv 恒不旋转：gen_yuv 的 ffmpeg 不能带 ROTATE_FILTER（现场：fb1 视频层方向与 logo 层不同）
{
  const src = fs.readFileSync(DRIVER, 'utf8');
  const genYuv = src.slice(src.indexOf('gen_yuv()'), src.indexOf('gen_logo_raw()'));
  assert.ok(genYuv.length > 0, '驱动里找不到 gen_yuv');
  assert.ok(!genYuv.includes('ROTATE_FILTER'), 'gen_yuv 不应使用 ROTATE_FILTER（yuv 不旋转）');
}

const hasFfmpeg = spawnSync('bash', ['-c', 'command -v ffmpeg && command -v ffprobe'], { encoding: 'utf8' }).status === 0;
if (!hasFfmpeg) {
  console.log('  (skip logo 生成用例：本机没有 ffmpeg/ffprobe)');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-smoke-'));
  const png = path.join(tmp, 'in1024.png');
  const pngBig = path.join(tmp, 'in1280.png');
  const bad = path.join(tmp, 'bad800.png');
  const ff = (size, out) => execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi',
    '-i', `testsrc2=size=${size}:duration=1:rate=1`, '-frames:v', '1', out]);
  try {
    ff('1024x600', png); ff('1280x800', pngBig); ff('800x480', bad);

    // 尺寸不符 → 退出 4
    assert.equal(driver('--image', bad, '--chip', 'RK', '--system', 'Android', '--out', tmp).status, 4, '800x480 应退出 4');

    const expect = {
      RK_Android: { files: ['logo.img', 'CpService.xml'], main: 'logo.img', size: (w, h) => (54 + w * h * 3) * 2 + 458 },
      RK_Linux: { files: ['logo.img', 'unattended_installation.sh'], main: 'logo.img', size: (w, h) => (54 + w * h * 3) * 2 + 458 },
      T3_Android: { files: ['bootlogo.bmp', 'E9631Service.xml'], main: 'bootlogo.bmp', size: (w, h) => 54 + w * h * 3 },
      T3_Linux: { files: ['bootlogo.bmp', 'logo', 'unattended_installation.sh'], main: 'logo', size: (w, h) => w * h * 4 },
    };
    const outRoot = path.join(tmp, 'out');
    for (const [combo, spec] of Object.entries(expect)) {
      const [chip, system] = combo.split('_');
      const r = driver('--image', png, '--chip', chip, '--system', system, '--name', 'smoke', '--out', outRoot, '--no-video');
      assert.equal(r.status, 0, `${combo} 生成失败：${r.stderr}`);
      const dir = fs.readdirSync(outRoot).find((d) => d.startsWith(`${combo}_smoke_`));
      assert.ok(dir, `${combo} 输出目录命名应为 <CHIP>_<SYSTEM>_<name>_<YYYYMMDD>`);
      const got = fs.readdirSync(path.join(outRoot, dir)).sort();
      assert.deepEqual(got, [...spec.files].sort(), `${combo} 文件集不符`);
      const main = path.join(outRoot, dir, spec.main);
      assert.equal(fs.statSync(main).size, spec.size(1024, 600), `${combo} ${spec.main} 尺寸不符`);
      assert.equal(driver('--check', path.join(outRoot, dir)).status, 0, `${combo} --check 应通过`);
    }

    // SPRING1/SPRING2/SPRING2PRO 屏幕 180°：--model 命中且缺 --rotate 必须退出 2
    for (const m of ['SPRING1', 'SPRING2', 'SPRING2PRO', 'spring 2 pro', 'SPRING2_L']) {
      assert.equal(driver('--image', png, '--chip', 'T3', '--system', 'Linux', '--model', m, '--dry-run', '--out', outRoot).status, 2,
        `--model ${m} 缺 --rotate 应退出 2`);
      assert.equal(driver('--image', png, '--chip', 'T3', '--system', 'Linux', '--model', m, '--rotate', '--dry-run', '--out', outRoot).status, 0,
        `--model ${m} 带 --rotate 应通过`);
    }
    assert.equal(driver('--image', png, '--chip', 'T3', '--system', 'Linux', '--model', 'APOLLO2', '--dry-run', '--out', outRoot).status, 0,
      '非 SPRING 机型不应被强制 --rotate');

    // T3 Linux 双帧 logo（SPRING2_L 原机 /logo 4,915,200 B）：--logo-frames 2
    const r2 = driver('--image', png, '--chip', 'T3', '--system', 'Linux', '--name', 'twice', '--out', outRoot, '--no-video', '--logo-frames', '2');
    assert.equal(r2.status, 0, `T3_Linux 双帧生成失败：${r2.stderr}`);
    const dir2 = fs.readdirSync(outRoot).find((d) => d.startsWith('T3_Linux_twice_'));
    assert.ok(dir2, '双帧输出目录缺失');
    assert.equal(fs.statSync(path.join(outRoot, dir2, 'logo')).size, 1024 * 600 * 4 * 2, '双帧 logo 应为 4,915,200 B');
    assert.equal(driver('--check', path.join(outRoot, dir2)).status, 0, '双帧 --check 应通过');
    assert.equal(driver('--image', png, '--chip', 'T3', '--system', 'Linux', '--out', outRoot, '--logo-frames', '3').status, 2, '--logo-frames 3 应退出 2');

    // 1280x800 → logo.img 6,144,566（与现场包 shantui 一致）
    driver('--image', pngBig, '--chip', 'RK', '--system', 'Android', '--name', 'big', '--out', outRoot);
    const bigDir = path.join(outRoot, fs.readdirSync(outRoot).find((d) => d.startsWith('RK_Android_big_')));
    assert.equal(fs.statSync(path.join(bigDir, 'logo.img')).size, 6144566, '1280x800 logo.img 应为 6,144,566 B');

    // 坏包：留清单、删媒体 → --check 退出 6
    const broken = path.join(tmp, 'broken');
    fs.cpSync(path.join(outRoot, fs.readdirSync(outRoot).find((d) => d.startsWith('T3_Android_smoke_'))), broken, { recursive: true });
    fs.rmSync(path.join(broken, 'bootlogo.bmp'));
    assert.equal(driver('--check', broken).status, 6, '缺媒体但留清单应退出 6');

    // 与上游逐字节一致（未旋转路径）：logo.img / bootlogo.bmp / 两个 xml
    const up = path.join(tmp, 'up');
    fs.mkdirSync(up);
    fs.copyFileSync(VENDOR, path.join(up, 'generate_bootlogo.sh'));
    fs.chmodSync(path.join(up, 'generate_bootlogo.sh'), 0o755);
    const runUpstream = (answers) => spawnSync('bash', [path.join(up, 'generate_bootlogo.sh')],
      { input: answers.join('\n') + '\n', encoding: 'utf8', timeout: 120000 });
    assert.equal(runUpstream([png, 'n', '1', '2', 'parity']).status, 0, '上游 RK_Android 失败');
    assert.equal(runUpstream([png, 'n', '2', '2', 'parity']).status, 0, '上游 T3_Android 失败');
    const pairs = [
      ['RK_Android_smoke_', 'RK_Android_parity_', 'logo.img'],
      ['RK_Android_smoke_', 'RK_Android_parity_', 'CpService.xml'],
      ['T3_Android_smoke_', 'T3_Android_parity_', 'bootlogo.bmp'],
      ['T3_Android_smoke_', 'T3_Android_parity_', 'E9631Service.xml'],
    ];
    for (const [driverPrefix, upPrefix, file] of pairs) {
      const d1 = fs.readdirSync(outRoot).find((d) => d.startsWith(driverPrefix));
      const d2 = fs.readdirSync(up).find((d) => d.startsWith(upPrefix));
      const a = fs.readFileSync(path.join(outRoot, d1, file));
      const b = fs.readFileSync(path.join(up, d2, file));
      assert.ok(a.equals(b), `${file} 与上游不一致（驱动漂移或上游改版）`);
    }
    console.log('  logo: 4 组合生成 + 尺寸公式 + --check + 与上游逐字节一致 OK');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 15) 预置「中性」logo/动画包（RK 安卓，仅当需求明确要中性时才用）
const PRESET = path.join(SKILL_DIR, 'assets', 'presets', 'rk-android-neutral');
const PRESET_REL = 'assets/presets/rk-android-neutral';
for (const f of ['logo.img', 'bootanimation.zip', 'CpService.xml', 'README.md']) {
  assert.ok(fs.existsSync(path.join(PRESET, f)), `缺少 ${PRESET_REL}/${f}`);
}
assert.ok(skill.content.includes('assets/presets'), 'SKILL.md 文件索引应列出 assets/presets');
assert.ok(/明确要「中性」/.test(skill.content), 'SKILL.md 应写明显式触发：仅明确要「中性」时才用');
assert.ok(/生成器|generate-bootlogo/.test(skill.content.split('预置「中性」包')[1] ?? ''), 'SKILL.md 应把非中性需求指回生成器');

// logo.img = BMP + 458B 0 + 同一 BMP
const presetImg = fs.readFileSync(path.join(PRESET, 'logo.img'));
assert.equal(presetImg.subarray(0, 2).toString('latin1'), 'BM', 'logo.img 应以 BM 开头');
const imgW = presetImg.readInt32LE(18); const imgH = presetImg.readInt32LE(22); const imgBpp = presetImg.readInt16LE(28);
assert.deepEqual([imgW, imgH, imgBpp], [1024, 600, 24], 'logo.img 应为 1024x600x24bpp');
const bmpBytes = 54 + imgW * imgH * 3;
assert.equal(presetImg.length, bmpBytes * 2 + 458, 'logo.img 长度应 = (54+w*h*3)*2+458');
assert.ok(presetImg.subarray(0, bmpBytes).equals(presetImg.subarray(bmpBytes + 458)), 'logo.img 两半应逐字节相同');

// CpService.xml：动作逐条固定，且不带会「静默全跳」的 canuse_ver / runlimit
const presetXml = fs.readFileSync(path.join(PRESET, 'CpService.xml'), 'utf8');
const presetItems = [...presetXml.matchAll(/<item\s+action="([^"]+)"\s+params="([^"]*)"\s*\/>/g)].map((m) => [m[1], m[2]]);
assert.deepEqual(presetItems, [
  ['logo', 'logo.img'],
  ['bootanimation', 'bootanimation.zip'],
  ['cmd', 'sync'],
  ['cmd', 'sleep 5'],
  ['cmd', 'reboot'],
], '预置包动作顺序应为 logo → bootanimation → sync → sleep 5 → reboot');
assert.equal(presetItems.filter(([, p]) => p === 'reboot').length, 1, 'reboot 只能一条');
assert.equal(presetItems.at(-1)[1], 'reboot', 'reboot 必须在末位');
assert.ok(!/canuse_ver|runlimit/.test(presetXml), '预置包不应带 canuse_ver / runlimit（不匹配会静默跳过后续）');
assert.ok(!presetXml.includes('&'), 'xml 不应有裸 &（须转义）');
assert.ok(presetXml.trimStart().startsWith('<?xml') && presetXml.trimEnd().endsWith('</root>'), 'xml 头尾不完整');
for (const [, p] of presetItems) {
  if (/\.(img|zip|apk|bin|tar|gz)$/.test(p)) {
    assert.ok(fs.existsSync(path.join(PRESET, p)), `xml 引用的 ${p} 不在预置目录里`);
  }
}

// bootanimation.zip：Android 只认不压缩（stored）的条目
const presetZip = fs.readFileSync(path.join(PRESET, 'bootanimation.zip'));
assert.equal(presetZip.subarray(0, 4).toString('latin1'), 'PK\x03\x04', 'bootanimation.zip 魔数不对');
const eocd = presetZip.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
assert.ok(eocd > 0, 'bootanimation.zip 缺 EOCD');
const entryCount = presetZip.readUInt16LE(eocd + 10);
const cdOffset = presetZip.readUInt32LE(eocd + 16);
const zipEntries = [];
for (let i = 0, p = cdOffset; i < entryCount; i += 1) {
  assert.equal(presetZip.readUInt32LE(p), 0x02014b50, '中央目录签名不对');
  const nameLen = presetZip.readUInt16LE(p + 28);
  const extraLen = presetZip.readUInt16LE(p + 30);
  const commentLen = presetZip.readUInt16LE(p + 32);
  zipEntries.push({
    name: presetZip.subarray(p + 46, p + 46 + nameLen).toString('utf8'),
    method: presetZip.readUInt16LE(p + 10),
    size: presetZip.readUInt32LE(p + 20),
    localOff: presetZip.readUInt32LE(p + 42),
  });
  p += 46 + nameLen + extraLen + commentLen;
}
assert.deepEqual(zipEntries.map((e) => e.name).sort(), ['part0/', 'part0/0000.png', 'desc.txt'].sort(), '动画条目不符');
for (const e of zipEntries) assert.equal(e.method, 0, `${e.name} 必须 stored（不压缩）`);
const descEntry = zipEntries.find((e) => e.name === 'desc.txt');
const descStart = descEntry.localOff + 30 + presetZip.readUInt16LE(descEntry.localOff + 26) + presetZip.readUInt16LE(descEntry.localOff + 28);
assert.equal(presetZip.subarray(descStart, descStart + descEntry.size).toString('utf8'), '1024 600 10\np 0 0 part0\n',
  'desc.txt 应为 1024x600 10fps 单帧循环');

// 复用 §8.4 驱动自检（尺寸公式 + xml <root>/action + 清单引用媒体）
const presetCheck = spawnSync(DRIVER, ['--check', PRESET], { encoding: 'utf8' });
assert.equal(presetCheck.status, 0, `预置包 --check 应通过：${presetCheck.stderr}`);
console.log('  预置中性包: logo.img/bootanimation.zip/CpService.xml 结构与动作顺序 OK');

// 15b) 预置「中性」Linux logo（源图 + T3 Linux 直用媒体，方向已是 R180）
const LINUX_PRESET = path.join(SKILL_DIR, 'assets', 'presets', 'linux-neutral');
const LINUX_PRESET_REL = 'assets/presets/linux-neutral';
for (const f of ['logo.png', 'logo', 'bootlogo.bmp', 'README.md']) {
  assert.ok(fs.existsSync(path.join(LINUX_PRESET, f)), `缺少 ${LINUX_PRESET_REL}/${f}`);
}
{
  const png = fs.readFileSync(path.join(LINUX_PRESET, 'logo.png'));
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG', 'logo.png 不是 PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1024, 600], 'logo.png 应为 1024x600');
}
assert.equal(fs.statSync(path.join(LINUX_PRESET, 'logo')).size, 1024 * 600 * 4 * 2, '预置 logo 应为 2 帧 4,915,200 B');
assert.equal(fs.statSync(path.join(LINUX_PRESET, 'bootlogo.bmp')).size, 54 + 1024 * 600 * 3, '预置 bootlogo.bmp 尺寸不对');
const linuxPresetCheck = spawnSync(DRIVER, ['--check', LINUX_PRESET], { encoding: 'utf8' });
assert.equal(linuxPresetCheck.status, 0, `Linux 中性预置 --check 应通过：${linuxPresetCheck.stderr}`);
assert.ok(skill.content.includes(LINUX_PRESET_REL), 'SKILL.md 应列出 linux-neutral 预置');
assert.ok(/中性/.test(fs.readFileSync(path.join(LINUX_PRESET, 'README.md'), 'utf8')), '预置 README 应写清中性用途');
console.log('  预置 Linux 中性 logo: 源图 + 2 帧 logo + bootlogo.bmp OK');

// 10) 职责边界：整机线刷已拆到 skill `flash`（20261109），这里只留指针
assert.ok(skill.content.includes('`flash`'), 'SKILL.md 应指明整机线刷走 skill flash');
assert.ok(/不在这里/.test(skill.content), 'SKILL.md 应写明整机线刷不在本 skill');
for (const bad of ['flash.sh', 'rk_upgrade_tool', 'openixcli']) {
  assert.ok(!skill.content.includes(bad), `SKILL.md 不应再出现线刷资产 ${bad}（已迁到 src/flash）`);
}
for (const lang of ['zh', 'en']) {
  const meta = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'locale', 'cpservice', `${lang}.json`), 'utf8')).meta;
  assert.ok(!/线刷|flashing/i.test(`${meta.title}${meta.description}`),
    `locale/cpservice/${lang}.json 不应再宣称整机线刷（已剥离到 /flash）`);
}

console.log('smoke OK:', skill.name, '| description', skill.description.length, '字 | 正文', skill.content.length, '字');
console.log('  refs:', refs.join(', '), '| assets:', listed.size, '个');
