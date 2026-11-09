// 离线冒烟测试：整机线刷子插件（skill `flash` / 命令 `/flash`）。
//   node test/flash/smoke.mjs
//
// 守护四件事：
//   1) 插件与 skill 契约（cp-flash / flash，注册一个 skill）；
//   2) 资产：flash.sh 可执行 + help 参数齐全 + 随插件二进制版本正确；
//   3) 本次修复的回归：URL 直刷的 stdout 捕获 bug、--quiet/--dry-run、验收只比版本号；
//   4) 文档口径：SOP 明确「只比版本号、不截图」，不再要求 UI 抓屏。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { apply, inject, name, readBundledSkill, __internals } from '../../src/flash/index.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SKILL_DIR = path.join(PKG_ROOT, 'src', 'flash', 'skills', 'flash');
const FLASHER = path.join(SKILL_DIR, 'assets', 'flash.sh');
const read = (rel) => fs.readFileSync(path.join(SKILL_DIR, rel), 'utf8');

// 1) 插件契约
assert.equal(name, 'cp-flash', 'cordis 插件名');
assert.deepEqual(inject, ['skills'], 'inject 需要 skills 服务');

// 2) frontmatter 与注册
const skill = readBundledSkill();
assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'skill 名必须符合 dsh 的 SKILL_NAME 正则');
assert.equal(skill.name, 'flash', 'skill 名（调用命令 /flash）');
assert.equal(skill.resourceBase.path, SKILL_DIR, 'resourceBase 指向 skill/');
assert.equal(skill.invocation.modelInvocable, true);
assert.equal(skill.invocation.userInvocable, true);
assert.ok(skill.content.length > 1500, 'skill 正文非空');
assert.ok(!skill.content.startsWith('---'), '正文不含 frontmatter');
for (const kw of ['整机线刷', '线刷', 'loader', 'FEL', 'rk_upgrade_tool', 'openixcli', 'flash.sh', '版本一致']) {
  assert.ok(skill.description.includes(kw), `description 缺关键词 ${kw}`);
}

const registered = [];
apply({ skills: { register: (s) => { registered.push(s); return () => {}; } } });
assert.equal(registered.length, 1, '注册了一个 skill');
assert.equal(registered[0].name, 'flash');

// 3) 资产：脚本 + 工具
assert.ok(fs.existsSync(FLASHER), '缺少 assets/flash.sh');
assert.ok(fs.statSync(FLASHER).mode & 0o100, 'assets/flash.sh 需要可执行位');
assert.equal(execFileSyncText('bash', ['-n', FLASHER]), '', 'flash.sh 语法错误');

const help = execFileSyncText(FLASHER, ['help']);
for (const w of ['doctor', 'plan', 'flash', 'verify', 'rk_upgrade_tool', 'openixcli',
  'adb reboot loader', 'reboot efex', '0x01c20508', '--quiet', '--dry-run', '只比版本号']) {
  assert.ok(help.includes(w), `flash.sh help 缺 ${w}`);
}

const body = fs.readFileSync(FLASHER, 'utf8');
for (const w of ['Download Firmware Success', 'All partitions flashed successfully',
  '__PASS__', 'system_info.ini', '--force-platform-mismatch']) {
  assert.ok(body.includes(w), `flash.sh 缺 ${w}`);
}

// 默认产物口径（20261109）：镜像/日志直接落 ~/Downloads 顶层，不建 fw-cache 子目录；md 报告默认不生成
assert.ok(body.includes('CACHE_DIR="${FLASH_CACHE_DIR:-$DL_DIR}"'), '下载缓存应默认落 ~/Downloads 顶层');
assert.ok(!body.includes('fw-cache'), '不应再出现 fw-cache 子目录');
assert.ok(!/_flash_report_\$\(date/.test(body), '不应再自动生成报告路径（报告改为 --report 显式开启）');
assert.ok(body.includes('if [ -n "$REPORT" ]; then say'), '报告路径只在显式 --report 时打印');
assert.ok(/默认不生成/.test(body), 'help 应写明报告默认不生成');

const TOOLS = path.join(SKILL_DIR, 'assets', 'tools');
for (const [file, flag, want] of [['openixcli', '--version', '0.2.4'], ['rk_upgrade_tool', '-V', 'v2.22']]) {
  const p = path.join(TOOLS, file);
  assert.ok(fs.existsSync(p), `缺少 assets/tools/${file}`);
  assert.ok(fs.statSync(p).mode & 0o100, `assets/tools/${file} 需要可执行位`);
  const r = spawnSync(p, [flag], { encoding: 'utf8', timeout: 30000 });
  assert.ok((r.stdout + r.stderr).includes(want), `${file} 版本不含 ${want}：${r.stdout}${r.stderr}`);
}
assert.ok(fs.existsSync(path.join(TOOLS, 'VERSIONS.md')), '缺少 assets/tools/VERSIONS.md（来源/版本/sha256）');

// 4) 回归：URL 捕获 bug（20261109）
const dlBody = body.slice(body.indexOf('download_firmware() {'), body.indexOf('resolve_firmware() {'));
assert.ok(dlBody.length > 200, '定位 download_firmware 失败');
assert.ok(!/^\s*say "/m.test(dlBody), 'download_firmware 里不能有裸 say（stdout 会被 $(...) 捕获）');
assert.ok(dlBody.includes('say_err'), 'download_firmware 的过程消息应走 say_err');
assert.ok(dlBody.includes('curl -sS'), '下载应静默（-sS），只留错误');
assert.ok(body.includes('[ -f "$FW" ] || die 3'), 'resolve_firmware 缺少「解析结果必须是文件」的防御');

// 5) 回归：--dry-run 必须在进下载模式之前返回
const iDry = body.indexOf('if [ "$DRY_RUN" = 1 ]; then dry_run_report');
const iEnter = body.indexOf('enter_download_mode "$pl"');
assert.ok(iDry > 0 && iEnter > iDry, '--dry-run 的返回必须在 enter_download_mode 之前');

// 6) 验收口径：只比版本号
assert.ok(/record "真重启（boot_id，旁证）" INFO/.test(body), 'boot_id 应记为旁证 INFO，不阻塞');
assert.ok(body.includes('只比版本号'), '报告/帮助里应写明验收口径');
assert.ok(!body.includes('桌面/UI 实际显示'), '报告不应再要求 UI 目视验证');

// 7) 文档口径
assert.ok(skill.content.includes('版本号一致'), 'SOP 应写明「版本号一致 = 通过」');
assert.ok(skill.content.includes('不截图'), 'SOP 应明确「不截图」');
// 20261109：刷机前不等确认；默认只刷量产（DEV 需点名）
assert.ok(/不等待确认/.test(skill.content), 'SOP 应写明刷机前不等待确认');
assert.ok(!/用户确认/.test(skill.content), 'SOP 不应再保留「用户确认」这一步');
assert.ok(/只取量产版|默认只刷\*\*量产版/.test(skill.content), 'SOP 应写明默认只取量产版');
assert.ok(skill.content.includes('DEV'), 'SOP 应提到 DEV 构建需点名');
assert.ok(/默认只刷\*\*量产版|量产版（不带 `DEV-`/.test(read('references/flash.md')), 'references/flash.md 纪律应写默认量产');
assert.ok(!/x11grab|screenshot/i.test(skill.content), 'SOP 不应再要求抓屏');
assert.ok(!/x11grab|screenshot/i.test(body), 'flash.sh 不应再要求抓屏');
assert.ok(skill.content.includes('references/flash.md'), 'SKILL.md 应指向 references/flash.md');
assert.ok(fs.existsSync(path.join(SKILL_DIR, 'references', 'flash.md')), '缺少 references/flash.md');
for (const m of skill.content.matchAll(/assets\/([A-Za-z0-9._-]+)/g)) {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'assets', m[1])), `SKILL.md 引用了不存在的 assets/${m[1]}`);
}
for (const m of read('references/flash.md').matchAll(/assets\/([A-Za-z0-9._-]+)/g)) {
  assert.ok(fs.existsSync(path.join(SKILL_DIR, 'assets', m[1])), `references/flash.md 引用了不存在的 assets/${m[1]}`);
}
const LINES = skill.content.split('\n').length;
assert.ok(LINES <= 200, `SKILL.md 现有 ${LINES} 行，超出预算 200`);

// 8) OTG：回线超时才提示切 DEVICE
assert.ok(!body.includes('提示：安卓刷完默认 OTG Host'), 'flash.sh 不应在刷完立刻提示');
assert.ok(/若设备停在 OTG Host[^\n]*切到 DEVICE/.test(body), '等 adb 的提示应说明 OTG Host');
assert.ok(/没等到 adb 设备[^\n]*切到 DEVICE[^\n]*§7\.3/.test(body), '回线超时信息应指向 §7.3');
assert.ok(skill.content.includes('超时'), 'SOP 应写明超时才提示');

// 9) 端到端：URL 直刷的解析路径（离线，不需要设备）
//    用 --dry-run + ADB=/bin/false，覆盖「下载 → 解析 → 判平台失败退出」，
//    断言不再出现 sha256sum 报错，且 stdout 只输出里程碑（≤15 行）。
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-flash-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: tmp, stdio: 'ignore',
});
const runDial = (args) => spawnSync(FLASHER, args, {
  encoding: 'utf8',
  timeout: 120000,
  env: { ...process.env, ADB: '/bin/false', DL_DIR: path.join(tmp, 'dl') },
});
try {
  // 4 KB 假镜像（RK 头，便于镜像头判定）
  const fake = Buffer.concat([Buffer.from('RKFW'), Buffer.alloc(4092, 0)]);
  fs.writeFileSync(path.join(tmp, 'x.img'), fake);
  const url = `http://127.0.0.1:${port}/x.img`;
  const waitServer = () => spawnSync('bash', ['-c', `for i in $(seq 40); do curl -s -o /dev/null "http://127.0.0.1:${port}/x.img" && exit 0; sleep 0.1; done; exit 1`]);
  assert.equal(waitServer().status, 0, '本地 http server 没起来');

  const first = runDial(['flash', url, '--dry-run', '--log', path.join(tmp, 'dl', 'f.log')]);
  const out1 = `${first.stdout}${first.stderr}`;
  assert.ok(!/sha256sum:/.test(out1), `URL 直刷又出现 sha256sum 报错：\n${out1}`);
  assert.ok(first.stdout.includes('固件：'), `应打印解析后的固件路径：\n${out1}`);
  assert.match(first.stdout, /sha256=[0-9a-f]{64}/, `sha256 应为完整 64 位：\n${out1}`);
  assert.ok(first.stdout.trim().split('\n').length <= 15, `--quiet 风格输出应 ≤15 行，实际：\n${first.stdout}`);
  assert.equal(first.status, 3, '无 adb 设备时应以 3 退出（前置不满足）');

  const second = runDial(['flash', url, '--dry-run', '--log', path.join(tmp, 'dl', 'f.log')]);
  assert.ok(/复用(本地镜像|已下载镜像)/.test(`${second.stdout}${second.stderr}`), '第二次应复用缓存镜像');
  assert.ok(!/sha256sum:/.test(`${second.stdout}${second.stderr}`), '复用分支同样不能出现 sha256sum 报错');
} finally {
  server.kill('SIGTERM');
  fs.rmSync(tmp, { recursive: true, force: true });
}

function execFileSyncText(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 0, `${cmd} ${args.join(' ')} 退出 ${r.status}：${r.stderr}`);
  return (r.stdout ?? '').trim();
}

// 8) 职责边界（20261109 拆分）：locale 不得再写「确认/confirm」，且必须描述整机线刷
for (const lang of ['zh', 'en']) {
  const meta = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'locale', 'flash', `${lang}.json`), 'utf8')).meta;
  const text = `${meta.title}${meta.description}`;
  assert.ok(!/确认|confirm/i.test(text), `locale/flash/${lang}.json 不应再写「确认/confirm」（刷机前不等确认）`);
  assert.ok(/线刷|flashing/i.test(text), `locale/flash/${lang}.json 应描述整机线刷`);
}

console.log(`smoke OK: flash | SKILL ${LINES} 行 | assets：${fs.readdirSync(path.join(SKILL_DIR, 'assets')).length} 个`);
