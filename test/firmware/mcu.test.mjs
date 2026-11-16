/**
 * /firmware 的 MCU 检索：纯函数用例（不联网）。
 *
 * 现场依据：SPRING2-10PRO 的 MCU 目录叫 SPRING2-PRO（TB #8505 标题即「SPRING2-10PRO_MCU_APP_V1.0.7」），
 * 而 SPRING2 10 / 10S 走 SPRING2；APOLLO2 三个变体（PRO/PLUS）各自独立。这里锁住这套映射。
 */
import assert from 'node:assert/strict';
import {
  parseModelName,
  scoreMcuDir,
  rankMcuDirs,
  parseMcuName,
  versionsFromDirEntries,
  mcuRowsFromTasks,
} from '../../src/firmware/mcu.js';

const MCU_DIRS = [
  'APOLLO2-PLUS',
  'MEGA1',
  'APOLLO2-PRO',
  'TANK2',
  'APOLLO2',
  'SPRING2-PRO',
  'TANK',
  'APOLLO-PRO',
  'SPRING2',
  'SPRING-12',
  'SPRING',
  'APOLLO',
  'V1200',
];

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}\n  ${error.message}`);
  }
}

test('机型写法归一：SP2-10PRO / SPRING2-10PRO 都进 SPRING2 族且带 PRO', () => {
  for (const raw of ['SP2-10PRO', 'SPRING2-10PRO', 'spring2 10 pro', 'RK / SPRING2-10PRO']) {
    const m = parseModelName(raw);
    assert.equal(m.family, 'SPRING2', `${raw} 族名`);
    assert.equal(m.pro, true, `${raw} 应识别 PRO`);
    assert.deepEqual(m.sizes, [10], `${raw} 尺寸`);
  }
});

test('机型写法归一：连写变体（APOLLO2PLUS / SPRING2PRO）能拆出族与变体', () => {
  assert.deepEqual([parseModelName('APOLLO2PLUS').family, parseModelName('APOLLO2PLUS').plus], ['APOLLO2', true]);
  assert.equal(parseModelName('SPRING2PRO').pro, true);
  assert.equal(parseModelName('SPRING2PRO').family, 'SPRING2');
});

test('SPRING2-10PRO 命中 SPRING2-PRO，而不是 SPRING2', () => {
  const ranked = rankMcuDirs('SP2-10PRO', MCU_DIRS);
  assert.equal(ranked[0].dir, 'SPRING2-PRO');
  const spring2 = ranked.find((row) => row.dir === 'SPRING2');
  assert.ok(ranked[0].score - spring2.score >= 20, '与 SPRING2 必须拉开差距');
});

test('SPRING2 10（非 PRO）命中 SPRING2，而不是 SPRING2-PRO', () => {
  const ranked = rankMcuDirs('SPRING2 10', MCU_DIRS);
  assert.equal(ranked[0].dir, 'SPRING2');
});

test('SPRING-12 不会被 SPRING2 抢走', () => {
  const ranked = rankMcuDirs('SPRING-12', MCU_DIRS);
  assert.equal(ranked[0].dir, 'SPRING-12');
});

test('APOLLO2 三变体互不混淆', () => {
  assert.equal(rankMcuDirs('APOLLO2 12X', MCU_DIRS)[0].dir, 'APOLLO2');
  assert.equal(rankMcuDirs('APOLLO2 12 PRO', MCU_DIRS)[0].dir, 'APOLLO2-PRO');
  assert.equal(rankMcuDirs('APOLLO2PLUS', MCU_DIRS)[0].dir, 'APOLLO2-PLUS');
});

test('认不出的机型不硬猜（没有族匹配就不返回）', () => {
  assert.deepEqual(rankMcuDirs('XYZ-99', MCU_DIRS), []);
  assert.equal(scoreMcuDir('SPRING2-10PRO', 'TANK2'), 0);
});

test('版本名解析：构建日期与排序键', () => {
  const row = parseMcuName('SPRING2PRO_MCU_APP_V1.0.7_260924_190041');
  assert.equal(row.version, 'V1.0.7');
  assert.equal(row.buildDate, '2026-09-24');
  assert.equal(row.family, 'SPRING2PRO');
  assert.equal(row.kind, 'APP');
  assert.equal(parseMcuName('乱码'), null);
  assert.equal(parseMcuName('SPRING2PRO_MCU_BOOT_V1.0.5_230104_150811').kind, 'BOOT');
});

test('目录项 -> 版本行：只留指定 kind，按构建日期倒序，尊重 limit', () => {
  const entries = [
    { name: 'SPRING2PRO_MCU_APP_V1.0.1_230105_142831', isDir: true },
    { name: 'SPRING2PRO_MCU_APP_V1.0.7_260924_190041', isDir: true },
    { name: 'SPRING2PRO_MCU_APP_V1.0.6_260116_190656', isDir: true },
    { name: 'SPRING2PRO_MCU_BOOT_V1.0.5_230104_150811', isDir: true },
    { name: 'README.md', isDir: false },
  ];
  const rows = versionsFromDirEntries(entries, { kind: 'APP', limit: 3 });
  assert.deepEqual(
    rows.map((row) => row.version),
    ['V1.0.7', 'V1.0.6', 'V1.0.1'],
  );
  assert.equal(rows[0].buildDate, '2026-09-24');
});

test('TB 任务 -> MCU 行：取「固件版本」里的完整版本串并带阶段', () => {
  const tasks = [
    {
      title: '【版本迭代】SPRING2PRO_MCU_APP_V1.0.7',
      stage: '生产库归档',
      accomplished: '2026-10-10T02:03:04.000Z',
      url: 'https://www.teambition.com/task/x',
      fields: {
        固件版本: ['SPRING2PRO_MCU_APP_V1.0.7_260924_190041'],
        机型: ['RK / SPRING2-10PRO'],
        固件下载地址: ['https://next.cpinnov.run/PROD/MCU/SPRING2-PRO/SPRING2PRO_MCU_APP_V1.0.7_260924_190041'],
      },
    },
    { title: '【版本迭代】SPRING2PRO_MCU_APP_V1.0.6', stage: '生产库归档', fields: { 固件版本: [] } },
  ];
  const rows = mcuRowsFromTasks(tasks);
  assert.equal(rows.length, 2, '完整版本串与短版本串都要收（短串只能靠版本号匹配）');
  const dated = rows.find((row) => row.name.includes('_260924_'));
  const short = rows.find((row) => !row.name.includes('_260924_'));
  assert.equal(short.buildDate, '', '短版本串没有构建日期');
  assert.equal(dated.name, 'SPRING2PRO_MCU_APP_V1.0.7_260924_190041');
  rows.splice(0, rows.length, dated, short);
  assert.equal(rows[0].name, 'SPRING2PRO_MCU_APP_V1.0.7_260924_190041');
  assert.equal(rows[0].stage, '生产库归档');
  assert.equal(rows[0].doneDate, '2026-10-10');
  assert.equal(rows[0].model, 'RK / SPRING2-10PRO');
  assert.match(rows[0].downloadUrl, /\/PROD\/MCU\/SPRING2-PRO\//);
});

console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
