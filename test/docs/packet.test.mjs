import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderPacket, buildPacketMessage } from '../../src/docs/lib/packet.js';
import { cpDocsDir } from '../helpers/paths.mjs';

const dir = cpDocsDir() ?? path.resolve(import.meta.dirname, '../../src/docs/data');
const has = fs.existsSync(path.join(dir, 'models.json'));
const read = (rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));

const models = has ? read('models.json').models : [];
const entry = models.find((m) => m.id === '1.23');
const labels = has
  ? Object.fromEntries(read('fields.json').fields.map((f) => [f.key, { label: f.label, unit: f.unit || '' }]))
  : {};
const packet = has
  ? renderPacket({
      entry,
      spec: read(entry.spec),
      programming: read(entry.programming),
      workpoints: read(entry.workpoints),
      labels,
    })
  : '';

test('整包包含全部表格，26PIN 表四个 RS232 引脚都在', { skip: !has }, () => {
  assert.match(packet, /## 表格（6 张）/);
  assert.match(packet, /26PIN连接器接口定义表/);
  assert.match(packet, /\| 14 \| RS232_A_TX/);
  assert.match(packet, /\| 20 \| RS232_A_RX/);
  assert.match(packet, /\| 17 \| RS232_B_RX/);
  assert.match(packet, /\| 24 \| RS232_B_TX/);
});

test('参数用中文标签，且不做条数截断', { skip: !has }, () => {
  assert.match(packet, /- RS232：RS232\*2/);
  assert.match(packet, /- 屏幕尺寸：10\.1/);
  assert.match(packet, /- 工作温度：-30℃~\+70℃/);
});

test('含编程节点与硬件工作点', { skip: !has }, () => {
  assert.match(packet, /## 编程节点/);
  assert.match(packet, /\/dev\/ttyWK1/);
  assert.match(packet, /## 硬件工作点/);
  assert.match(packet, /- INPUT1 → \[MCU\] PC0/);
});

test('含未转写图片与数据提示', { skip: !has }, () => {
  assert.match(packet, /## 未转写的图片/);
  assert.match(packet, /## 数据提示/);
  assert.match(packet, /1\.24 SPRING 10 PRO 二代/);
});

test('报文头带问题与作答约束', { skip: !has }, () => {
  const text = buildPacketMessage({ question: 'SPRING2PRO 的RS232的引脚在哪个位置', entry, packet });
  assert.match(text, /【cp-docs 机型资料 · 请只依据以下资料回答】/);
  assert.match(text, /用户问题：SPRING2PRO 的RS232的引脚在哪个位置/);
  assert.match(text, /资料中未收录/);
});

test('单机型报文体积可控', { skip: !has }, () => {
  assert.ok(packet.length < 20000, `packet=${packet.length}`);
});
