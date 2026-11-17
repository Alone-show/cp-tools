import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildImageIndex,
  renderImageIndexMarkdown,
  searchImages,
  suggestName,
  locateImage,
  resolveImageRoot,
} from '../../src/docs/lib/image-index.js';
import { purposeFor, mergeOverride } from '../../src/docs/lib/image-purpose.js';

// 1x1 PNG，足够让 existsSync/readdir 跑通
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    + '0000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082',
  'hex',
);

const SHA_PARAM = `aa11bb22${'0'.repeat(56)}`; // 参数表（spec.table）
const SHA_HARNESS = `cc33dd44${'0'.repeat(56)}`; // 线束外观图（spec.skipped）
const SHA_MISSING = `ee55ff66${'0'.repeat(56)}`; // 清单里有、磁盘上没有

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpdoc-img-'));
  const src = path.join(root, 'ai-readable');
  const store = path.join(src, 'images', 'store');
  const dir = path.join(src, 'images', '1.1-TEST-1');
  fs.mkdirSync(store, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(store, `${SHA_PARAM}.png`), PNG);
  fs.writeFileSync(path.join(store, `${SHA_HARNESS}.png`), PNG);
  fs.writeFileSync(path.join(dir, `00-${SHA_PARAM.slice(0, 8)}-参数表.png`), PNG);

  const spec = {
    no: '1.1',
    model: 'TEST 1',
    family: 'TEST',
    doc_url: 'https://example.test/doc',
    tables: [
      {
        sha256: SHA_PARAM,
        file: `images/store/${SHA_PARAM}.png`,
        section: '3.1 产品参数',
        caption: '图3.1 配置信息',
        kind: 'param',
      },
    ],
    figures: [],
    skipped: [
      {
        sha256: SHA_HARNESS,
        file: `images/store/${SHA_HARNESS}.png`,
        src: 'https://example.test/tank/线束.png',
        reason: '线束外观图｜图4.1.1 线束外观图：非表格/无图内文字，见原图',
      },
    ],
  };

  const rec = (idx, sha, caption, category, heading = '') => ({
    no: '1.1',
    model: 'TEST 1',
    idx,
    src: `https://example.test/p${idx}.png`,
    heading,
    caption,
    sha256: sha,
    file: `images/store/${sha}.png`,
    width: 100,
    height: 80,
    bytes: 10,
    category,
  });

  const manifest = {
    models: [{ no: '1.1', name: 'TEST 1', page: 'https://example.test/page' }],
    records: [
      rec(0, SHA_PARAM, '图3.1 配置信息', '参数表', '3.1 产品参数'),
      rec(1, SHA_HARNESS, '图4.1.1 线束外观图', '线束外观图', '4.1 线束定义'),
      rec(2, SHA_MISSING, '图9.9 不存在的图', '其他图表', '9 附录'),
    ],
  };

  return { root, src, spec, manifest };
}

test('索引合并 manifest + spec：线束外观图不再丢，缺文件被标出', () => {
  const { src, spec, manifest } = fixture();
  const index = buildImageIndex({ manifest, specs: [{ file: '1.1.json', data: spec }], srcRoot: src });

  assert.equal(index.hasManifest, true);
  assert.equal(index.total, 3);
  assert.equal(index.missing, 1);

  const images = index.byModel['1.1'].images;
  assert.equal(images.length, 3);

  const param = images.find((i) => i.sha256 === SHA_PARAM);
  assert.equal(param.caption, '图3.1 配置信息');
  assert.equal(param.kind, 'param');
  assert.match(param.purpose, /整机参数/);
  assert.ok(param.namedFile.includes('00-aa11bb22-参数表.png'));
  assert.equal(param.missing, false);

  const harness = images.find((i) => i.sha256 === SHA_HARNESS);
  assert.match(harness.purpose, /线束走向与外观示意/);
  assert.deepEqual(harness.tags, ['线束', '外观']);
  assert.equal(harness.kind, 'skipped');
  assert.equal(harness.missing, false);

  const missing = images.find((i) => i.sha256 === SHA_MISSING);
  assert.equal(missing.missing, true);
  assert.match(missing.purpose, /图片/);
});

test('同一 sha 多张表（M12 的 Ethernet + LCD）合并成一个图条目', () => {
  const { src, manifest } = fixture();
  const sha = SHA_PARAM;
  const spec = {
    no: '1.1',
    model: 'TEST 1',
    tables: [
      { sha256: sha, caption: '图3.2.3 M12 接口定义表（Ethernet）', section: '3.2 接口定义', kind: 'interface' },
      { sha256: sha, caption: '图3.2.3 M12 接口定义表（LCD）', section: '3.2 接口定义', kind: 'interface' },
    ],
  };
  const index = buildImageIndex({ manifest, specs: [{ data: spec }], srcRoot: src });
  const images = index.byModel['1.1'].images.filter((i) => i.sha256 === sha);
  assert.equal(images.length, 1);
  assert.equal(images[0].captions.length, 2);
  assert.match(images[0].purpose, /针脚信号定义/);
});

test('关键词检索：线束 / 同义词 接线 / 无命中', () => {
  const { src, spec, manifest } = fixture();
  const index = buildImageIndex({ manifest, specs: [{ data: spec }], srcRoot: src });
  const images = index.byModel['1.1'].images;

  const harness = searchImages(images, '线束');
  assert.ok(harness.length >= 1);
  assert.ok(harness.every((i) => /线束/.test(`${i.caption}${i.purpose}${(i.tags || []).join('')}`)));

  assert.ok(searchImages(images, '接线').length >= 1, '同义词「接线」应命中线束图');
  assert.equal(searchImages(images, '没有这个词').length, 0);
});

test('作用覆盖表与建议文件名', () => {
  const base = purposeFor({ kind: 'param', caption: '图3.1 配置信息' });
  const over = mergeOverride(base, { purpose: '自定义作用', tags: ['自定义'] });
  assert.equal(over.purpose, '自定义作用');
  assert.equal(over.detectedBy, 'override');

  const named = suggestName('TANK 2', { idx: 8, caption: '图4.1.2 26P接线图', section: '4.1 TANK2线束定义' });
  assert.equal(named, 'TANK-2-4.1.2-26P接线图.png');
});

test('路径解析：优先命名文件，其次 store，找不到报 missing', () => {
  const { src, spec, manifest } = fixture();
  const index = buildImageIndex({ manifest, specs: [{ data: spec }], srcRoot: src });
  const images = index.byModel['1.1'].images;
  const param = images.find((i) => i.sha256 === SHA_PARAM);
  const missing = images.find((i) => i.sha256 === SHA_MISSING);

  const root = index.imageRoot;
  const hit = locateImage(param, root);
  assert.equal(hit.exists, true);
  assert.equal(hit.via, 'named');
  assert.ok(hit.path.endsWith('00-aa11bb22-参数表.png'));

  const gone = locateImage(missing, root);
  assert.equal(gone.exists, false);
  assert.equal(gone.via, 'missing');
});

test('imageRoot 解析顺序：环境变量优先', () => {
  const { src, spec, manifest } = fixture();
  const index = buildImageIndex({ manifest, specs: [{ data: spec }], srcRoot: src });
  const envDir = path.join(src, 'images');
  const old = process.env.DSH_CPDOCS_IMAGES;
  try {
    process.env.DSH_CPDOCS_IMAGES = envDir;
    assert.equal(resolveImageRoot({ index, env: process.env }), path.resolve(envDir));
    delete process.env.DSH_CPDOCS_IMAGES;
    assert.equal(resolveImageRoot({ index, env: {} }), path.resolve(index.imageRoot));
    assert.equal(resolveImageRoot({ index: { imageRoot: '/nope/nowhere' }, env: {} }), null);
  } finally {
    if (old === undefined) delete process.env.DSH_CPDOCS_IMAGES;
    else process.env.DSH_CPDOCS_IMAGES = old;
  }
});

test('人读索引 Markdown 含机型与作用列', () => {
  const { src, spec, manifest } = fixture();
  const index = buildImageIndex({ manifest, specs: [{ data: spec }], srcRoot: src });
  const md = renderImageIndexMarkdown(index);
  assert.match(md, /# 产品图片索引/);
  assert.match(md, /## 1\.1 TEST 1/);
  assert.match(md, /线束走向与外观示意/);
  assert.match(md, /缺文件 1/);
});
