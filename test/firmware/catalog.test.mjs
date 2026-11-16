/**
 * 机型目录（严格两步匹配）的单测：
 * - lcd 解析/匹配（LCD7 命中 LCD7-12，反向不成立）
 * - buildCatalog 的聚合（尺寸、系统、客户、最新版本）与等价族合并
 * - resolveExact 只认整串相等的规范名/别名/变体名，跨芯片同名必须报歧义
 * - suggestMatches 只用于排序候选，不参与自动决策
 */
import assert from 'node:assert/strict';

import { __internals } from '../../src/firmware/index.js';

const { buildCatalog, resolveExact, suggestMatches, firmwareSharingScope, lcdOf, lcdMatch, normalizeLcd } = __internals;

const ok = (name) => console.log(`ok  ${name}`);

const task = (id, title, stage, fields, updated = '2026-10-01T00:00:00.000Z') => ({
  id,
  title,
  url: `https://www.teambition.com/task/${id}`,
  stage,
  updated,
  isArchived: false,
  fields,
});

const board = {
  projectId: '65a8da81950780b816d12bd9',
  syncedAt: '2026-10-29T00:00:00.000Z',
  items: [
    task('a7', 'CP_APOLLO2_D_V1.12_LCD7_B1_CN_20260805', '生产库归档', {
      机型: ['RK / APOLLO2'],
      操作系统: ['Debian'],
      客户ID: 'CP',
      固件版本: 'CP_APOLLO2_D_V1.12_LCD7_B1_CN_20260805',
      固件下载地址:
        'https://next.cpinnov.run/PROD/RK/DEBIAN/APOLLO2/CP/LCD7/CP_APOLLO2_D_V1.12_LCD7_B1_CN_20260805',
    }),
    task('a12', 'CP_APOLLO2_D_V1.10_LCD12_B1_CN_20261113', '生产库归档', {
      机型: ['RK / APOLLO2'],
      操作系统: ['Debian'],
      客户ID: ['CP', 'OMSI'],
      固件版本: 'CP_APOLLO2_D_V1.10_LCD12_B1_CN_20261113',
      固件下载地址:
        'https://next.cpinnov.run/PROD/RK/DEBIAN/APOLLO2/CP/LCD12/CP_APOLLO2_D_V1.10_LCD12_B1_CN_20261113',
    }),
    task('mix', 'CP_APOLLO2-MIX_A_V1.10_LCD7-12_B1_MDM_20260916', '生产库归档', {
      机型: ['RK / APOLLO2'],
      操作系统: ['Android'],
      客户ID: 'CP',
      固件版本: 'CP_APOLLO2-MIX_A_V1.10_LCD7-12_B1_MDM_20260916',
      固件下载地址:
        'https://next.cpinnov.run/PROD/RK/ANDROID/APOLLO2-MIX/CP/LCD7-12/CP_APOLLO2-MIX_A_V1.10_LCD7-12_B1_MDM_20260916',
    }),
    task('a7a', 'SMARTAG_APOLLO2-7A_D_V1.03_LCD7_B1_EU_20240528', '生产库归档', {
      机型: ['RK / APOLLO2-7A'],
      操作系统: ['Debian'],
      客户ID: 'SmartAG',
      固件版本: 'SMARTAG_APOLLO2-7A_D_V1.03_LCD7_B1_EU_20240528',
      固件下载地址:
        'https://next.cpinnov.run/PROD/RK/DEBIAN/APOLLO2-7A/SMARTAG/LCD7/SMARTAG_APOLLO2-7A_D_V1.03_LCD7_B1_EU_20240528',
    }),
    // 同族另一种写法：必须并进 APOLLO2-7A，而不是单开一个 1 任务的小族
    task('mcu7', 'APOLLO2_MCU_APP_V1.1.0_261020_145106', '生产库归档', {
      机型: ['瑞芯微 / APOLLO 7 二代', '瑞芯微 / APOLLO 7A 二代'],
      操作系统: ['Debian'],
      客户ID: 'CP',
      固件版本: 'APOLLO2_MCU_APP_V1.1.0_261020_145106',
      固件下载地址: 'https://next.cpinnov.run/PROD/MCU/APOLLO2/APOLLO2_MCU_APP_V1.1.0_261020_145106',
    }),
    // 跨芯片同名：RK / T3 各一个 SPRING2，严格匹配必须报歧义
    task('rk-sp', 'CP_SPRING2_A_V1.03_LCD7_B0_EU_20260930', '生产库归档', {
      机型: ['RK / SPRING2'],
      操作系统: ['Android'],
      客户ID: 'CP',
      固件版本: 'CP_SPRING2_A_V1.03_LCD7_B0_EU_20260930',
    }),
    task('t3-sp', 'CP_SPRING2_A_V1.01_LCD7_B0_EU_20260830', '生产库归档', {
      机型: ['T3 / SPRING2'],
      操作系统: ['Android'],
      客户ID: 'CP',
      固件版本: 'CP_SPRING2_A_V1.01_LCD7_B0_EU_20260830',
    }),
  ],
};

/* ---------------- lcd 工具 ---------------- */
{
  assert.equal(lcdOf({ fields: { 固件版本: 'CP_APOLLO2_D_V1.12_LCD7_B1_CN_20260805' } }), 'LCD7');
  assert.equal(lcdOf({ title: 'CP_APOLLO2-MIX_A_V1.10_LCD7-12_B0' }), 'LCD7-12');
  assert.equal(lcdOf({ fields: { 固件下载地址: 'https://x/PROD/RK/DEBIAN/APOLLO2/CP/LCD10/CP_X' } }), 'LCD10');
  assert.equal(lcdOf({ fields: { 固件版本: 'APOLLO2_MCU_APP_V1.1.0' } }), '');
  ok('lcdOf 从版本/标题/链接取尺寸');

  assert.equal(normalizeLcd('7'), 'LCD7');
  assert.equal(normalizeLcd('lcd 7-12'), 'LCD7-12');
  assert.equal(normalizeLcd('LCD12'), 'LCD12');
  assert.equal(normalizeLcd('ABC'), '');
  ok('normalizeLcd 接受 7 / lcd 7-12 / LCD12');

  assert.equal(lcdMatch('LCD7-12', 'LCD7'), true, 'LCD7 应命中 LCD7-12');
  assert.equal(lcdMatch('LCD7', 'LCD7-12'), false, 'LCD7-12 不能命中只有 LCD7 的行');
  assert.equal(lcdMatch('LCD10', 'LCD7'), false);
  assert.equal(lcdMatch('', 'LCD7'), false);
  assert.equal(lcdMatch('LCD10', ''), true, '没指定尺寸时不过滤');
  ok('lcdMatch 按数字子集匹配');
}

/* ---------------- buildCatalog 聚合 ---------------- */
const catalog = buildCatalog(board);
{
  const apollo = catalog.find((e) => e.model === 'RK / APOLLO2');
  assert.ok(apollo, '缺少 RK / APOLLO2');
  assert.deepEqual(
    apollo.lcds.map((x) => x.lcd),
    ['LCD7', 'LCD7-12', 'LCD12'],
    '尺寸要按数字升序',
  );
  assert.equal(apollo.lcds.find((x) => x.lcd === 'LCD7').tasks, 1);
  assert.ok(apollo.systems.includes('Debian'));
  assert.ok(apollo.systems.includes('Android'));
  assert.equal(apollo.lcds.find((x) => x.lcd === 'LCD12').latest.version, 'CP_APOLLO2_D_V1.10_LCD12_B1_CN_20261113');
  assert.ok(
    apollo.variants.some((v) => v.label === 'APOLLO2-MIX'),
    'APOLLO2-MIX 应作为变体出现',
  );
  ok('buildCatalog 聚合尺寸/系统/客户/最新版本与变体');

  const sevenA = catalog.find((e) => e.model === 'RK / APOLLO2-7A');
  assert.ok(sevenA, '缺少 RK / APOLLO2-7A');
  assert.ok(
    sevenA.aliases.some((a) => a.includes('7 二代')),
    '「瑞芯微 / APOLLO 7 二代」应并成同族写法，而不是单独一族',
  );
  assert.equal(
    catalog.filter((e) => /7\s*二代|7A\s*二代/.test(e.model)).length,
    0,
    '等价小族不应残留',
  );
  ok('buildCatalog 按等价 core 合并同族写法');

  assert.ok(
    catalog.every((e) => e.tasks > 0),
    '空族不应出现在目录里',
  );
  ok('buildCatalog 过滤空族');
}

/* ---------------- resolveExact：只认整串相等 ---------------- */
{
  const hit = (q) => {
    const r = resolveExact(catalog, q);
    return { status: r.status, models: r.matches.map((m) => `${m.entry.model}:${m.matchedBy}`) };
  };

  assert.deepEqual(hit('RK / APOLLO2'), { status: 'hit', models: ['RK / APOLLO2:exact-name'] });
  assert.deepEqual(hit('rk-apollo2'), { status: 'hit', models: ['RK / APOLLO2:exact-name'] });
  assert.deepEqual(hit('APOLLO2'), { status: 'hit', models: ['RK / APOLLO2:name-without-vendor'] });
  assert.deepEqual(hit('apollo2-mix'), { status: 'hit', models: ['RK / APOLLO2:variant'] });
  assert.deepEqual(hit('瑞芯微 / APOLLO 7A 二代'), {
    status: 'hit',
    models: ['RK / APOLLO2-7A:alias'],
  });
  assert.deepEqual(hit('SPRING2'), {
    status: 'ambiguous',
    models: ['RK / SPRING2:name-without-vendor', 'T3 / SPRING2:name-without-vendor'],
  });
  // 去尾 A 等价：APOLLO2-7 ≡ APOLLO2-7A（同一份固件）
  assert.deepEqual(hit('APOLLO2_7'), { status: 'hit', models: ['RK / APOLLO2-7A:equivalent-name'] });
  assert.deepEqual(hit('APOLLO2-7'), { status: 'hit', models: ['RK / APOLLO2-7A:equivalent-name'] });
  assert.deepEqual(hit('apollo 12 pro'), { status: 'miss', models: [] }, '自由写法不能自动猜');
  ok('resolveExact 只认规范名/别名/变体名，跨芯片同名报歧义');
}

/* ---------------- 共享固件规则：仅 7A↔7、12A↔12 ---------------- */
{
  const apollo = catalog.find((e) => e.model === 'RK / APOLLO2');
  const sevenA = catalog.find((e) => e.model === 'RK / APOLLO2-7A');
  assert.ok(apollo && sevenA);
  assert.deepEqual(
    firmwareSharingScope(catalog, sevenA, 'LCD7').map((e) => e.model).sort(),
    ['RK / APOLLO2', 'RK / APOLLO2-7A'],
    '7A 与 APOLLO2 的 7 寸共享固件',
  );
  assert.deepEqual(
    firmwareSharingScope(catalog, apollo, 'LCD7').map((e) => e.model).sort(),
    ['RK / APOLLO2', 'RK / APOLLO2-7A'],
    '反查同样成立',
  );
  // 12 寸共享：APOLLO2 与 12A 的等价写法
  const twelve = catalog.find((e) => e.core === 'apollo12gen2');
  if (twelve) {
    assert.ok(
      firmwareSharingScope(catalog, apollo, 'LCD12').some((e) => e.model === twelve.model),
      '12 寸共享要覆盖 12A 写法',
    );
  }
  assert.deepEqual(
    firmwareSharingScope(catalog, apollo, 'LCD10').map((e) => e.model),
    ['RK / APOLLO2'],
    '10 寸不参与共享（仅两组开放）',
  );
  assert.deepEqual(
    firmwareSharingScope(catalog, apollo, 'LCD12').some((e) => /12PRO/.test(e.model)),
    false,
    '12PRO 不能被带进共享范围',
  );
  ok('共享固件规则：仅 7A↔7、12A↔12 两组，10 寸与 12PRO 不参与');
}

/* ---------------- suggestMatches：只排序，不采用 ---------------- */
{
  const s = suggestMatches(catalog, 'APOLLO2_7', 8).map((x) => x.entry.model);
  assert.ok(s.includes('RK / APOLLO2'), '相近候选应包含 APOLLO2');
  assert.ok(s.includes('RK / APOLLO2-7A'), '相近候选应包含 APOLLO2-7A');
  assert.equal(s[0], 'RK / APOLLO2', '字母骨架相同的族应排最前（同分按任务量）');
  assert.equal(s[1], 'RK / APOLLO2-7A');
  assert.deepEqual(suggestMatches(catalog, 'ZZZZ9', 8), []);
  ok('suggestMatches 按相近度排序，未知写法返回空');
}

console.log('\n全部通过');
