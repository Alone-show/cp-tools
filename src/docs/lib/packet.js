/**
 * 机型资料整包渲染。
 *
 * 唯一命中机型后，把该机型**全部**本地资料（参数 / 全部表格 / 编程节点 / 硬件工作点 /
 * 未转写图片 / 数据提示）渲染成一份给模型看的报文，不做意图判断、不做字段挑选——
 * 「问题该对应哪一条」交给模型。
 */

const RULE = [
  '以上为该机型全部资料。数值请原样引用，不要改写、不要补全；引用表格内容时请注明所属表名/章节；',
  '资料中确实没有的项，回答「资料中未收录」，不要推测。',
].join('');

function cell(v) {
  return String(v ?? '')
    .replace(/\r?\n/g, ' / ')
    .replace(/\|/g, '｜')
    .trim();
}

function mdTable(header, rows) {
  const out = [];
  const head = Array.isArray(header) && header.length ? header : null;
  if (head) {
    out.push(`| ${head.map(cell).join(' | ')} |`);
    out.push(`|${head.map(() => ' --- ').join('|')}|`);
  }
  for (const row of rows || []) {
    if (!Array.isArray(row)) continue;
    out.push(`| ${row.map(cell).join(' | ')} |`);
  }
  return out;
}

function specLine(spec) {
  const bits = [];
  if (spec?.size_mm) bits.push(`尺寸 ${spec.size_mm} mm`);
  if (spec?.weight_kg) bits.push(`重量 ${spec.weight_kg} kg`);
  return bits.length ? bits.join(' ｜ ') : '';
}

function renderParams(params, labels) {
  const lines = [];
  for (const [key, value] of Object.entries(params || {})) {
    const v = cell(value);
    if (!v) continue;
    const meta = labels[key] || {};
    const name = meta.label || key;
    const unit = meta.unit && !v.includes(meta.unit) ? ` ${meta.unit}` : '';
    lines.push(`- ${name}：${v}${unit}`);
  }
  return lines;
}

function renderTables(tables) {
  const lines = [];
  for (const t of tables || []) {
    const title = [t.caption, t.section ? `（${t.section}）` : ''].filter(Boolean).join('');
    lines.push(`### ${title || '未命名表格'}`);
    lines.push(...mdTable(t.header, t.rows));
    if (t.notes) lines.push(...String(t.notes).split('\n').map((l) => `> ${l}`));
    if (t.src) lines.push(`原图：${t.src}`);
    lines.push('');
  }
  return lines;
}

function renderProgramming(pages) {
  const lines = [];
  const total = pages.length;
  pages.forEach((page, i) => {
    const seq = total > 1 ? `（${i + 1}/${total}）` : '';
    lines.push(`### ${page.title || page.slug || '编程页'}${seq}`);
    if (page.url) lines.push(`文档页：${page.url}`);
    for (const t of page.tables || []) {
      if (t.heading) lines.push(`**${t.heading}**`);
      lines.push(...mdTable(t.header, t.rows));
    }
    lines.push('');
  });
  return lines;
}

function renderFigures(figures) {
  const lines = [];
  for (const f of figures || []) {
    const title = [f.caption, f.section ? `（${f.section}）` : ''].filter(Boolean).join('');
    lines.push(`### ${title || '图片'}`);
    if (f.title) lines.push(`图名：${f.title}`);
    for (const line of String(f.text || '').split('\n')) lines.push(line);
    if (f.confidence && f.confidence !== 'high') lines.push(`置信度：${f.confidence}`);
    if (f.src) lines.push(`原图：${f.src}`);
    lines.push('');
  }
  return lines;
}

function leanFigures(figures) {
  return (figures || []).map((f) => `- ${f.caption || f.section || '图片'}${f.src ? `：${f.src}` : ''}`);
}

function renderWorkpoints(workpoints) {
  const lines = [];
  for (const entry of workpoints.entries || []) {
    lines.push(`### ${entry.cpCode || '（未知机型编码）'}`);
    for (const [signal, value] of Object.entries(entry.values || {})) {
      const v = cell(value);
      if (!v || v === '-') continue;
      lines.push(`- ${signal} → ${v}`);
    }
    lines.push('');
  }
  return lines;
}

/** 超长时的降级版：编程节点 / 工作点只给清单，不展开行 */
function leanProgramming(pages) {
  return pages.map((page) => {
    const rows = (page.tables || []).reduce((n, t) => n + (t.rows || []).length, 0);
    return `- ${page.title || page.slug}（${rows} 行）${page.url || ''}`.trim();
  });
}

function leanWorkpoints(workpoints) {
  return (workpoints.entries || []).map((e) => {
    const n = Object.values(e.values || {}).filter((v) => v && v !== '-').length;
    return `- ${e.cpCode || '（未知）'}（${n} 项工作点）`;
  });
}

/**
 * @param {object}   p
 * @param {object}   p.entry        models.json 里的机型条目
 * @param {object}   p.spec         models/<id>/spec.json
 * @param {object?}  p.programming  models/<id>/programming.json
 * @param {object?}  p.workpoints   models/<id>/workpoints.json
 * @param {object}   [p.labels]     { params_flat key → 中文名 }
 * @param {number}   [p.maxChars]   软上限，超出后降级编程节点/工作点
 */
export function renderPacket({ entry, spec, programming, workpoints, labels = {}, maxChars = 40000 }) {
  const build = (lean) => {
    const L = [];
    const head = [`# ${entry.id} ${entry.model}`, entry.family ? `（系列 ${entry.family}）` : ''].join('');
    L.push(head);
    const aliases = [...new Set([...(entry.aliases || []), ...(entry.cp_codes || [])])].filter((a) => a && a !== entry.model);
    if (aliases.length) L.push(`同机型写法：${aliases.slice(0, 8).join(' / ')}`);
    if (entry.doc_url) L.push(`文档页：${entry.doc_url}`);
    if (spec?.intro) L.push(`简介：${cell(spec.intro)}`);
    const meta = specLine(spec);
    if (meta) L.push(`规格：${meta}`);
    L.push('');

    const params = renderParams(spec?.params_flat, labels);
    if (params.length) {
      L.push(`## 参数（${params.length} 项）`, ...params, '');
    }

    if (spec?.tables?.length) {
      L.push(`## 表格（${spec.tables.length} 张）`);
      L.push(...renderTables(spec.tables));
    }

    if (spec?.figures?.length) {
      L.push(`## 图内文字（${spec.figures.length} 张）`);
      L.push(...(lean ? leanFigures(spec.figures) : renderFigures(spec.figures)));
      L.push('');
    }

    if (programming?.pages?.length) {
      L.push('## 编程节点');
      L.push(...(lean ? leanProgramming(programming.pages) : renderProgramming(programming.pages)));
      L.push('');
    }

    if (workpoints?.entries?.length) {
      L.push('## 硬件工作点');
      L.push(...(lean ? leanWorkpoints(workpoints) : renderWorkpoints(workpoints)));
      L.push('');
    }

    if (spec?.skipped?.length) {
      L.push('## 未转写的图片（无图内文字，见原图）');
      for (const s of spec.skipped) L.push(`- ${s.src || ''}${s.reason ? `：${s.reason}` : ''}`);
      L.push('');
    }

    if (spec?.warnings?.length) {
      L.push('## 数据提示');
      for (const w of spec.warnings) L.push(`- ${w}`);
      L.push('');
    }
    return L.join('\n');
  };

  let out = build(false);
  if (out.length > maxChars) out = build(true);
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n…（报文超长，已截断）';
  return out;
}

/**
 * 渲染成一条 followup 用户消息。
 */
export function buildPacketMessage({ question, entry, packet, extraNotes = [] }) {
  const lines = [
    '【cp-docs 机型资料 · 请只依据以下资料回答】',
    `用户问题：${question || '（未提供）'}`,
    '',
    packet,
    RULE,
  ];
  if (extraNotes.length) lines.push('', '附注：', ...extraNotes.map((n) => `- ${n}`));
  return lines.join('\n');
}

export { RULE };
