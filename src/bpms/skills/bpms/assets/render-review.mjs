#!/usr/bin/env node
/**
 * render-review.mjs —— 把订单评审表数据渲染成 A4 PDF（并顺手出首页 PNG 供目视）。
 *
 * 为什么不用 soffice：实测 LibreOffice 转这份 HTML 会把表格边框/列表拆散（2026-11-16 现场），
 * 所以固定走 Chromium 系 headless（edge / chromium / chrome），soffice 只作最后兜底并打警告。
 *
 * 用法
 *   node render-review.mjs review.json            # 出 review.pdf + review_p1.png
 *   node render-review.mjs review.json out.pdf    # 指定输出
 *   node render-review.mjs --check                # 只检查环境（浏览器 / pdfinfo / pdftoppm）
 *
 * review.json 结构（除 title 外都可省）
 * {
 *   "title": "订单评审表",
 *   "subtitle": ["合同号 … ｜ 客户 …", "BPMS … ｜ 状态 0 暂存 ｜ 评审日期 …"],
 *   "sections": [
 *     { "name": "一、订单与商务信息",
 *       "rows": [ [ {"label":"销售订单号","value":"SZ…","tag":"待补录","changed":true},
 *                   {"label":"产品名称","value":"SPRING2 10PRO"} ] ]
 *     }
 *   ],
 *   "risk": { "conclusion": "可接单，需下列 N 项闭环", "items": ["…", "…"], "foot": "交付物：…" },
 *   "sign": [["销售","研发/软件"], ["硬件","生产/计划"], ["品质","批准"]],
 *   "footnote": "数据来源：…"
 * }
 *
 * 约定：每行 2 组 label/value（四列）；changed=true 走红色强调，tag 出红色小标签；
 *      风险块用 warnbox；sign 每行两组「角色 + 空签名格」。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE = path.join(HERE, 'order-review-template.html');
const BROWSERS = ['microsoft-edge', 'microsoft-edge-stable', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];

const esc = (value) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

function has(cmd) {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() !== '';
}

function findBrowser() {
  for (const name of BROWSERS) if (has(name)) return name;
  return '';
}

function cellHtml(spec) {
  if (!spec) return '<td class="lb"></td><td class="v"></td>';
  const value = spec.changed
    ? `<span class="chg">${esc(spec.value)}</span>`
    : esc(spec.value);
  const tag = spec.tag ? `<span class="tag">${esc(spec.tag)}</span>` : '';
  return `<td class="lb">${esc(spec.label)}</td><td class="v">${value}${tag}</td>`;
}

function sectionsHtml(data) {
  const parts = [];
  for (const section of data.sections ?? []) {
    parts.push(`<h2>${esc(section.name)}</h2>`);
    parts.push('<table>');
    for (const row of section.rows ?? []) {
      parts.push(`<tr>${cellHtml(row?.[0])}${cellHtml(row?.[1])}</tr>`);
    }
    parts.push('</table>');
  }
  if (data.risk) {
    const items = (data.risk.items ?? []).map((item) => `<li>${item}</li>`).join('');
    parts.push('<h2>评审结论与风险提示</h2>');
    parts.push(
      `<div class="warnbox"><b>结论：${esc(data.risk.conclusion ?? '')}</b>` +
        `${items ? `<ol>${items}</ol>` : ''}` +
        `${data.risk.foot ? `<div>${data.risk.foot}</div>` : ''}</div>`,
    );
  }
  if (Array.isArray(data.sign) && data.sign.length) {
    parts.push('<h2>签核</h2><table class="sign">');
    for (const pair of data.sign) {
      const [a, b] = pair ?? [];
      parts.push(
        `<tr><td class="lb">${esc(a ?? '')}</td><td class="v">&nbsp;</td>` +
          `<td class="lb">${esc(b ?? '')}</td><td class="v">&nbsp;</td></tr>`,
      );
    }
    parts.push('</table>');
  }
  return parts.join('\n');
}

function renderPdf(browser, htmlPath, pdfPath) {
  const tmpProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'review-pdf-'));
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${tmpProfile}`,
    '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`,
    `file://${htmlPath}`,
  ];
  const r = spawnSync(browser, args, { encoding: 'utf8', timeout: 120_000 });
  fs.rmSync(tmpProfile, { recursive: true, force: true });
  return { ok: r.status === 0 && fs.existsSync(pdfPath), stderr: (r.stderr ?? '').slice(-400) };
}

function renderPdfWithSoffice(htmlPath, pdfPath) {
  if (!has('soffice')) return { ok: false, stderr: 'soffice 不存在' };
  const outDir = path.dirname(pdfPath);
  const r = spawnSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', outDir, htmlPath], {
    encoding: 'utf8',
    timeout: 180_000,
  });
  return { ok: r.status === 0 && fs.existsSync(pdfPath), stderr: (r.stderr ?? '').slice(-400) };
}

function pageInfo(pdfPath) {
  const r = spawnSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
  if (r.status !== 0) return { pages: 0, size: '' };
  const pages = Number((r.stdout.match(/^Pages:\s+(\d+)/m) ?? [])[1] ?? 0);
  const size = (r.stdout.match(/^Page size:\s+(.+)$/m) ?? [])[1] ?? '';
  return { pages, size: size.trim() };
}

function firstPagePng(pdfPath) {
  if (!has('pdftoppm')) return '';
  const out = pdfPath.replace(/\.pdf$/i, '_p1');
  const r = spawnSync('pdftoppm', ['-r', '100', '-png', '-f', '1', '-l', '1', pdfPath, out], { encoding: 'utf8' });
  const file = `${out}-1.png`;
  return r.status === 0 && fs.existsSync(file) ? file : '';
}

function main(argv) {
  if (argv.includes('--check')) {
    const browser = findBrowser();
    console.log(`浏览器：${browser || '(未找到 Chromium 系，会退回 soffice，排版可能散)'}`);
    console.log(`pdfinfo：${has('pdfinfo') ? '有' : '无'}   pdftoppm：${has('pdftoppm') ? '有' : '无'}`);
    console.log(`模板：${TEMPLATE}${fs.existsSync(TEMPLATE) ? '' : '（缺失）'}`);
    return browser ? 0 : 1;
  }
  const input = argv.find((a) => !a.startsWith('-'));
  if (!input) {
    console.error('用法：node render-review.mjs <review.json> [out.pdf]');
    return 2;
  }
  const dataPath = path.resolve(input);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const pdfPath = path.resolve(argv[argv.indexOf(input) + 1]?.startsWith('-') ? '' : argv[argv.indexOf(input) + 1] || dataPath.replace(/\.json$/i, '.pdf'));

  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const html = template
    .replaceAll('{{title}}', esc(data.title ?? '订单评审表'))
    .replaceAll('{{subtitle}}', (data.subtitle ?? []).map((line) => esc(line)).join('<br>'))
    .replaceAll('{{footnote}}', esc(data.footnote ?? ''))
    .replace('<!--CONTENT-->', sectionsHtml(data));

  const htmlPath = path.join(path.dirname(pdfPath), `${path.basename(pdfPath, '.pdf')}.html`);
  fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
  fs.writeFileSync(htmlPath, html);

  let rendered = { ok: false, stderr: '' };
  const browser = findBrowser();
  if (browser) rendered = renderPdf(browser, htmlPath, pdfPath);
  if (!rendered.ok) {
    console.warn(`⚠ Chromium 系打印失败（${rendered.stderr || '未知原因'}），退回 soffice —— 表格可能散版，出图后务必目视`);
    rendered = renderPdfWithSoffice(htmlPath, pdfPath);
  }
  if (!rendered.ok) {
    console.error(`渲染失败：${rendered.stderr || '未知原因'}`);
    return 1;
  }

  const { pages, size } = pageInfo(pdfPath);
  if (!pages) {
    console.error('PDF 页数为 0，渲染可能失败');
    return 1;
  }
  const png = firstPagePng(pdfPath);
  console.log(`PDF：${pdfPath}`);
  console.log(`  ${pages} 页 / ${size}；首屏图：${png || '(pdftoppm 不可用，跳过目视)'}`);
  console.log('  目视检查：表格边框完整、签核栏未拆行、末页无孤立表头');
  return 0;
}

process.exit(main(process.argv.slice(2)));
