import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveModel, canonCore } from '../../src/docs/lib/models.js';
import { cpDocsDir } from '../helpers/paths.mjs';

const dir = cpDocsDir() ?? path.resolve(import.meta.dirname, '../../src/docs/data');
const models = fs.existsSync(path.join(dir, 'models.json'))
  ? JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8')).models
  : [];

const hitName = (q) => resolveModel(q, models).hit?.model ?? null;

test('规范名与常见写法都能唯一命中', { skip: !models.length }, () => {
  assert.equal(hitName('SPRING2PRO'), 'SPRING 10 PRO 二代');
  assert.equal(hitName('SP2-10PRO'), 'SPRING 10 PRO 二代');
  assert.equal(hitName('RK / SPRING2-10PRO'), 'SPRING 10 PRO 二代');
  assert.equal(hitName('CP023-SPRING2 10PRO'), 'SPRING 10 PRO 二代');
  assert.equal(hitName('APOLLO2 12PRO'), 'APOLLO 12 PRO');
  assert.equal(hitName('APOLLO X'), 'APOLLO X');
  assert.equal(hitName('TANK2'), 'TANK 2');
  assert.equal(hitName('MEGA 1'), 'MEGA1');
  assert.equal(hitName('SPRING 10 PRO 二代 特别版'), 'SPRING 10 PRO 二代 特别版');
});

test('族名返回候选而不是硬猜', { skip: !models.length }, () => {
  const r = resolveModel('SPRING2', models);
  assert.equal(r.hit, null);
  assert.ok(r.scored.length >= 3);
  assert.ok(r.scored.every(([, g]) => g.model.startsWith('SPRING 10')));
});

test('canonCore 区分特别版/电台', () => {
  assert.notEqual(canonCore('SPRING 10 PRO 二代'), canonCore('SPRING 10 PRO 二代 特别版'));
  assert.notEqual(canonCore('SPRING 10'), canonCore('SPRING 10 电台'));
  assert.equal(canonCore('APOLLO 7 PRO'), 'apollo7pro');
});
