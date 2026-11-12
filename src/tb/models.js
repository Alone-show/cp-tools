/**
 * TB 看板上的机型归一族：规范名、别名、变体，以及从归档链接目录名反推的机型。
 *
 * firmware（找固件）和 tickets（按机型过滤工单）共用同一套归一逻辑，避免两边
 * 对 APOLLO2-MIX、SP2-10PRO 这类写法的判定不一致。
 */
import { nz, vendorKey, canonModel, equivCore, queryCores, scoreCore } from '../shared/model-core.js';
import { LINK_FIELDS, asList } from './constants.js';

export function modelGroups(board) {
  const counts = new Map();
  for (const t of board.items) {
    const v = t.fields?.['机型'];
    for (const x of Array.isArray(v) ? v : [v]) {
      if (x) counts.set(String(x), (counts.get(String(x)) ?? 0) + 1);
    }
  }
  const groups = new Map();
  for (const [name, cnt] of counts) {
    const { vendor, core } = canonModel(name);
    const key = `${vendor}\u0000${core}`;
    const g = groups.get(key) ?? { vendor, core, names: [], count: 0 };
    g.names.push([cnt, name]);
    g.count += cnt;
    groups.set(key, g);
  }
  const out = [];
  for (const g of groups.values()) {
    g.names.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
    g.name = g.names[0][1];
    g.aliases = g.names.slice(1).map((n) => n[1]);
    g.variants = new Map();
    out.push(g);
  }
  foldModelDirs(board, out);
  return out;
}

/**
 * 把归档链接里的机型目录名并入已有族：
 * - 与族同名（含 sp2↔spring2 / apollo2↔apollo 展开、以及省略尺寸数字）-> 并入 aliases；
 * - 只是更长、能挂到某个父族 -> 记入 variants（如 APOLLO2-MIX -> APOLLO2）；
 * - 其它丢弃（如 PRO），不新增独立族，否则同一机型会被拆成两个族。
 */
export function foldModelDirs(board, groups) {
  const dirs = new Map();
  for (const t of board.items) {
    const hit = taskModelDir(t);
    if (!hit) continue;
    const core = nz(hit.model);
    if (!core) continue;
    const entry = dirs.get(core) ?? { label: hit.model, count: 0, chip: hit.chip };
    entry.count += 1;
    dirs.set(core, entry);
  }
  const extraAliases = new Map();
  for (const [core, info] of dirs) {
    const cores = queryCores(core);
    let best = null;
    for (const g of groups) {
      let score = Math.max(...cores.map((c) => scoreCore(c, g)));
      // 同分时优先 <chip> 与族 vendor 一致的：路径里的芯片段比分数更可信
      if (score > 0 && g.vendor && chipVendor(info.chip) === g.vendor) score += 5;
      if (!best || score > best.score) best = { score, group: g };
    }
    if (!best) continue;
    if (best.score >= 85) {
      const list = extraAliases.get(best.group) ?? [];
      list.push([info.count, info.label]);
      extraAliases.set(best.group, list);
      continue;
    }
    if (best.score < 40) continue;
    // 40~70：只有「族名是变体名的前缀」才当变体，避免把 PRO 这类噪声挂上去
    let parent = null;
    for (const g of groups) {
      if (!cores.some((c) => c.startsWith(g.core) && c.length > g.core.length)) continue;
      if (!parent || g.core.length > parent.core.length) parent = g;
    }
    if (parent && !parent.variants.has(core)) {
      parent.variants.set(core, { core, label: info.label, count: info.count });
    }
  }
  for (const [g, list] of extraAliases) {
    const seen = new Set([g.name, ...g.aliases].map((n) => n.toLowerCase()));
    for (const [, name] of list.sort((a, b) => b[0] - a[0])) {
      const low = name.toLowerCase();
      if (seen.has(low)) continue;
      seen.add(low);
      g.aliases.push(name);
    }
  }
}

/** 族的变体列表（按出现次数降序，供确认候选/机型列表展示） */
export function variantList(g, limit = 5) {
  return [...(g?.variants?.values() ?? [])]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, limit)
    .map((v) => ({ label: v.label, tasks: v.count }));
}

export function resolveModel(query, groups) {
  const { vendor: qv, core: qc } = canonModel(query);
  if (!qc) return { hit: null, scored: [] };
  const cores = queryCores(qc);
  const equivs = new Set(cores.map(equivCore));
  // 1) 族名精确命中优先（等价 core 也算精确：APOLLO2-7 ≡ APOLLO2-7A、12 ≡ 12A）：
  //    否则 /firmware APOLLO2 会被「APOLLO2」这个目录别名/变体收窄
  const exacts = groups.filter((g) => equivs.has(equivCore(g.core)));
  if (exacts.length) {
    const pick = (qv && exacts.find((g) => g.vendor === qv)) || exacts[0];
    return { hit: pick, hits: exacts, scored: exacts.map((g) => [100, g]) };
  }
  // 2) 归档链接里的机型目录名（变体）精确命中
  for (const g of groups) {
    for (const c of cores) {
      let variant = g.variants?.get(c);
      if (!variant) {
        for (const [key, value] of g.variants ?? []) {
          if (equivCore(key) === equivCore(c)) {
            variant = value;
            break;
          }
        }
      }
      if (!variant) continue;
      if (qv && g.vendor && g.vendor !== qv) continue;
      return { hit: g, hits: [g], variant, scored: [[100, g]] };
    }
  }
  // 3) 近似打分（阈值不变），比较时同样走等价 core
  const scored = [];
  for (const g of groups) {
    const gEquiv = { core: equivCore(g.core) };
    let score = 0;
    for (const c of cores) {
      const cEquiv = equivCore(c);
      score = Math.max(score, scoreCore(c, g), scoreCore(cEquiv, gEquiv));
    }
    if (qv && g.vendor === qv) score += 10;
    else if (qv && g.vendor && g.vendor !== qv) score -= 10;
    if (score >= 40) scored.push([score, g]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  const top = scored[0];
  if (top) {
    // 同为 85 分但任务量差 3 倍以上时取量大的那个：`spring2pro` 会同时命中
    // 「RK / SPRING2-10PRO」(111) 和少量重复建单的「瑞芯微 / SPRING 10 PRO 二代」(5)。
    const strong = scored.filter(([sc]) => sc >= 85);
    if (strong.length > 1) {
      const byCount = [...strong].sort((a, b) => b[1].count - a[1].count || a[1].name.localeCompare(b[1].name));
      if (byCount[0][1].count >= 3 * Math.max(1, byCount[1][1].count)) {
        return { hit: byCount[0][1], hits: [byCount[0][1]], scored };
      }
    }
    // 只有同样强的竞争者（另一个精确/省略尺寸命中）才阻断；纯前缀不算
    const rivals = scored.slice(1).filter(([sc]) => sc >= 85);
    if (rivals.length === 0 && top[0] >= 95 && (!qv || top[1].vendor === qv)) {
      return { hit: top[1], hits: [top[1]], scored };
    }
    if (rivals.length === 0 && top[0] >= 85) return { hit: top[1], hits: [top[1]], scored };
  }
  return { hit: null, scored };
}

/** 路径里的缩写（SP2 / APOLLO）要能命中字段里的全称（SPRING2 / APOLLO2） */
export function modelVariants(model) {
  const base = nz(model);
  const v = new Set([base]);
  if (base.includes('apollo2')) v.add(base.replaceAll('apollo2', 'apollo'));
  else if (base.includes('apollo')) v.add(base.replaceAll('apollo', 'apollo2'));
  if (base.includes('spring2')) v.add(base.replaceAll('spring2', 'sp2'));
  if (base.includes('sp2')) v.add(base.replaceAll('sp2', 'spring2'));
  // 7 / 7A、12 / 12A、二代 / gen2 的等价写法也要能命中（只加 needle，不改展示）
  for (const item of [...v]) {
    const equiv = equivCore(item);
    if (equiv) v.add(equiv);
  }
  return [...v].filter(Boolean);
}



const OS_SEGMENTS = new Set(['android', 'debian', 'linux', 'buildroot']);

/** 路径里的 <chip> 段 -> 与族一致的 vendor 键 */
export function chipVendor(chip) {
  const known = vendorKey(chip);
  if (known) return known;
  const low = String(chip ?? '').toLowerCase();
  if (low === 'allwinner' || low === 'aw') return 'allwinner';
  if (low === 'qualcomm' || low === 'qcom' || low === 'qc') return 'qualcomm';
  return '';
}

/**
 * 只从正式归档路径取机型：/PROD/<chip>/<OS>/<机型>/...
 *
 * 不看 TEST/PRE/DEV（实测只多出 "62" 这类垃圾目录名），也不解析 mdmobs / 华为 OBS
 * 的 /11/... 旧形状（只是拼写变体，不增加信息）。
 */
export function linkModelDir(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return null;
  }
  const segs = url.pathname.split('/').filter(Boolean);
  if (segs.length < 4) return null;
  if (segs[0].toLowerCase() !== 'prod') return null;
  if (!OS_SEGMENTS.has(segs[2].toLowerCase())) return null;
  const model = segs[3].trim();
  return model ? { chip: segs[1], model } : null;
}

/** 任务里第一个能解析的归档链接目录名 */
export function taskModelDir(task) {
  for (const key of LINK_FIELDS) {
    for (const value of asList(task.fields?.[key])) {
      const hit = linkModelDir(value);
      if (hit) return hit;
    }
  }
  return null;
}


export function hitModel(task, variants) {
  const f = task.fields ?? {};
  const hay = nz(
    [
      task.title ?? '',
      asList(f['机型']).join(' '),
      f['固件版本'] ?? '',
      f['固件下载地址'] ?? '',
      f['OSS 线刷地址'] ?? '',
    ].join(' '),
  );
  return variants.some((v) => hay.includes(v));
}

/** 看板里的操作系统只有 Android / Debian / BuildRoot；Linux 指代后两者 */
export const SYSTEM_ALIASES = {
  linux: ['debian', 'buildroot'],
  'linux 系统': ['debian', 'buildroot'],
  gnulinux: ['debian', 'buildroot'],
  android: ['android'],
  安卓: ['android'],
  debian: ['debian'],
  buildroot: ['buildroot'],
};

export function hitSystem(task, system, mainline) {
  const f = task.fields ?? {};
  const osList = asList(f['操作系统']).map(String);
  const q = String(system ?? '').trim().toLowerCase();
  const accepted = SYSTEM_ALIASES[q] ?? [q];
  let ok = !system || osList.some((x) => accepted.some((a) => x.toLowerCase().includes(a)));
  if (ok && mainline) {
    const ml = `${f['关联代码主线'] ?? ''} ${f['固件版本'] ?? ''}`.toLowerCase();
    ok = ml.includes(String(mainline).toLowerCase());
  }
  return ok;
}

/** 版本父任务：有固件版本字段、标题带【版本迭代】，或带归档链接字段 */
export function isVersionTask(task) {
  const f = task?.fields ?? {};
  if (asList(f['固件版本']).length) return true;
  if (String(task?.title ?? '').includes('【版本迭代】')) return true;
  return LINK_FIELDS.some((key) => asList(f[key]).length);
}
