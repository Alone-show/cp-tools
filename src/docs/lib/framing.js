/**
 * 机型清单 / 候选列表的渲染（命中机型后的整包报文见 packet.js）。
 */

export function renderCandidates({ query, scored }) {
  const lines = [`机型「${query}」不唯一，请用更精确的写法重发 /cp-docs：`, ''];
  for (const [score, g] of scored.slice(0, 6)) {
    lines.push(`- ${g.id} ${g.model}${g.aliases?.length ? `（${g.aliases.slice(0, 2).join(' / ')}）` : ''}`);
  }
  lines.push('', '例：/cp-docs SPRING 10 PRO 二代 的屏幕尺寸');
  return lines.join('\n');
}

export function renderCatalog(models) {
  const families = new Map();
  for (const m of models) {
    const k = m.family || '其他';
    if (!families.has(k)) families.set(k, []);
    families.get(k).push(m);
  }
  const lines = [`共 ${models.length} 款机型：`];
  for (const [family, list] of families) {
    lines.push('', `【${family}】`);
    for (const m of list) lines.push(`- ${m.id} ${m.model}`);
  }
  return lines.join('\n');
}
