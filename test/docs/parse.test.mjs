import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseQuery } from '../../src/docs/lib/parse.js';
import { cpDocsDir } from '../helpers/paths.mjs';

const dir = cpDocsDir() ?? path.resolve(import.meta.dirname, '../../src/docs/data');
const models = fs.existsSync(path.join(dir, 'models.json'))
  ? JSON.parse(fs.readFileSync(path.join(dir, 'models.json'), 'utf8')).models
  : [];

test('从整句里切机型与问题', { skip: !models.length }, () => {
  const a = parseQuery('SPRING2PRO 的屏幕尺寸是多少', models);
  assert.equal(a.intent, 'query');
  assert.equal(a.hit.model, 'SPRING 10 PRO 二代');
  assert.match(a.question, /屏幕尺寸/);

  const b = parseQuery('帮我查一下 spring2-10pro 屏幕多大', models);
  assert.equal(b.intent, 'query');
  assert.equal(b.hit.model, 'SPRING 10 PRO 二代');

  const c = parseQuery('APOLLO 10 PRO 电台 的电源', models);
  assert.equal(c.intent, 'query');
  assert.equal(c.hit.model, 'APOLLO 10 PRO 电台');
});

test('族名走歧义分支', { skip: !models.length }, () => {
  const r = parseQuery('SPRING2 屏幕尺寸', models);
  assert.equal(r.intent, 'ambiguous');
  assert.ok(r.candidates.length >= 2);
});

test('目录/维护/帮助意图', { skip: !models.length }, () => {
  assert.equal(parseQuery('支持哪些机型', models).intent, 'catalog');
  assert.equal(parseQuery('更新资料快照', models).intent, 'sync');
  assert.equal(parseQuery('你好', models).intent, 'help');
});
