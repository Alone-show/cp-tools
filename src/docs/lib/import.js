/**
 * 一次性导入：把工作区里已整理好的资料（work/cpdoc/ai-readable）转成插件运行期数据 .cpdocs/。
 * 运行：node lib/import.js  （在 workspace 根目录执行，或传参数指定 src/out）
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonCore } from './models.js';
import { FIELDS } from './fields.js';

/** 业务侧写法的补充别名（文档规范名之外） */
const ALIASES = {
  'APOLLO 7 PRO': ['APOLLO7PRO', 'APOLLO PRO 7'],
  'APOLLO 8 PRO': ['APOLLO8PRO'],
  'APOLLO 10 PRO': ['APOLLO10PRO'],
  'APOLLO 10 PRO 电台': ['APOLLO10PRO电台', 'APOLLO 10 PRO RADIO'],
  'APOLLO X': ['APOLLOX', 'APOLLO-X'],
  'APOLLO 7 二代': ['APOLLO2 7', 'APOLLO2-7'],
  'APOLLO 7A 二代': ['APOLLO2 7A', 'APOLLO2-7A'],
  'APOLLO 10 二代': ['APOLLO2 10', 'APOLLO2-10'],
  'APOLLO 12 二代': ['APOLLO2 12', 'APOLLO2-12'],
  'APOLLO 12 二代 特别版': ['APOLLO2 12 特别版', 'APOLLO2-12 特别版'],
  'APOLLO 12A 二代': ['APOLLO2 12A', 'APOLLO2-12A'],
  'APOLLO 12A 二代 特别版': ['APOLLO2 12A 特别版'],
  'APOLLO 12 PRO': ['APOLLO2 12PRO', 'APOLLO2-12PRO', 'APOLLO 12PRO'],
  'APOLLO 12 PRO 特别版': ['APOLLO2 12PRO 特别版', 'APOLLO 12PRO 特别版'],
  'APOLLO 12 PLUS': ['APOLLO2 12PLUS', 'APOLLO2-12PLUS', 'APOLLO 12PLUS', 'APOLLO 12 PLUS LW'],
  'APOLLO 12 X': ['APOLLO2 12X', 'APOLLO2-12X', 'APOLLO 12X'],
  'SPRING 7': ['SPRING7'],
  'SPRING 8': ['SPRING8', 'SPRING-8'],
  'SPRING 10': ['SPRING10', 'SPRING-10'],
  'SPRING 10 电台': ['SPRING10 电台', 'SPRING-10 电台'],
  'SPRING 10 二代': ['SPRING2 10', 'SPRING2-10', 'T3 / SPRING2'],
  'SPRING 10 二代 特别版': ['SPRING2 10 特别版', 'SPRING2-10 特别版'],
  'SPRING 10 PRO 二代': ['SPRING2-10PRO', 'SP2-10PRO', 'SPRING2 10PRO', 'SPRING 10PRO 二代', 'SPRING 10 PRO 2代'],
  'SPRING 10 PRO 二代 特别版': ['SPRING2-10PRO 特别版', 'SP2-10PRO 特别版'],
  'SPRING 10 PLUS 二代': ['SPRING2-10PLUS', 'SP2-10PLUS', 'SPRING2 10PLUS'],
  'TANK 1': ['TANK1', 'SC60 / TANK'],
  'TANK 2': ['TANK2', 'TANK-2'],
  'MEGA1': ['MEGA 1', 'MEGA-1', 'MEGA'],
};

/** 工作点表 CP 编码 → 文档机型 */
const CP_CODES = {
  'CP020-TANK2': ['1.27'],
  'CP022-APOLLO2 7': ['1.6'],
  'CP022-2-APOLLO2 7A': ['1.7'],
  'CP022-2-APOLLO2 12A': ['1.11'],
  'CP022-APOLLO2 12': ['1.9'],
  'CP025-APOLLO2 12PRO': ['1.13'],
  'CP026-APOLLO2 12PLUS': ['1.15'],
  'CP026-APOLLO2 12PLUS LW': ['1.15'],
  'CP026-APOLLO 12X': ['1.16'],
  'CP023-SPRING2 10PRO': ['1.23'],
  'CP023-SPRING2 10PLUS': ['1.25'],
  'CP023-SPRING2 10PRO 雷沃': ['1.23'],
  'CP030-APOLLO2 10': ['1.8'],
  'CP029-SPRING 10  华测': ['1.19'],
};

/** 编程参考页 → 需要额外挂载的机型（页面上没有单列的特别版） */
const PROG_EXTRA = {
  '2.6.6-APOLLO-2nd-Gen-Series': ['1.10', '1.12'],
  '2.6.11-APOLLO-12-PRO-PLUS-X': ['1.14'],
  '2.6.18-SPRING-10-2nd-Gen': ['1.22'],
  '2.6.19-SPRING-10-PRO-PLUS-2nd-Gen': ['1.24'],
};

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function writeJson(p, v) { mkdir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(v, null, 1)); }

/** 解析 content.md：按 "## 标题" 切段，收集每个段落里的 markdown 表格 */
export function parseMarkdownTables(md) {
  const out = [];
  let heading = '';
  let table = null;
  const flush = () => { if (table && table.rows.length) out.push(table); table = null; };
  for (const raw of String(md).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('## ')) { flush(); heading = line.slice(3).trim(); continue; }
    if (line.startsWith('|')) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/<br\s*\/?>/gi, ' / '));
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue;
      if (!table) table = { heading, header: cells, rows: [] };
      else if (cells.join('') && !cells.every((c) => /^:?-{2,}:?$/.test(c))) table.rows.push(cells);
    } else if (line === '') {
      if (table && table.rows.length) flush();
    }
  }
  flush();
  return out;
}

export function importData({ src, out, log = () => {} } = {}) {
  const SRC = path.resolve(src || 'work/cpdoc/ai-readable');
  const OUT = path.resolve(out || '.cpdocs');
  if (!fs.existsSync(SRC)) throw new Error(`源资料目录不存在：${SRC}`);

  const products = readJson(path.join(path.dirname(SRC), 'products.json'));
  const docUrl = Object.fromEntries(products.map((p) => [p.no, p.href]));

  // 1) specs
  const specDir = path.join(SRC, 'specs');
  const specs = fs.readdirSync(specDir).filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, data: readJson(path.join(specDir, f)) }))
    .sort((a, b) => a.data.no.localeCompare(b.data.no, undefined, { numeric: true }));

  const models = [];
  const byId = new Map();
  for (const { file, data } of specs) {
    const id = data.no;
    const entry = {
      id, no: id,
      model: data.model, name: data.model,
      family: data.family || '',
      doc_url: docUrl[id] || '',
      aliases: [data.model, ...(ALIASES[data.model] || [])],
      cores: [],
      cp_codes: [],
      spec: `models/${id}/spec.json`,
      programming: null,
      workpoints: null,
    };
    models.push(entry);
    byId.set(id, entry);
    mkdir(path.join(OUT, 'models', id));
    writeJson(path.join(OUT, 'models', id, 'spec.json'), { ...data, doc_url: entry.doc_url });
  }

  // 2) 别名：CP 编码
  for (const [code, ids] of Object.entries(CP_CODES)) {
    for (const id of ids) {
      const m = byId.get(id);
      if (!m) continue;
      m.aliases.push(code);
      m.cp_codes.push(code);
    }
  }
  // 3) cores
  for (const m of models) {
    const set = new Set();
    for (const a of m.aliases) set.add(canonCore(a));
    for (const c of m.cores) set.add(c);
    set.delete('');
    m.cores = [...set];
  }

  // 4) 编程节点
  const progDir = path.join(SRC, 'offline', 'programming-table');
  const progPages = [];
  if (fs.existsSync(progDir)) {
    for (const slug of fs.readdirSync(progDir)) {
      const dir = path.join(progDir, slug);
      if (!fs.statSync(dir).isDirectory()) continue;
      const metaFile = path.join(dir, 'meta.json');
      const mdFile = path.join(dir, 'content.md');
      if (!fs.existsSync(metaFile) || !fs.existsSync(mdFile)) continue;
      const meta = readJson(metaFile);
      const tables = parseMarkdownTables(fs.readFileSync(mdFile, 'utf8'));
      const page = { slug, title: meta.title, url: meta.url, sections: meta.sections || [], tables };
      progPages.push(page);
      const ids = new Set();
      for (const name of meta.models || []) {
        const hit = models.find((m) => m.model === name || m.aliases.includes(name));
        if (hit) ids.add(hit.id);
      }
      for (const extra of PROG_EXTRA[slug] || []) ids.add(extra);
      for (const id of ids) {
        const m = byId.get(id);
        if (!m) continue;
        const p = path.join(OUT, 'models', id, 'programming.json');
        const prev = fs.existsSync(p) ? readJson(p) : { pages: [] };
        prev.pages.push({ slug, title: meta.title, url: meta.url, tables });
        writeJson(p, prev);
        m.programming = `models/${id}/programming.json`;
      }
      log(`编程页 ${slug} → ${[...ids].join(',')}`);
    }
  }

  // 5) 硬件工作点
  const wpFile = path.join(SRC, 'hardware', '工作点映射.json');
  if (fs.existsSync(wpFile)) {
    const wp = readJson(wpFile);
    for (const row of wp.rows || []) {
      const ids = CP_CODES[row.model];
      if (!ids) continue;
      for (const id of ids) {
        const m = byId.get(id);
        if (!m) continue;
        const p = path.join(OUT, 'models', id, 'workpoints.json');
        const prev = fs.existsSync(p) ? readJson(p) : { entries: [] };
        prev.columns = wp.columns;
        prev.entries.push({ cpCode: row.model, values: row.values });
        writeJson(p, prev);
        m.workpoints = `models/${id}/workpoints.json`;
      }
    }
  }

  // 6) 汇总
  const dataset = {
    builtAt: new Date().toISOString(),
    source: SRC,
    note: '由 lib/import.js 从 work/cpdoc/ai-readable 生成；run: node lib/import.js',
    models,
    programming_pages: progPages.map((p) => ({ slug: p.slug, title: p.title, url: p.url, sections: p.sections })),
    unmapped_cp: Object.keys(CP_CODES).filter((c) => false),
  };
  writeJson(path.join(OUT, 'models.json'), dataset);
  writeJson(path.join(OUT, 'fields.json'), { fields: FIELDS });
  writeJson(path.join(OUT, 'meta.json'), { builtAt: dataset.builtAt, models: models.length, programming_pages: progPages.length });
  log(`写入 ${OUT}：${models.length} 机型，${progPages.length} 个编程页`);
  return dataset;
}

const invoked = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (invoked) {
  const src = process.env.CPDOCS_SRC || path.resolve('work/cpdoc/ai-readable');
  const out = process.env.CPDOCS_DIR || path.resolve('.cpdocs');
  importData({ src, out, log: console.log });
}
