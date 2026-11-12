import test from 'node:test';
import assert from 'node:assert/strict';
import * as docs from '../../src/docs/index.js';
import * as firmware from '../../src/firmware/index.js';
import * as tickets from '../../src/tickets/index.js';
import * as cpservice from '../../src/cpservice/index.js';
import * as flash from '../../src/flash/index.js';
import * as bpms from '../../src/bpms/index.js';
import * as root from '../../src/root.js';

test('六个插件行都导出 Cordis 契约', () => {
  for (const [label, mod] of [['docs', docs], ['firmware', firmware], ['tickets', tickets], ['cpservice', cpservice], ['flash', flash], ['bpms', bpms], ['root', root]]) {
    assert.equal(typeof mod.name, 'string', `${label}.name`);
    assert.ok(mod.name.length > 0, `${label}.name 非空`);
    assert.ok(Array.isArray(mod.inject), `${label}.inject 是数组`);
    assert.equal(typeof mod.apply, 'function', `${label}.apply`);
  }
});

test('插件名唯一，且沿用旧 id', () => {
  assert.deepEqual(
    [docs.name, firmware.name, tickets.name, cpservice.name, flash.name, bpms.name, root.name].sort(),
    ['cp-bpms', 'cp-docs', 'cp-flash', 'cp-tickets', 'cp-tools-web', 'e9631service', 'firmware-finder'],
  );
});

test('依赖服务声明符合子插件职责', () => {
  assert.deepEqual(docs.inject, ['commands']);
  assert.deepEqual(firmware.inject, ['tools', 'skills']);
  assert.deepEqual(tickets.inject, ['tools', 'skills']);
  assert.deepEqual(cpservice.inject, ['skills']);
  assert.deepEqual(flash.inject, ['skills']);
  assert.deepEqual(bpms.inject, ['tools', 'skills']);
  assert.deepEqual(root.inject, []);
});
