import test from 'node:test';
import assert from 'node:assert/strict';
import * as docs from '../../src/docs/index.js';
import * as firmware from '../../src/firmware/index.js';
import * as cpservice from '../../src/cpservice/index.js';
import * as flash from '../../src/flash/index.js';

test('四个子插件都导出 Cordis 契约', () => {
  for (const [label, mod] of [['docs', docs], ['firmware', firmware], ['cpservice', cpservice], ['flash', flash]]) {
    assert.equal(typeof mod.name, 'string', `${label}.name`);
    assert.ok(mod.name.length > 0, `${label}.name 非空`);
    assert.ok(Array.isArray(mod.inject), `${label}.inject 是数组`);
    assert.equal(typeof mod.apply, 'function', `${label}.apply`);
  }
});

test('插件名唯一，且沿用旧 id', () => {
  assert.deepEqual(
    [docs.name, firmware.name, cpservice.name, flash.name].sort(),
    ['cp-docs', 'cp-flash', 'e9631service', 'firmware-finder'],
  );
});

test('依赖服务声明符合子插件职责', () => {
  assert.deepEqual(docs.inject, ['commands']);
  assert.deepEqual(firmware.inject, ['tools', 'skills']);
  assert.deepEqual(cpservice.inject, ['skills']);
  assert.deepEqual(flash.inject, ['skills']);
});
