import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAlist, parseVersionDir, osNameByLetter } from './alist.js';
import { nz, canonModel, equivCore, queryCores, scoreCore } from '../shared/model-core.js';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';
import { candidateDirs, tokenDir, readCookie } from '../tb/auth.js';
import { readBoardFromDirs } from '../tb/board.js';
import { createTbClient, normalizeTask } from '../tb/live.js';
import {
  SYSTEM_ALIASES,
  modelGroups,
  foldModelDirs,
  variantList,
  resolveModel,
  modelVariants,
  chipVendor,
  linkModelDir,
  taskModelDir,
  hitModel,
  hitSystem,
  isVersionTask,
} from '../tb/models.js';
import { PROJECT_ID, UA, LINK_FIELDS, asList } from '../tb/constants.js';

/** 可替换的 alist 客户端工厂（离线测试用；运行时就是 createAlist）。 */
let alistFactory = createAlist;
/** 可替换的 TB 实时探测（离线测试用；运行时就是 defaultVersionProbe）。 */
let versionProbe = null;
/** 可替换的 fetch（离线测试用；运行时就是全局 fetch）。 */
let fetchImpl = (...args) => globalThis.fetch(...args);

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.join(PLUGIN_DIR, 'skills', 'firmware', 'SKILL.md');

function ageHoursOf(iso) {
  const ts = Date.parse(iso ?? '');
  return Number.isFinite(ts) ? (Date.now() - ts) / 3_600_000 : null;
}

/** 读共享看板快照（由 tickets 子插件负责同步；这里只读） */
async function readBoard(ctx, exec) {
  const dirs = await candidateDirs(ctx, exec);
  const board = await readBoardFromDirs(dirs);
  if (!board) {
    throw new Error(
      `找不到看板索引 board-${PROJECT_ID}.json。已查找: ${dirs.join(' | ')}。` +
        ' 先运行 /tickets sync，或用环境变量 DSH_TBFW_DIR 指定 .tbfw 所在目录。',
    );
  }
  return board;
}

/* ------------------------------------------------------------------ *
 * 归档链接里的机型目录名（只认 PROD）
 * ------------------------------------------------------------------ */

function linksOf(task) {
  const out = {};
  for (const k of LINK_FIELDS) {
    const v = asList(task.fields?.[k])[0];
    if (v) out[k] = String(v);
  }
  return out;
}

/** 构建日期：字段缺版本号时，从标题或下载地址里捞（在制版本常常只有链接） */
function versionDate(task) {
  const f = task.fields ?? {};
  const sources = [
    String(f['固件版本'] || ''),
    String(task.title || ''),
    String(f['固件下载地址'] || ''),
    String(f['OSS 线刷地址'] || ''),
  ];
  for (const src of sources) {
    const m = src.match(/_(20\d{6})(?:_|\.|\/|$)/);
    if (m) return m[1];
  }
  return '';
}

/** 阶段优先级：只有「生产库归档」才算正式归档；「自归档」「归档-下架」不算 */
function stageRank(stage) {
  const st = String(stage ?? '');
  if (st.includes('下架')) return 4;
  if (st.startsWith('生产库归档')) return 0;
  if (st.includes('发布')) return 1;
  return 2;
}

function rankKey(task) {
  const st = String(task.stage ?? '');
  const prio = stageRank(st);
  // 构建日期优先于 updated：补建的旧版本任务更新更晚，但固件更老
  const build = Number(versionDate(task) || 0);
  const ts = Date.parse(task.updated ?? '') || 0;
  return [prio, -build, -ts];
}

/* ------------------------------------------------------------------ *
 * 检索
 * ------------------------------------------------------------------ */

async function probe(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return { code: r.status, size: Number(r.headers.get('content-length') ?? 0) };
  } catch {
    return { code: 0, size: 0 };
  }
}

/* ------------------------------------------------------------------ *
 * alist 兜底（只在 Teambition 取不到结果时启用）
 * ------------------------------------------------------------------ */

/** alist 客户目录名 -> 看板客户 ID（未知目录原样返回，不静默丢） */
const CUSTOMER_ALIAS = {
  CP: 'CP',
  YMZH: 'YM',
  SMARTAG: 'SmartAG',
  SAMRTAG: 'SmartAG',
  LPX: 'LPX',
  LACOS: 'LACOS',
};

function mapCustomerDir(name) {
  const raw = String(name ?? '').trim();
  return CUSTOMER_ALIAS[raw.toUpperCase()] ?? raw;
}

/** 看板系统写法 -> alist 的 OS 目录段（linux 指 Debian + BuildRoot） */
function wantedOsSegments(system) {
  const q = String(system ?? '').trim().toLowerCase();
  if (!q) return null;
  const accepted = SYSTEM_ALIASES[q] ?? [q];
  return accepted.map((x) => String(x).toUpperCase());
}

/** 查询族 core 里的尺寸（APOLLO2-7A -> LCD7、APOLLO2-12PRO -> LCD12） */
function lcdFromCores(cores) {
  for (const core of cores) {
    const value = equivCore(core);
    const match = String(value ?? '').match(/(\d{1,2})$/);
    if (!match) continue;
    const size = Number(match[1]);
    if (size >= 7 && size <= 15) return `LCD${size}`;
  }
  return '';
}

/** alist 机型目录名 vs 查询族 core 的匹配分（>=70 采用） */
function matchModelDir(name, cores) {
  const dirCore = canonModel(name).core;
  if (!dirCore) return 0;
  const dirEquiv = equivCore(dirCore);
  let best = 0;
  for (const core of cores) {
    // 查询侧 core 必须先展开缩写（SP2 <-> SPRING2、APOLLO <-> APOLLO2）：
    // 看板族名是 SPRING2-10PRO，而 alist 机型目录是 SP2-10PRO，
    // 不展开就只会拿到 30 分（<70 阈值），整条 Debian/Linux 线会被静默跳过，
    // 结果看起来就像「alist 没有这个版本」——实际是目录没被匹配上。
    for (const qc of queryCores(core)) {
      const qEquiv = equivCore(qc);
      if (!qEquiv) continue;
      let score;
      if (dirEquiv === qEquiv) score = 100;
      else if (dirEquiv.startsWith(qEquiv) || qEquiv.startsWith(dirEquiv)) score = 70;
      else score = scoreCore(qEquiv, { core: dirEquiv });
      best = Math.max(best, score);
    }
  }
  return best;
}

function customerMatches(rowCustomer, effective) {
  if (!effective || /^(all|\*|不限)$/i.test(effective)) return true;
  const want = String(effective).toUpperCase();
  const got = String(rowCustomer ?? '').toUpperCase();
  if (!got) return false;
  return got === want || got.includes(want) || want.includes(got);
}

/** 取版本目录里的整机 img / OTA img 元数据（含 signed raw_url） */
async function alistArtifacts(alist, dirPath, dirName, verify) {
  let img = await alist.entry(`${dirPath}/${dirName}.img`);
  let ota = await alist.entry(`${dirPath}/${dirName}_OTA.img`);
  if (!img || !ota) {
    const files = await alist.list(dirPath);
    if (files) {
      const names = files.filter((f) => !f.isDir).map((f) => f.name);
      if (!img) {
        const name = names.find((n) => /\.img$/i.test(n) && !/_OTA\.img$/i.test(n));
        if (name) img = (await alist.entry(`${dirPath}/${name}`)) ?? { name, size: 0, rawUrl: '' };
      }
      if (!ota) {
        const name = names.find((n) => /_OTA\.img$/i.test(n));
        if (name) ota = (await alist.entry(`${dirPath}/${name}`)) ?? { name, size: 0, rawUrl: '' };
      }
    }
  }
  let sha256 = '';
  if (verify) {
    const sums = await alist.text(`${dirPath}/sha256sum.txt`);
    if (sums) {
      const target = new RegExp(`${dirName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.img$`);
      for (const line of sums.split(/\r?\n/)) {
        const match = line.match(/^([a-f0-9]{64})\s+\*?\.?\/?(.+)$/i);
        if (match && target.test(match[2].trim())) {
          sha256 = match[1].toLowerCase();
          break;
        }
      }
    }
  }
  return { img, ota, sha256 };
}

/**
 * 在 alist 上找与查询匹配的产物。
 *
 * 只读、只扫描 query 相关的 机型/客户/尺寸 目录；所有失败都降级为 ok:false，
 * 绝不影响 Teambition 主路径。
 */
async function collectAlistRows(alist, options) {
  const { cores, vendor, system, customer, version, limit = 5, verify = false } = options;
  const wantedOs = wantedOsSegments(system);
  const lcd = lcdFromCores(cores);
  const others = new Map();
  const candidates = [];

  const chips = await alist.list('/PROD');
  if (!chips) return { ok: false, rows: [], otherCustomers: [] };

  for (const chipDir of chips.filter((e) => e.isDir)) {
    if (vendor && chipVendor(chipDir.name) !== vendor) continue;
    const chipPath = `/PROD/${chipDir.name}`;
    const osDirs = await alist.list(chipPath);
    if (!osDirs) continue;
    for (const osDir of osDirs.filter((e) => e.isDir)) {
      const osUpper = osDir.name.toUpperCase();
      if (wantedOs && !wantedOs.some((x) => osUpper.includes(x))) continue;
      const modelPath = `${chipPath}/${osDir.name}`;
      const modelDirs = await alist.list(modelPath);
      if (!modelDirs) continue;
      for (const modelDir of modelDirs.filter((e) => e.isDir)) {
        if (matchModelDir(modelDir.name, cores) < 70) continue;
        const productPath = `${modelPath}/${modelDir.name}`;
        const customerDirs = await alist.list(productPath);
        if (!customerDirs) continue;
        for (const customerDir of customerDirs.filter((e) => e.isDir)) {
          const mapped = mapCustomerDir(customerDir.name);
          if (!customerMatches(mapped, customer)) {
            others.set(mapped, (others.get(mapped) ?? 0) + 1);
            continue;
          }
          const customerPath = `${productPath}/${customerDir.name}`;
          const lcdDirs = await alist.list(customerPath);
          if (!lcdDirs) continue;
          for (const lcdDir of lcdDirs.filter((e) => e.isDir)) {
            if (lcd && lcdDir.name.toUpperCase() !== lcd) continue;
            const lcdPath = `${customerPath}/${lcdDir.name}`;
            const versionDirs = await alist.list(lcdPath);
            if (!versionDirs) continue;
            for (const versionDir of versionDirs.filter((e) => e.isDir)) {
              const parsed = parseVersionDir(versionDir.name);
              if (!parsed) continue;
              if (version && !parsed.version.toUpperCase().includes(String(version).toUpperCase())) continue;
              candidates.push({
                dirPath: `${lcdPath}/${versionDir.name}`,
                dirName: versionDir.name,
                parsed,
                modified: String(versionDir.modified ?? ''),
                osSegment: osDir.name,
                productDir: modelDir.name,
                customerDir: customerDir.name,
                customer: mapped,
                lcdDir: lcdDir.name,
              });
            }
          }
        }
      }
    }
  }

  candidates.sort((a, b) => String(b.parsed.date).localeCompare(String(a.parsed.date)));
  const unique = [];
  const seen = new Set();
  for (const cand of candidates) {
    const key = `${cand.customer}|${nz(cand.dirName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(cand);
  }
  const picked = unique.slice(0, Math.min(Math.max(Number(limit) || 5, 1), 20));

  const rows = [];
  for (const cand of picked) {
    const { img, ota, sha256 } = await alistArtifacts(alist, cand.dirPath, cand.dirName, verify);
    const links = { 固件下载地址: alist.pageUrl(cand.dirPath) };
    if (img?.rawUrl) links['OSS 线刷地址'] = img.rawUrl;
    if (ota?.rawUrl) links['OSS OTA地址'] = ota.rawUrl;
    const artifacts = {};
    if (img) artifacts.img = { name: img.name, size: img.size };
    if (ota) artifacts.ota = { name: ota.name, size: ota.size };
    rows.push({
      version: cand.dirName,
      buildDate: cand.parsed.date,
      models: `${cand.productDir}${cand.lcdDir ? ` ${cand.lcdDir}` : ''}`,
      system: osNameByLetter(cand.parsed.osLetter) || cand.osSegment,
      customer: cand.customer,
      language: cand.parsed.region,
      stage: 'alist归档',
      updated: cand.modified.slice(0, 10),
      source: 'alist',
      lcd: cand.lcdDir,
      customerDir: cand.customerDir,
      ...(CUSTOMER_ALIAS[cand.customerDir.toUpperCase()] ? {} : { unmappedCustomer: true }),
      size: img?.size ?? 0,
      ...(sha256 ? { sha256 } : {}),
      artifacts,
      links,
      task: alist.pageUrl(cand.dirPath),
    });
  }
  return {
    ok: true,
    rows,
    otherCustomers: [...others.entries()].map(([name, tasks]) => ({ customer: name, tasks })),
  };
}

/**
 * alist 与 Teambition 同时给同一条直链时的标签：基础键留给 Teambition，
 * alist 那条换成明确名字并存 —— 两个源都要输出，刷写优先用 alist。
 */
const ALIST_LINK_LABEL = {
  '固件下载地址': 'alist 下载页',
  'OSS 线刷地址': 'alist 线刷地址',
  'OSS OTA地址': 'alist OTA地址',
};

/** 合并两边的链接：TB 缺的键由 alist 填，冲突的键把 alist 挪到带 alist 前缀的标签上 */
function mergeAlistLinks(tbLinks, alistLinks) {
  const out = { ...(tbLinks ?? {}) };
  for (const [key, url] of Object.entries(alistLinks ?? {})) {
    const value = String(url ?? '');
    if (!value) continue;
    if (!out[key]) {
      out[key] = value;
      continue;
    }
    if (out[key] === value) continue;
    out[ALIST_LINK_LABEL[key] ?? `alist ${key}`] = value;
  }
  return out;
}

/** 把 alist 兜底行并进 Teambition 行：同版本以 Teambition 为准，alist 补空链接并单独保留自己的直链 */
function mergeAlistRows(tbRows, alistRows) {
  const keyOf = (row) => `${String(row.customer ?? '').toUpperCase()}|${nz(row.version)}`;
  const out = tbRows.map((row) => ({ ...row, source: row.source ?? 'teambition' }));
  const index = new Map(out.map((row, at) => [keyOf(row), at]));
  for (const row of alistRows) {
    const key = keyOf(row);
    const at = index.get(key);
    if (at === undefined) {
      out.push(row);
      index.set(key, out.length - 1);
      continue;
    }
    const existing = out[at];
    existing.source = 'both';
    existing.links = mergeAlistLinks(existing.links, row.links);
    existing.artifacts = { ...(row.artifacts ?? {}), ...(existing.artifacts ?? {}) };
    if (!existing.size) existing.size = row.size;
    if (!existing.lcd) existing.lcd = row.lcd;
    if (!existing.sha256) existing.sha256 = row.sha256;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 无 TB 索引时的按型号懒加载（只扫 /PROD 匹配目录）
 * ------------------------------------------------------------------ */

async function alistModelGroups(ctx, exec, system) {
  const dir = await tokenDir(ctx, exec);
  const alist = alistFactory({ cacheFile: path.join(dir, 'alist-cache.json') });
  const chips = await alist.list('/PROD');
  if (!chips) return { ok: false, alist, groups: [] };
  const wanted = wantedOsSegments(system);
  const groups = new Map();
  for (const chipDir of chips.filter((entry) => entry.isDir)) {
    const chip = chipVendor(chipDir.name);
    const osDirs = await alist.list(`/PROD/${chipDir.name}`);
    if (!osDirs) continue;
    for (const osDir of osDirs.filter((entry) => entry.isDir)) {
      const osUpper = osDir.name.toUpperCase();
      if (wanted && !wanted.some((value) => osUpper.includes(value))) continue;
      const modelDirs = await alist.list(`/PROD/${chipDir.name}/${osDir.name}`);
      if (!modelDirs) continue;
      for (const modelDir of modelDirs.filter((entry) => entry.isDir)) {
        const { vendor, core } = canonModel(modelDir.name);
        if (!core) continue;
        const key = `${vendor || chip}\u0000${core}`;
        const group = groups.get(key) ?? {
          vendor: vendor || chip,
          core,
          names: [],
          seen: new Set(),
          count: 0,
          aliases: [],
          variants: new Map(),
          osList: new Set(),
        };
        if (!group.seen.has(modelDir.name)) {
          group.seen.add(modelDir.name);
          group.names.push(modelDir.name);
        }
        group.count += 1;
        group.osList.add(osDir.name);
        groups.set(key, group);
      }
    }
  }
  const out = [...groups.values()].map((group) => {
    group.name = [...group.names].sort((a, b) => a.localeCompare(b))[0] ?? group.core;
    group.aliases = group.names.filter((name) => name !== group.name);
    delete group.seen;
    return group;
  });
  return { ok: true, alist, groups: out };
}

/** 本地没有 board 索引时也能查：用 /PROD 的机型目录做解析，再只扫匹配目录 */
async function searchFromAlist(ctx, exec, args) {
  const query = String(args.model ?? '').trim();
  const catalog = await alistModelGroups(ctx, exec, args.system);
  if (!catalog.ok) {
    return {
      status: 'needs_setup',
      query,
      hint: 'alist 不可达；请检查网络或先 /firmware sync。',
      rows: [],
    };
  }
  const { hit, hits, scored, variant } = resolveModel(query, catalog.groups);
  if (!hit) {
    return {
      status: 'needs_confirmation',
      query,
      note: '本地没有 TB 看板索引，已改用 alist /PROD 机型目录；机型无法唯一确定。',
      hint: '候选来自 /PROD 机型目录；用户说法里的 MIX/PLUS/PRO/A 后缀可以直接作为变体重试。',
      candidates: scored.slice(0, 8).map(([score, group]) => ({
        model: group.name,
        score,
        tasks: group.count,
        aliases: group.aliases,
        variants: [],
      })),
      rows: [],
    };
  }

  const families = variant ? [hit.name] : hits?.length ? hits.map((group) => group.name) : [hit.name];
  const cores = variant
    ? [variant.core]
    : [...new Set(families.map((name) => canonModel(name).core))].filter(Boolean);
  const requested = String(args.customer ?? '').trim();
  const customerDefaulted = !requested;
  const effective = customerDefaulted ? 'CP' : requested;
  const unlimited = /^(all|\*|不限)$/i.test(effective);
  const limit = Math.max(1, Math.min(20, Number(args.limit) || 5));

  const collected = await collectAlistRows(catalog.alist, {
    cores,
    vendor: hit.vendor,
    system: args.system,
    customer: unlimited ? '' : effective,
    version: args.version,
    limit,
    verify: Boolean(args.verify),
  });
  if (!collected.ok) {
    return { status: 'empty', resolvedModel: hit.name, note: 'alist 产品目录不可达。', rows: [] };
  }
  const includeDev = args.dev === true || ['1', 'true', 'yes'].includes(String(args.dev ?? '').toLowerCase());
  const rowsSplit = splitDevRows(collected.rows, includeDev);
  const rows = rowsSplit.rows;
  const devNote =
    rowsSplit.hidden > 0
      ? `\n已隐藏 ${rowsSplit.hidden} 条 DEV 构建（默认只给量产版；确实要 DEV 请加 dev:true）。`
      : '';
  return {
    status: rows.length ? 'ok' : 'empty',
    resolvedModel: hit.name,
    ...(variant ? { variant: variant.label } : {}),
    aliases: hit.aliases ?? [],
    matchedFamilies: families.length > 1 ? families : [],
    customer: effective,
    customerDefaulted,
    otherCustomers: collected.otherCustomers ?? [],
    total: rows.length,
    rows,
    note:
      '本地没有 TB 看板索引，本次直接查 alist /PROD（只扫匹配的机型/客户/系统目录）。' +
      '要 TB 阶段/任务链接/子任务状态请 /firmware sync。' +
      devNote,
    alist: { ok: true, rows: rows.length },
  };
}

/** TB 任务 -> 输出行 */
function taskRow(task, variantLabel = '') {
  return {
    id: task.id,
    version: String(task.fields?.['固件版本'] ?? '') || task.title,
    buildDate: versionDate(task),
    models: asList(task.fields?.['机型']).join(', '),
    system: asList(task.fields?.['操作系统']).join(', '),
    customer: asList(task.fields?.['客户ID']).join(', '),
    language: asList(task.fields?.['固件语言']).join(', '),
    stage: task.stage ?? '',
    updated: String(task.updated ?? '').slice(0, 10),
    ...(variantLabel ? { variant: variantLabel } : {}),
    links: linksOf(task),
    task: task.url,
  };
}

/** 版本号匹配串：字段为空时（在制/迭代任务）靠标题和下载地址兜住 */
function versionHay(task) {
  return nz(
    [
      String(task.fields?.['固件版本'] ?? ''),
      String(task.title ?? ''),
      ...Object.values(linksOf(task)),
    ].join(' '),
  );
}

const rowKey = (row) =>
  row.id ? `id:${row.id}` : `${String(row.customer ?? '').toUpperCase()}|${nz(row.version)}`;

/**
 * DEV 构建识别：版本串 / 标题 / 下载地址里的 `DEV-` 或 `DEV_`（如
 * `CP_SP2-10PRO_D_DEV-DE9E2564_LCD10_B0_EU_20261103`）。
 * 默认只给量产（不带 DEV 标识），用户点名要 DEV 时才放行。
 */
function isDevFirmware(row) {
  const hay = [row?.version, row?.title, ...Object.values(row?.links ?? {})].filter(Boolean).join(' ');
  return /DEV[-_]/i.test(hay);
}

/** 按 includeDev 过滤行；返回被隐藏的条数（用于 note 里如实交代）。 */
function splitDevRows(rows, includeDev) {
  if (includeDev || !Array.isArray(rows)) return { rows: rows ?? [], hidden: 0 };
  const kept = rows.filter((row) => !isDevFirmware(row));
  return { rows: kept, hidden: rows.length - kept.length };
}

/** 实时探测行并入快照行：同版本以实时结果为准（阶段/链接），其余字段保留 */
function mergeLiveRows(baseRows, liveRows) {
  const out = baseRows.map((row) => ({ ...row }));
  const index = new Map(out.map((row, at) => [rowKey(row), at]));
  for (const row of liveRows) {
    const key = rowKey(row);
    const at = index.get(key);
    if (at === undefined) {
      out.push({ ...row });
      index.set(key, out.length - 1);
      continue;
    }
    const existing = out[at];
    existing.stage = row.stage || existing.stage;
    if (row.version) existing.version = row.version;
    if (row.id && !existing.id) existing.id = row.id;
    existing.links = { ...(existing.links ?? {}), ...(row.links ?? {}) };
    if (!existing.task && row.task) existing.task = row.task;
    if (row.buildDate) existing.buildDate = row.buildDate;
    existing.updated = row.updated || existing.updated;
    existing.source = existing.source === 'alist' ? 'both' : 'tb-live';
  }
  return out;
}

/** 探测候选的机型/系统/客户过滤（操作系统字段为空时不排除，交由结果里标注） */
function probedMatch(task, { needles, system, customer, unlimited }) {
  if (!hitModel(task, needles)) return false;
  const osList = asList(task.fields?.['操作系统']).map(String);
  if (system && osList.length && !hitSystem(task, system)) return false;
  if (!unlimited) {
    const cust = asList(task.fields?.['客户ID']).map(String).join(',');
    if (!cust.toUpperCase().includes(String(customer).toUpperCase())) return false;
  }
  return true;
}

/**
 * 实时探测：每次 firmware_find 都按机型搜 TB，补拉版本父任务详情（搜索行不带阶段），
 * 返回最新的若干条「已归档/在制」任务行。失败抛出，由 search 静默降级。
 */
async function defaultVersionProbe({ ctx, exec, queries, needles, system, customer, unlimited, limit = 3 }) {
  const cores = [...new Set(queries.filter((q) => q && String(q).trim().length >= 3))].slice(0, 2);
  // 版本父任务在纯机型搜索里排名常常靠后，补一条「<机型> 版本迭代」把迭代任务提上来
  const list = [...new Set(cores.flatMap((q) => [q, `${q} 版本迭代`]))];
  if (!list.length) return [];
  const dir = await tokenDir(ctx, exec);
  const tokFile = path.join(dir, 'token.json');
  if (!fs.existsSync(tokFile)) throw new Error('缺少 TB 凭据 token.json，无法实时核对');
  const cookie = readCookie(tokFile);
  if (!cookie) throw new Error('token.json 里没有 teambition cookie，无法实时核对');
  const client = createTbClient({ cookie });
  const batches = await Promise.all(list.map((q) => client.search(PROJECT_ID, q, 3).catch(() => [])));
  const hits = [];
  const seen = new Set();
  for (const batch of batches) {
    for (const row of batch) {
      if (!row?._id || seen.has(row._id)) continue;
      seen.add(row._id);
      hits.push(row);
    }
  }
  if (!hits.length) return [];
  const defs = await client.defs(PROJECT_ID);
  const candidates = hits
    .map((row) => normalizeTask(row, defs))
    .filter((task) => isVersionTask(task) && probedMatch(task, { needles, system, customer, unlimited }));
  if (!candidates.length) return [];
  const detailed = await Promise.all(
    candidates.slice(0, 12).map(async (task) => {
      try {
        return normalizeTask(await client.task(task.id), defs);
      } catch {
        return task;
      }
    }),
  );
  return detailed
    .filter((task) => probedMatch(task, { needles, system, customer, unlimited }))
    .sort((a, b) => Number(versionDate(b) || 0) - Number(versionDate(a) || 0))
    .slice(0, Math.max(1, limit))
    .map((task) => ({ ...taskRow(task), source: 'tb-live' }));
}

async function search(ctx, exec, args) {
  let board;
  try {
    board = await readBoard(ctx, exec);
  } catch (e) {
    if (/找不到看板索引/.test(e.message)) {
      return searchFromAlist(ctx, exec, args);
    }
    throw e;
  }
  const groups = modelGroups(board);
  const query = String(args.model ?? '').trim();
  const { hit, hits, scored, variant } = resolveModel(query, groups);
  if (!hit) {
    return {
      status: 'needs_confirmation',
      query,
      note: '机型无法唯一确定，请让用户在候选里选一个，不要自行猜测',
      hint:
        '候选里的 variants 是归档链接中的机型目录名（如 APOLLO2-MIX）；' +
        '用户说法里的 MIX/PLUS/PRO/A 后缀可以直接作为变体重试，不必换其它工具或数据源',
      candidates: scored.slice(0, 8).map(([score, g]) => ({
        model: g.name,
        score,
        tasks: g.count,
        aliases: g.aliases,
        variants: variantList(g),
      })),
      rows: [],
    };
  }

  // 变体查询只按变体名过滤；族查询维持原行为（含同族写法 + 7/7A、12/12A 等价写法）
  const families = variant ? [hit.name] : (hits?.length ? hits.map((g) => g.name) : [hit.name]);
  const needles = variant
    ? [variant.core]
    : [...new Set(families.flatMap((name) => modelVariants(name)))];
  let cands = board.items.filter(
    (t) => hitModel(t, needles) && hitSystem(t, args.system, args.mainline),
  );
  // 客户维度：未指定时默认 CP，但必须把「其他客户还有什么」讲出来
  const customerPool = new Map();
  for (const t of cands) {
    for (const c of asList(t.fields?.['客户ID'])) {
      const key = String(c);
      customerPool.set(key, (customerPool.get(key) ?? 0) + 1);
    }
  }
  const requested = String(args.customer ?? '').trim();
  const customerDefaulted = !requested;
  const effective = customerDefaulted ? 'CP' : requested;
  const unlimited = /^(all|\*|不限)$/i.test(effective);
  if (!unlimited) {
    cands = cands.filter((t) =>
      String(t.fields?.['客户ID'] ?? '').toUpperCase().includes(effective.toUpperCase()),
    );
  }
  const others = [...customerPool.entries()]
    .filter(([c]) => !unlimited && !c.toUpperCase().includes(effective.toUpperCase()))
    .sort((a, b) => b[1] - a[1]);
  const othersText = others.slice(0, 6).map(([c, n]) => `${c}(${n})`).join('、');
  if (args.version) {
    const v = nz(args.version);
    cands = cands.filter((t) => versionHay(t).includes(v));
  }
  if (args.stage) cands = cands.filter((t) => String(t.stage ?? '').includes(String(args.stage)));
  if (!args.all) cands = cands.filter((t) => Object.keys(linksOf(t)).length > 0);

  cands.sort((a, b) => {
    const [pa, ta] = rankKey(a);
    const [pb, tb] = rankKey(b);
    return pa - pb || ta - tb;
  });

  const seen = new Set();
  const uniq = [];
  for (const t of cands) {
    const key = String(t.fields?.['固件版本'] ?? '') || t.id;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(t);
  }

  const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20);
  const sourceMode = ['auto', 'tb', 'alist'].includes(String(args.source ?? '').toLowerCase())
    ? String(args.source).toLowerCase()
    : 'auto';
  const indexSyncedAt = String(board.syncedAt ?? '');
  const indexAgeHours = ageHoursOf(indexSyncedAt);
  const refreshedAt = new Date().toISOString();

  // 快照里的「更新在制版本」先记下来；实时/兜底核对到归档结果后会把它替换掉
  const localPending = [];
  {
    const bestArchivedLocal = Math.max(
      0,
      ...cands.filter((t) => rankKey(t)[0] === 0).map((t) => Number(versionDate(t) || 0)),
    );
    const seenPending = new Set();
    for (const t of cands) {
      if (rankKey(t)[0] === 0) continue;
      const bd = versionDate(t);
      if (!bd || Number(bd) <= bestArchivedLocal) continue;
      const ver = String(t.fields?.['固件版本'] ?? '') || t.title;
      if (seenPending.has(nz(ver))) continue;
      seenPending.add(nz(ver));
      localPending.push({ version: ver, buildDate: bd, stage: t.stage ?? '', task: t.url });
      if (localPending.length >= 3) break;
    }
  }

  let rows = uniq.slice(0, limit).map((t) => taskRow(t, variant ? variant.label : ''));

  // ---- 实时核对 TB：每次查询都做，不再把索引快照当「最新」 ----
  const probeDisabled = process.env.DSH_FIRMWARE_NO_PROBE === '1';
  let liveChecked = false;
  let probeError = '';
  const probePending = [];
  if (!probeDisabled && sourceMode !== 'alist') {
    try {
      const queries = [
        ...(hits?.length ? hits.map((g) => canonModel(g.name).core) : [canonModel(hit.name).core]),
        variant?.core,
        ...needles,
      ].filter(Boolean);
      const probeFn = versionProbe ?? defaultVersionProbe;
      const probed = await probeFn({
        ctx,
        exec,
        queries,
        needles,
        system: args.system,
        customer: effective,
        unlimited,
        limit: 3,
      });
      liveChecked = true;
      // 探测结果也要遵守用户给的 version / stage 过滤
      const versionNeedle = args.version ? nz(args.version) : '';
      const liveRows = probed.filter((row) => {
        if (versionNeedle && !nz(`${row.version} ${Object.values(row.links ?? {}).join(' ')}`).includes(versionNeedle)) {
          return false;
        }
        if (args.stage && !String(row.stage ?? '').includes(String(args.stage))) return false;
        return true;
      });
      const archivedLive = liveRows.filter((row) => stageRank(row.stage) === 0);
      if (archivedLive.length) rows = mergeLiveRows(rows, archivedLive);
      for (const row of liveRows) {
        if (stageRank(row.stage) === 0) continue;
        probePending.push({ version: row.version, buildDate: row.buildDate, stage: row.stage, task: row.task });
      }
    } catch (error) {
      probeError = String(error?.message ?? error);
    }
  }

  // ---- alist /PROD 实时核对：auto/alist 每次都扫（目录 TTL=0，不复用旧缓存） ----
  const alistDisabled = process.env.DSH_ALIST_DISABLE === '1';
  const wantAlist = !alistDisabled && sourceMode !== 'tb';
  let alistInfo;
  let finalRows = rows;
  let alistOthers = [];
  let alistUsed = false;
  if (wantAlist) {
    try {
      const cacheDir = await tokenDir(ctx, exec);
      const alist = alistFactory({ cacheFile: path.join(cacheDir, 'alist-cache.json'), ttlMs: 0 });
      const cores = [
        ...new Set(
          (variant ? [variant.core] : (hits?.length ? hits : [hit]).map((g) => canonModel(g.name).core)).filter(
            Boolean,
          ),
        ),
      ];
      const collected = await collectAlistRows(alist, {
        cores,
        vendor: hit.vendor,
        system: args.system,
        customer: unlimited ? '' : effective,
        version: args.version,
        limit: Math.max(limit, 3),
        verify: Boolean(args.verify),
      });
      alistInfo = {
        ok: collected.ok,
        refreshed: true,
        requests: alist.stats.requests,
        cacheHits: alist.stats.cacheHits,
        rows: collected.rows.length,
      };
      if (!collected.ok) alistInfo.reason = 'alist 不可达或未返回数据';
      if (collected.ok && collected.rows.length) {
        alistUsed = true;
        finalRows = sourceMode === 'alist' ? collected.rows : mergeAlistRows(rows, collected.rows);
        alistOthers = collected.otherCustomers ?? [];
      }
    } catch (error) {
      alistInfo = { ok: false, reason: String(error?.message ?? error) };
    }
  }
  finalRows = [...finalRows].sort((a, b) => {
    // 归档优先（alist /PROD 视为已归档），同档内按构建日期倒序
    const rank = (row) => (row.source === 'alist' || row.source === 'both' ? 0 : stageRank(row.stage));
    return rank(a) - rank(b) || String(b.buildDate ?? '').localeCompare(String(a.buildDate ?? ''));
  });

  // 归档（TB 生产库归档 + alist /PROD）才是「最新」；比它更晚、尚未归档的构建才进 pending
  const archivedRows = finalRows.filter(
    (row) => stageRank(row.stage) === 0 || row.source === 'alist' || row.source === 'both',
  );
  const bestArchived = Math.max(0, ...archivedRows.map((row) => Number(row.buildDate || 0)));
  const archivedVersions = new Set(archivedRows.map((row) => nz(row.version)));
  const pending = [];
  {
    const seenPending = new Set();
    const seenDate = new Set();
    for (const item of [...probePending, ...localPending]) {
      if (archivedVersions.has(nz(item.version))) continue;
      if (!item.buildDate || Number(item.buildDate) <= bestArchived) continue;
      if (seenPending.has(nz(item.version)) || seenDate.has(String(item.buildDate))) continue;
      seenPending.add(nz(item.version));
      seenDate.add(String(item.buildDate));
      pending.push(item);
      if (pending.length >= 3) break;
    }
  }

  // 默认只给量产：未点名 DEV 时隐藏 DEV-xxxx 构建（用户要求：不带 DEV 标识就是量产版）
  const includeDev = args.dev === true || ['1', 'true', 'yes'].includes(String(args.dev ?? '').toLowerCase());
  let devHidden = 0;
  {
    const rowsSplit = splitDevRows(finalRows, includeDev);
    devHidden += rowsSplit.hidden;
    finalRows = rowsSplit.rows;
  }
  if (!includeDev && pending.length) {
    const pendingSplit = splitDevRows(pending, includeDev);
    devHidden += pendingSplit.hidden;
    pending.length = 0;
    pending.push(...pendingSplit.rows);
  }

  const matchedCount = finalRows.length;
  finalRows = finalRows.slice(0, limit);

  if (args.verify) {
    await Promise.all(
      finalRows.flatMap((r) =>
        Object.entries(r.links ?? {})
          // next/alist 是内网分享页（10.16.18.x），本机必然超时；其余仓库都校验
          .filter(([, u]) => typeof u === 'string' && u && !/\/\/(next|alist)\.cpinnov\.run/i.test(u))
          .map(async ([k, u]) => {
            r.checks ??= {};
            r.checks[k] = await probe(u);
          }),
      ),
    );
  }

  const othersMerged = [];
  const otherSeen = new Set();
  for (const item of [...others.map(([c, n]) => ({ customer: c, tasks: n })), ...alistOthers]) {
    const key = String(item.customer ?? '').toUpperCase();
    if (!key || otherSeen.has(key)) continue;
    otherSeen.add(key);
    othersMerged.push(item);
  }
  const othersTextMerged = othersMerged.slice(0, 6).map((x) => `${x.customer}(${x.tasks})`).join('、');

  const result = {
    status: finalRows.length ? 'ok' : 'empty',
    query,
    resolvedModel: hit.name,
    aliases: hit.aliases,
    ...(families.length > 1 ? { matchedFamilies: families } : {}),
    customer: unlimited ? '*' : effective,
    customerDefaulted,
    otherCustomers: othersMerged.slice(0, 10),
    total: matchedCount,
    indexSyncedAt,
    ...(indexAgeHours != null ? { indexAgeHours: Math.round(indexAgeHours * 10) / 10 } : {}),
    refreshedAt,
    liveChecked,
    pending,
    rows: finalRows,
    ...(alistInfo ? { alist: alistInfo } : {}),
  };
  if (variant) result.variant = variant.label;
  const noteParts = [];
  if (probeDisabled) {
    noteParts.push('已按 DSH_FIRMWARE_NO_PROBE=1 关闭实时核对，结果来自本地索引快照，可能漏掉新归档');
  } else if (liveChecked) {
    noteParts.push('已实时核对 Teambition（未使用本地索引快照）');
  } else if (probeError) {
    noteParts.push(
      `实时核对失败（${probeError}），以下为本地索引快照${
        indexAgeHours != null ? `（${indexAgeHours.toFixed(1)} 小时前）` : ''
      }，可能漏掉新归档；可 /firmware login 后重试`,
    );
  }
  if (alistUsed) noteParts.push('已实时核对 alist /PROD，并用其补齐版本与直链');
  else if (alistInfo?.ok) {
    // 静默「没扫到」最容易被读成「alist 没有这个版本」，必须显式说清是匹配问题
    noteParts.push(
      'alist /PROD 已实时扫描，但没匹配到该机型的版本目录（机型目录写法可能不同），本次未附 alist 直链；这不代表 alist 没有该版本——next 与 alist 是同一份存储、内容同步',
    );
  } else if (alistInfo && !alistInfo.ok) {
    noteParts.push(
      `alist /PROD 实时扫描失败（${alistInfo.reason ?? '不可达'}），本次链接全部来自 Teambition；不要据此推断 alist 没有该版本`,
    );
  }
  if (devHidden > 0) {
    noteParts.push(
      `已隐藏 ${devHidden} 条 DEV 构建（默认只给量产版；确实要 DEV 请加 dev:true 或在需求里点名 DEV）`,
    );
  }
  // DSH 对工具返回值做无损 JSON 校验：值为 undefined 的属性会让整次调用
  // INVALID_TOOL_OUTPUT，所以没有提示时直接省略该字段（schema 里 note 是可选的）。
  if (customerDefaulted && !unlimited) {
    noteParts.push(
      finalRows.length === 0 && othersTextMerged
        ? `客户 CP 下没有匹配；其他客户还有：${othersTextMerged}。需要时用 customer 参数切换。`
        : `未指定客户，已默认按 CP 过滤；其他客户还有：${othersTextMerged}`,
    );
  }
  if (noteParts.length) result.note = noteParts.join('\n');
  return result;
}

/** 工具返回值要过 DSH 的无损 JSON 校验：undefined 属性会被整次拒绝，这里按 JSON 语义丢掉。 */
function jsonSafe(value) {
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

const fmtSize = (n) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return i === 0 ? `${n}B` : `${v.toFixed(1)}${units[i]}`;
};

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

function findToolFor(ctx) {
  return {
    name: 'firmware_find',
    description:
      '按机型和操作系统定位量产固件，返回固件版本、构建日期、客户，以及线刷/OTA 直链（同版本两边都有时给两条：alist 优先 + minio/next 备用）。next 与 alist 是同一份存储的两个入口、内容同步：链接指向 next 不代表 alist 没有该版本，不要说成「alist 未收录」。默认只返回量产版（不带 DEV 标识）：DEV-xxxx 构建默认被过滤，需要时传 dev:true 或在需求里点名 DEV；过滤数量会写在 note 里。每次调用都会实时核对 Teambition（补拉版本父任务详情，索引快照只作兜底）并实时扫描 alist /PROD 目录（不复用旧缓存），因此刚归档的版本也能立刻查到；单次约 3–8 秒。结果来源标注：source=tb-live 为实时 TB、alist 为 alist /PROD、both 为两边都有。liveChecked=false 表示实时核对失败（如未登录），此时 note 会说明快照时间，回答时应转述。机型支持自由写法（如 apollo 12 pro、SP2-10PRO），7/7A、12/12A 等价写法会合并命中。机型存在歧义时返回 status=needs_confirmation 和候选列表，必须先向用户确认再继续。未指定客户时默认按 CP 过滤，并在 note/otherCustomers 里列出其他客户，不要忽略这部分信息。',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: '机型，接受自由写法：APOLLO2-12PRO、apollo 12 pro、SP2-10PRO、spring2 等',
        },
        system: { type: 'string', description: '操作系统：Android、Debian、BuildRoot。省略则不按系统过滤' },
        customer: { type: 'string', description: '客户ID，如 CP、SZ、QX、VR。省略时默认 CP；传 * 表示不限客户。同一机型的不同客户固件不能混刷' },
        version: { type: 'string', description: '版本号片段，如 V1.08' },
        mainline: { type: 'string', description: '关联代码主线片段，如 Android-11' },
        stage: { type: 'string', description: '阶段过滤，如 生产库归档' },
        limit: { type: 'integer', description: '返回条数上限，默认 5，最大 20' },
        verify: { type: 'boolean', description: '是否 HEAD 校验 minio 链接并返回体积；alist 兜底时额外解析 sha256sum.txt' },
        dev: { type: 'boolean', description: '是否包含 DEV 构建（默认 false：只给量产版，不带 DEV 标识）' },
        all: { type: 'boolean', description: '包含没有固件链接的任务，默认 false' },
        source: {
          type: 'string',
          enum: ['auto', 'tb', 'alist'],
          description: '数据源：auto=先 Teambition，取不到再兜底 alist（默认）；tb=只用 Teambition；alist=只查 alist',
        },
      },
      required: ['model'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'empty', 'needs_confirmation', 'needs_setup'] },
          query: { type: 'string' },
          resolvedModel: { type: 'string' },
          variant: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' } },
          matchedFamilies: { type: 'array', items: { type: 'string' } },
          alist: {
            type: 'object',
            properties: {
              ok: { type: 'boolean' },
              reason: { type: 'string' },
              requests: { type: 'integer' },
              cacheHits: { type: 'integer' },
              rows: { type: 'integer' },
            },
          },
          note: { type: 'string' },
          hint: { type: 'string' },
          customer: { type: 'string' },
          customerDefaulted: { type: 'boolean' },
          otherCustomers: {
            type: 'array',
            items: {
              type: 'object',
              properties: { customer: { type: 'string' }, tasks: { type: 'integer' } },
            },
          },
          total: { type: 'integer' },
          indexSyncedAt: { type: 'string' },
          indexAgeHours: { type: 'number' },
          refreshedAt: { type: 'string' },
          liveChecked: { type: 'boolean' },
          pending: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                buildDate: { type: 'string' },
                stage: { type: 'string' },
                task: { type: 'string' },
              },
            },
          },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                model: { type: 'string' },
                score: { type: 'number' },
                tasks: { type: 'integer' },
                aliases: { type: 'array', items: { type: 'string' } },
                variants: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, tasks: { type: 'integer' } },
                  },
                },
              },
            },
          },
          rows: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                version: { type: 'string' },
                buildDate: { type: 'string' },
                models: { type: 'string' },
                system: { type: 'string' },
                customer: { type: 'string' },
                language: { type: 'string' },
                stage: { type: 'string' },
                updated: { type: 'string' },
                variant: { type: 'string' },
                source: { type: 'string' },
                lcd: { type: 'string' },
                customerDir: { type: 'string' },
                unmappedCustomer: { type: 'boolean' },
                size: { type: 'integer' },
                sha256: { type: 'string' },
                artifacts: { type: 'object' },
                links: { type: 'object' },
                checks: { type: 'object' },
                task: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderFind(value) }],
    },
    async execute(args, exec) {
      return jsonSafe(await search(ctx, exec, args ?? {}));
    },
  };
}

function renderFind(v) {
  if (v.status === 'needs_confirmation') {
    const lines = [`机型「${v.query}」无法唯一确定，需要用户确认：`, ''];
    for (const c of v.candidates) {
      const alias = c.aliases?.length ? `  (同族写法: ${c.aliases.join(' / ')})` : '';
      const vs = c.variants?.length
        ? `  变体: ${c.variants.map((x) => `${x.label}(${x.tasks})`).join(' / ')}`
        : '';
      lines.push(`- ${c.model}  [${c.score} 分, ${c.tasks} 个任务]${alias}${vs}`);
    }
    if (v.hint) lines.push('', `提示：${v.hint}`);
    lines.push('', '请让用户选定一个后再调用，不要自行猜测。');
    return lines.join('\n');
  }
  if (v.status === 'needs_setup') {
    return `还没有本地索引。${v.hint ?? '先运行 /tickets sync。'}`;
  }
  if (v.status === 'empty') {
    const base = `没有匹配的固件（机型=${v.resolvedModel}${
      v.variant ? ` · 变体 ${v.variant}` : ''
    }）。`;
    return v.note ? `${base}\n· ${v.note}` : `${base}可放宽 system/customer/stage。`;
  }

  const head = `命中 ${v.total} 条，显示 ${v.rows.length} 条（机型=${v.resolvedModel}${
    v.variant ? ` · 变体 ${v.variant}` : ''
  }${v.matchedFamilies?.length > 1 ? `，等价写法 ${v.matchedFamilies.join(' / ')}` : ''}${
    v.aliases?.length ? `，同族写法 ${v.aliases.join('/')}` : ''
  }）`;
  const lines = [head, ''];
  if (v.note) lines.push(`· ${v.note}`, '');
  if (v.pending?.length) {
    lines.push('注意：存在比已归档版本更新的在制/测试版本，未经生产归档：');
    for (const x of v.pending) {
      lines.push(`  · ${x.version}  (构建 ${x.buildDate}, ${x.stage})${x.task ? `  ${x.task}` : ''}`);
    }
    lines.push('');
  }
  v.rows.forEach((r, i) => {
    const tag =
      r.source === 'alist' ? '[alist] ' : r.source === 'both' ? '[tb+alist] ' : r.source === 'tb-live' ? '[实时] ' : '';
    lines.push(`[${i + 1}] ${tag}${r.version}`);
    const extra = [r.lcd, r.size ? fmtSize(r.size) : ''].filter(Boolean).join(' | ');
    lines.push(
      `    ${r.buildDate || '无构建日期'}${extra ? ` | ${extra}` : ''} | ${r.models} | ${r.system} | 客户 ${r.customer || '-'} | ${r.language} | ${r.stage} | 更新 ${r.updated}`,
    );
    if (r.sha256) lines.push(`    sha256: ${r.sha256}`);
    for (const [k, u] of Object.entries(r.links)) {
      const chk = r.checks?.[k];
      const mark = chk ? `  [${chk.code || 'ERR'}${chk.size ? ` ${fmtSize(chk.size)}` : ''}]` : '';
      lines.push(`    ${k}: ${u}${mark}`);
    }
    lines.push(`    ${r.source === 'alist' ? 'alist' : '任务'}: ${r.task}`);
    lines.push('');
  });
  return lines.join('\n');
}

function modelsToolFor(ctx) {
  return {
    name: 'firmware_models',
    description:
      '列出 Teambition 发版看板里出现过的机型族，含规范写法、同族别名（含归档链接目录里的缩写写法，如 SP2-10MIX）、变体（如 APOLLO2-MIX）和任务数。传 model 时只返回匹配的族。传 alist=true 时附带 alist 产品目录里的机型目录概览（兜底数据源，如 CP 的 Debian 只在 alist）。机型写法不确定时先查这里，不要用其它插件的数据源。',
    parameters: {
      type: 'object',
      properties: {
        model: { type: 'string', description: '可选。只看与这个写法相关的族/变体，如 APOLLO2MIX、SP2-10MIX' },
        alist: { type: 'boolean', description: '可选。附带 alist 产品目录概览（chip/os/机型目录），默认 false' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          families: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                model: { type: 'string' },
                tasks: { type: 'integer' },
                aliases: { type: 'array', items: { type: 'string' } },
                variants: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: { label: { type: 'string' }, tasks: { type: 'integer' } },
                  },
                },
              },
            },
          },
          alistProducts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                chip: { type: 'string' },
                os: { type: 'string' },
                models: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          alistOk: { type: 'boolean' },
        },
      },
      render: (_a, v) => {
        const lines = v.families.map(
          (f) =>
            `${f.model}  (${f.tasks})${f.aliases.length ? `  = ${f.aliases.join(' / ')}` : ''}${
              f.variants?.length ? `  变体: ${f.variants.map((x) => `${x.label}(${x.tasks})`).join(' / ')}` : ''
            }`,
        );
        if (v.alistProducts?.length) {
          lines.push('', 'alist 产品目录：');
          for (const item of v.alistProducts) {
            lines.push(`  ${item.chip}/${item.os}: ${item.models.join(', ')}`);
          }
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(args, exec) {
      const groups = modelGroups(await readBoard(ctx, exec));
      const query = String(args?.model ?? '').trim();
      let picked = groups;
      if (query) {
        const { hit, scored } = resolveModel(query, groups);
        picked = hit ? [hit] : scored.slice(0, 5).map(([, g]) => g);
      }
      picked = [...picked].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      const result = {
        families: picked.map((g) => ({
          model: g.name,
          tasks: g.count,
          aliases: g.aliases,
          variants: variantList(g, 20),
        })),
      };
      if (args?.alist && process.env.DSH_ALIST_DISABLE !== '1') {
        try {
          const alist = alistFactory({ cacheFile: path.join(await tokenDir(ctx, exec), 'alist-cache.json') });
          const chips = await alist.list('/PROD');
          result.alistOk = Boolean(chips);
          if (chips) {
            const products = [];
            for (const chip of chips.filter((e) => e.isDir)) {
              const osDirs = await alist.list(`/PROD/${chip.name}`);
              for (const os of (osDirs ?? []).filter((e) => e.isDir)) {
                const models = await alist.list(`/PROD/${chip.name}/${os.name}`);
                products.push({
                  chip: chip.name,
                  os: os.name,
                  models: (models ?? []).filter((e) => e.isDir).map((e) => e.name),
                });
              }
            }
            result.alistProducts = products;
          }
        } catch {
          result.alistOk = false;
        }
      }
      return jsonSafe(result);
    },
  };
}

/* ------------------------------------------------------------------ *
 * /firmware：技能入口（自然语言同样可调用，不再有强约束）
 * ------------------------------------------------------------------ */

/**
 * 读取并解析插件自带的 SKILL.md。
 *
 * 与 `@deepseek-ai/dsh-skill-filesystem` 的 frontmatter 语义保持一致：
 * `disable-model-invocation` 关掉模型侧目录，`user-invocable` 关掉用户侧 `/` 菜单。
 * 运行时注册（`ctx.skills.register`）不会自己读 frontmatter，所以这里解析后显式放进
 * `invocation`，否则模型目录里会一直出现这个 skill。
 */
function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

export const name = 'firmware-finder';
export const inject = ['tools', 'skills'];

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(findToolFor(ctx)));
  ctx.effect(() => ctx.tools.register(modelsToolFor(ctx)));
  try {
    const skill = readBundledSkill();
    ctx.effect(() => ctx.skills.register(skill));
  } catch (error) {
    const message = `[firmware-finder] 注册运行时 skill 失败：${error?.message || error}`;
    if (ctx.logger?.warn) ctx.logger.warn(message);
    else console.warn(message);
  }
}

/** 供离线冒烟测试使用的内部函数（不参与运行时契约）。 */
export const __internals = {
  PLUGIN_DIR,
  SKILL_FILE,
  readBundledSkill,
  canonModel,
  equivCore,
  queryCores,
  scoreCore,
  modelGroups,
  foldModelDirs,
  resolveModel,
  variantList,
  linkModelDir,
  taskModelDir,
  hitModel,
  modelVariants,
  search,
  // alist 兜底
  mapCustomerDir,
  matchModelDir,
  lcdFromCores,
  collectAlistRows,
  mergeAlistRows,
  parseVersionDir,
  alistModelGroups,
  searchFromAlist,
  taskRow,
  versionHay,
  defaultVersionProbe,
  setAlistFactory: (factory) => {
    alistFactory = factory;
  },
  setVersionProbe: (fn) => {
    versionProbe = fn;
  },
  setFetch: (impl) => {
    fetchImpl = impl;
  },
};
