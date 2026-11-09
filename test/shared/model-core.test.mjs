import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nz,
  splitVendor,
  canonCore,
  canonModel,
  equivCore,
  queryCores,
  gapScore,
  scoreCore,
  CP_DOC_TOKENS,
} from '../../src/shared/model-core.js';

test('nz：去符号 + 小写', () => {
  assert.equal(nz('SP2-10 PRO'), 'sp210pro');
  assert.equal(nz('RK / APOLLO2-12PRO'), 'rk apollo212pro'.replace(/\s/g, ''));
  assert.equal(nz(null), '');
});

test('splitVendor：只认已知厂商，不把型号当前缀', () => {
  assert.deepEqual(splitVendor('RK / SPRING2-10PRO'), { vendor: 'rk', rest: 'SPRING2-10PRO' });
  assert.deepEqual(splitVendor('T3-X'), { vendor: 't3', rest: 'X' });
  assert.deepEqual(splitVendor('APOLLO 12 PRO'), { vendor: '', rest: 'APOLLO 12 PRO' });
  assert.deepEqual(splitVendor('SPRING2 10'), { vendor: '', rest: 'SPRING2 10' });
});

test('canonCore：二代/apollo2 折叠；cp-docs 额外区分特别版/电台', () => {
  assert.equal(canonCore('SPRING 10 PRO 二代'), 'spring10progen2');
  assert.equal(canonCore('APOLLO2 12PRO'), 'apollo12pro');
  assert.equal(canonCore('SPRING 10 PRO 二代 特别版'), canonCore('SPRING 10 PRO 二代'));
  assert.notEqual(canonCore('SPRING 10 PRO 二代 特别版', CP_DOC_TOKENS), canonCore('SPRING 10 PRO 二代'));
  assert.notEqual(canonCore('SPRING 10 电台', CP_DOC_TOKENS), canonCore('SPRING 10', CP_DOC_TOKENS));
});

test('canonModel：厂商 + core', () => {
  assert.deepEqual(canonModel('RK / APOLLO2-12PRO'), { vendor: 'rk', core: 'apollo12pro' });
});

test('equivCore：只折叠 gen2 与尾部 A，不吞 12PRO/12PLUS/MIX', () => {
  assert.equal(equivCore('apollo7gen2'), 'apollo7');
  assert.equal(equivCore('apollo7agen2'), 'apollo7');
  assert.equal(equivCore('apollo7a'), 'apollo7');
  assert.equal(equivCore('apollo12a'), 'apollo12');
  assert.equal(equivCore('apollo12pro'), 'apollo12pro');
  assert.equal(equivCore('apollo12plus'), 'apollo12plus');
  assert.equal(equivCore('apollo2mix'), 'apollo2mix');
});

test('queryCores：SP2/SPRING2、APOLLO/APOLLO2 双向展开', () => {
  assert.deepEqual(new Set(queryCores('sp210pro')), new Set(['sp210pro', 'spring210pro']));
  assert.deepEqual(new Set(queryCores('apollo12')), new Set(['apollo12', 'apollo212']));
});

test('gapScore：省略尺寸段命中，数字结尾不误判', () => {
  assert.equal(gapScore('spring2pro', 'spring210pro'), 85);
  assert.equal(gapScore('apollo10', 'apollo10pro'), 0);
  assert.equal(gapScore('spring2pro', 'spring10pro'), 85);
});

test('scoreCore：接受 core 字符串和 {core} 分组', () => {
  assert.equal(scoreCore('apollo12', 'apollo12'), 100);
  assert.equal(scoreCore('apollo12', { core: 'apollo12' }), 100);
  assert.equal(scoreCore('apollo12', 'apollo12pro'), 70);
  assert.equal(scoreCore('spring2pro', 'spring210pro'), 85);
});
