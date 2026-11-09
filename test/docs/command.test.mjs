import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { apply } from '../../src/docs/index.js';
import { cpDocsDir } from '../helpers/paths.mjs';

const dataDir = cpDocsDir() ?? path.resolve(import.meta.dirname, '../../src/docs/data');
const has = fs.existsSync(path.join(dataDir, 'models.json'));
if (has) process.env.DSH_CPDOCS_DIR = dataDir;

function harness() {
  const registered = [];
  const messages = [];
  const ctx = { commands: { register: (d) => registered.push(d) }, get: () => undefined };
  apply(ctx);
  const def = registered.find((d) => d.name === 'cp-docs');
  const agent = { followup: (m) => messages.push(m) };
  const run = (rawInput) => def.handler({ commandId: 'c1', agent, rawInput, attachments: [], signal: new AbortController().signal });
  return { def, run, messages };
}

test('命令已注册且带说明', () => {
  const { def } = harness();
  assert.ok(def);
  assert.equal(typeof def.handler, 'function');
  assert.match(def.description, /机型/);
});

test('SPRING2PRO 屏幕尺寸 → 整包资料交给模型', { skip: !has }, async () => {
  const h = harness();
  const res = await h.run(' SPRING2PRO 的屏幕尺寸是多少');
  assert.equal(res.kind, 'success');
  assert.match(res.text, /已命中 1\.23 SPRING 10 PRO 二代：全量资料/);
  assert.equal(h.messages.length, 1);
  const text = h.messages[0].content[0].text;
  assert.match(text, /- 屏幕尺寸：10\.1/);
  assert.match(text, /- 分辨率：1024\*600/);
  assert.match(text, /资料中未收录/);
});

test('注入消息是上下文卡片而非用户气泡', { skip: !has }, async () => {
  const h = harness();
  await h.run(' SPRING2PRO 的RS232的引脚在哪个位置');
  const msg = h.messages[0];
  assert.equal(msg.role, 'user'); // 模型可见角色保持 user
  assert.notEqual(msg.source.kind, 'user'); // 但来源不是人类 → 客户端渲染为折叠卡片
  assert.equal(msg.source.kind, 'cp-docs');
  assert.equal(msg.source.form, 'notice');
  assert.equal(msg.source.summary, '1.23 SPRING 10 PRO 二代 · 6 张表 / 33 项参数 / 10 张图内文字 / 1 页编程节点 / 2 组工作点');
});

test('RS232 引脚问题 → 整包里能读到 26PIN 定义', { skip: !has }, async () => {
  const h = harness();
  const res = await h.run(' SPRING2PRO 的RS232的引脚在哪个位置');
  assert.equal(res.kind, 'success');
  assert.match(res.text, /全量资料/);
  assert.equal(h.messages.length, 1);
  const text = h.messages[0].content[0].text;
  assert.match(text, /\| 14 \| RS232_A_TX/);
  assert.match(text, /\| 20 \| RS232_A_RX/);
  assert.match(text, /\| 17 \| RS232_B_RX/);
  assert.match(text, /\| 24 \| RS232_B_TX/);
});

test('族名 → 列候选、不触发模型', { skip: !has }, async () => {
  const h = harness();
  const res = await h.run(' SPRING2 屏幕尺寸');
  assert.equal(res.kind, 'success');
  assert.match(res.text, /不唯一/);
  assert.equal(h.messages.length, 0);
});

test('CP023 跨两个机型（资料不同）→ 列候选、不触发模型', { skip: !has }, async () => {
  const h = harness();
  const res = await h.run(' CP023 的 INPUT1 接到哪个 GPIO');
  assert.equal(res.kind, 'success');
  assert.match(res.text, /不唯一/);
  assert.match(res.text, /1\.23 SPRING 10 PRO 二代/);
  assert.match(res.text, /1\.25 SPRING 10 PLUS 二代/);
  assert.equal(h.messages.length, 0);
});

test('目录问题 → 机型清单交给模型', { skip: !has }, async () => {
  const h = harness();
  const res = await h.run(' 支持哪些机型');
  assert.equal(res.kind, 'success');
  assert.equal(h.messages.length, 1);
  assert.match(h.messages[0].content[0].text, /SPRING 10 PRO 二代/);
});
