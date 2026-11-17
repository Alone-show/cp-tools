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
  // 契约是 renderPacket 的软上限 maxChars=40000（超出后降到 lean 版，再超才截断）；
  // 1.23 目前约 25KB，仍远低于上限，不应过早截断资料。
  assert.ok(packet.length < 40000, `packet=${packet.length}`);
  assert.doesNotMatch(packet, /报文超长，已截断/);
});

test('整包带图片摘要（只列标题，不塞路径）', { skip: !has }, () => {
  const images = [
    { caption: '图4.1.1 26P线束外观图', section: '4.1 TANK2线束定义' },
    { caption: '图4.1.2 26P接线图', section: '4.1 TANK2线束定义' },
  ];
  const text = renderPacket({
    entry,
    spec: read(entry.spec),
    programming: read(entry.programming),
    workpoints: read(entry.workpoints),
    labels,
    images,
  });
  assert.match(text, /## 图片（2 张，可按需发送）/);
  assert.match(text, /- 图4\.1\.2 26P接线图（4\.1 TANK2线束定义）/);
  assert.match(text, /调用 cp_docs_images/);
  assert.doesNotMatch(text, /\/images\/store\//);
});

test('图片数量超过上限时折叠成「另有 N 张」', { skip: !has }, () => {
  const images = Array.from({ length: 10 }, (_, i) => ({ caption: `图${i + 1}.1 示例${i + 1}`, section: '9 附图' }));
  const text = renderPacket({
    entry,
    spec: read(entry.spec),
    programming: null,
    workpoints: null,
    labels,
    images,
  });
  assert.match(text, /## 图片（10 张，可按需发送）/);
  assert.match(text, /- …另有 4 张/);
});

test('没有图片索引时不出现图片段', { skip: !has }, () => {
  assert.doesNotMatch(packet, /## 图片（/);
});
