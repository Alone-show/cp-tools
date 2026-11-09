/**
 * 每次查询都实时刷新：
 * - 索引快照过期时，TB 实时探测 / alist /PROD 的新归档必须能顶到第一行；
 * - 版本只写在标题里的任务，--version 也能命中；
 * - 实时失败 / 关闭探测时明确降级，不静默说谎。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __internals } from '../../src/firmware/index.js';

const { search, setVersionProbe, setAlistFactory } = __internals;

const PROJECT_ID = '65a8da81950780b816d12bd9';
const V109 = 'CP_TANK2_D_V1.09_LCD7-10_B0_CN_20260828';
const V110 = 'CP_TANK2_D_V1.10_LCD7-10_B0_CN_20261105';
const V111 = 'CP_TANK2_D_V1.11_LCD7-10_B0_CN_20261110';
const TB_V110 = 'https://www.teambition.com/task/6ae0977e7855128ab5a57665';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'firmware-fresh-'));
const task = (id, title, stage, fields, updated = '2026-10-01T00:00:00.000Z') => ({
  id,
  title,
  url: `https://www.teambition.com/task/${id}`,
  stage,
  updated,
  isArchived: false,
  fields,
});
const linkOf = (version) => ({
  '固件下载地址': `https://next.cpinnov.run/PROD/RK/DEBIAN/TANK2/CP/LCD7-10/${version}`,
  'OSS 线刷地址': `https://minio.cpuniverse.cn/prod/RK/DEBIAN/TANK2/CP/LCD7-10/${version}/${version}.img`,
  'OSS OTA地址': `https://minio.cpuniverse.cn/prod/RK/DEBIAN/TANK2/CP/LCD7-10/${version}/${version}_OTA.img`,
});

const board = {
  projectId: PROJECT_ID,
  // 归档发生在 11-05，快照停在 11-04：这就是线上「刚刚归档查不到」的场景
  syncedAt: '2026-11-04T06:28:16.942Z',
  items: [
    task('t109', V109, '生产库归档', {
      机型: ['RK / TANK2'],
      操作系统: ['Debian'],
      客户ID: ['CP'],
      固件语言: ['EU'],
      固件版本: V109,
      ...linkOf(V109),
    }),
    // 版本只写在标题里、字段为空的迭代任务
    task('t110x', '【版本迭代】CP_TANK2_D_V1.12_LCD7-10', '测试中', {
      机型: ['RK / TANK2'],
      操作系统: ['Debian'],
      客户ID: ['CP'],
      固件下载地址: `https://next.cpinnov.run/TEST/RK/DEBIAN/TANK2/CP/LCD7-10/${V111}_TEST`,
    }),
  ],
};
fs.writeFileSync(path.join(dir, `board-${PROJECT_ID}.json`), JSON.stringify(board));
process.env.DSH_TBFW_DIR = dir;
delete process.env.DSH_ALIST_DISABLE;

const row = (version, stage, extra = {}) => ({
  version,
  buildDate: stage === '生产库归档' ? '20261105' : '20261110',
  models: 'RK / TANK2',
  system: 'Debian',
  customer: 'CP',
  language: 'EU',
  stage,
  updated: '2026-11-05',
  links: linkOf(version),
  task: TB_V110,
  source: 'tb-live',
  ...extra,
});

test.after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  delete process.env.DSH_ALIST_DISABLE;
  setVersionProbe(null);
  setAlistFactory(null);
});

test('过期快照 + TB 实时探测：新归档顶到第一行', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  let calls = 0;
  setVersionProbe(async () => {
    calls += 1;
    return [row(V110, '生产库归档')];
  });

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 1 });

  assert.equal(calls, 1, '每次查询都应实时探测 TB');
  assert.equal(result.liveChecked, true);
  assert.equal(result.rows[0].version, V110);
  assert.equal(result.rows[0].task, TB_V110);
  assert.equal(result.rows[0].stage, '生产库归档');
  assert.ok(result.indexAgeHours > 24, '快照年龄应如实返回');
  assert.match(result.note ?? '', /实时核对 Teambition/);
  assert.ok(result.total >= 2, '命中数应包含快照与实时结果');
});

test('实时探测带出未归档构建时进 pending，不冒充最新归档', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  setVersionProbe(async () => [row(V110, '生产库归档'), row(V111, '测试中', { task: 'https://www.teambition.com/task/new' })]);

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 5 });

  assert.equal(result.rows[0].version, V110);
  assert.ok(!result.rows.some((r) => r.version === V111), '未归档版本不能进结果行');
  assert.equal(result.pending[0].version, V111);
  assert.equal(result.pending[0].task, 'https://www.teambition.com/task/new');
});

test('版本只写在标题里时 --version 仍能命中', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  setVersionProbe(async () => []);

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', version: 'V1.12', all: true });

  assert.equal(result.status, 'ok');
  assert.ok(result.rows.some((r) => r.version.includes('V1.12')), '标题里的版本号应参与过滤');
});

test('实时探测失败时明确说明来自旧快照', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  setVersionProbe(async () => {
    throw new Error('登录态失效');
  });

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 1 });

  assert.equal(result.liveChecked, false);
  assert.match(result.note ?? '', /实时核对失败/);
  assert.match(result.note ?? '', /快照/);
  assert.equal(result.rows[0].version, V109);
});

test('DSH_FIRMWARE_NO_PROBE=1 时不发实时请求', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  process.env.DSH_FIRMWARE_NO_PROBE = '1';
  let calls = 0;
  setVersionProbe(async () => {
    calls += 1;
    return [];
  });

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 1 });

  assert.equal(calls, 0);
  assert.equal(result.liveChecked, false);
  assert.match(result.note ?? '', /关闭实时核对/);
  delete process.env.DSH_FIRMWARE_NO_PROBE;
});

test('alist /PROD 的新归档在 TB 未更新时也能顶到第一行', async () => {
  process.env.DSH_FIRMWARE_NO_PROBE = '1';
  delete process.env.DSH_ALIST_DISABLE;
  const base = '/PROD/RK/DEBIAN/TANK2/CP/LCD7-10';
  const TREE = {
    '/PROD': [{ name: 'RK', isDir: true }],
    '/PROD/RK': [{ name: 'DEBIAN', isDir: true }],
    '/PROD/RK/DEBIAN': [{ name: 'TANK2', isDir: true }],
    '/PROD/RK/DEBIAN/TANK2': [{ name: 'CP', isDir: true }],
    '/PROD/RK/DEBIAN/TANK2/CP': [{ name: 'LCD7-10', isDir: true }],
    [base]: [{ name: V110, isDir: true, modified: '2026-11-05T00:00:00.000Z' }],
  };
  const ENTRY = {
    [`${base}/${V110}.img`]: { name: `${V110}.img`, size: 3_200_000_000, rawUrl: `https://alist.example/p/${V110}.img` },
    [`${base}/${V110}_OTA.img`]: {
      name: `${V110}_OTA.img`,
      size: 3_200_000_000,
      rawUrl: `https://alist.example/p/${V110}_OTA.img`,
    },
  };
  const fake = {
    stats: { requests: 0, cacheHits: 0 },
    pageUrl: (p) => `https://alist.example${p}`,
    async list(p) {
      fake.stats.requests += 1;
      return TREE[p] ?? null;
    },
    async entry(p) {
      fake.stats.requests += 1;
      return ENTRY[p] ?? null;
    },
    async text() {
      return '';
    },
  };
  setAlistFactory(() => fake);

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 1 });

  assert.equal(result.rows[0].version, V110, 'alist 上已归档的构建应排第一');
  assert.equal(result.rows[0].source, 'alist');
  assert.equal(result.rows.length, 1, 'limit 只回一条');
  delete process.env.DSH_FIRMWARE_NO_PROBE;
});

// 20261109：未点名 DEV 时只给量产（不带 DEV 标识的）固件
test('默认过滤 DEV 构建，并在 note 里交代隐藏了几条', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  const DEV = 'CP_TANK2_D_DEV-DE9E2564_LCD7-10_B0_EU_20261103';
  setVersionProbe(async () => [row(V110, '生产库归档'), row(DEV, '生产库归档', { task: 'https://www.teambition.com/task/dev' })]);

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 5 });

  assert.ok(result.rows.every((r) => !/DEV[-_]/i.test(r.version)), `结果里不应有 DEV 构建：${result.rows.map((r) => r.version)}`);
  assert.equal(result.rows[0].version, V110);
  assert.match(result.note ?? '', /已隐藏 1 条 DEV 构建/);
  assert.match(result.note ?? '', /dev:true/);
});

test('显式 dev:true 时才返回 DEV 构建', async () => {
  process.env.DSH_ALIST_DISABLE = '1';
  delete process.env.DSH_FIRMWARE_NO_PROBE;
  const DEV = 'CP_TANK2_D_DEV-DE9E2564_LCD7-10_B0_EU_20261103';
  setVersionProbe(async () => [row(V110, '生产库归档'), row(DEV, '生产库归档', { task: 'https://www.teambition.com/task/dev' })]);

  const result = await search({}, {}, { model: 'tank2', system: 'Debian', limit: 5, dev: true });

  assert.ok(result.rows.some((r) => r.version === DEV), 'dev:true 时 DEV 构建应可见');
  assert.doesNotMatch(result.note ?? '', /已隐藏 .* DEV 构建/);
});
