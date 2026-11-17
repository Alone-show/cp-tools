/**
 * 端到端（不走网络）：模拟 Host 的 workingDirectory 服务，验证命令 handler
 * 能找到 workspace 下的 .cpdocs、完成检索并 followup 一条事实消息。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { apply } from '../../src/docs/index.js';
import { workspaceDir } from '../helpers/paths.mjs';

const workspace = workspaceDir() ?? path.resolve(import.meta.dirname, '../..');
const dataDir = path.join(workspace, '.cpdocs');
delete process.env.DSH_CPDOCS_DIR;

function harness() {
  const registered = [];
  const messages = [];
  const tools = [];
  const skills = [];
  const ctx = {
    commands: { register: (d) => registered.push(d) },
    tools: { register: (d) => (tools.push(d), () => {}) },
    skills: { register: (s) => (skills.push(s), () => {}) },
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    get: (k) => {
      if (k !== 'workingDirectory') return undefined;
      return {
        defaultDirectory: workspace,
        async ensure() { return workspace; },
      };
    },
  };
  apply(ctx);
  const def = registered.find((d) => d.name === 'cp-docs');
  const tool = tools.find((d) => d.name === 'cp_docs');
  const imagesTool = tools.find((d) => d.name === 'cp_docs_images');
  const agent = { followup: (m) => messages.push(m) };
  return {
    def,
    tool,
    imagesTool,
    tools,
    skills,
    messages,
    run: (rawInput) => def.handler({ commandId: 'c1', agent, rawInput, attachments: [], signal: new AbortController().signal }),
    runTool: (query) => tool.execute({ query }, { agent, signal: new AbortController().signal }),
    runImages: (args) => imagesTool.execute(args, { agent, signal: new AbortController().signal }),
  };
}

test('命令从 workspace 的 .cpdocs 读取资料', { skip: !fs.existsSync(dataDir) }, async () => {
  const h = harness();
  assert.ok(h.def);
  const res = await h.run(' SPRING2PRO 的屏幕尺寸是多少');
  assert.equal(res.kind, 'success');
  assert.equal(h.messages.length, 1);
  const msg = h.messages[0];
  assert.equal(msg.role, 'user');
  assert.equal(msg.content[0].type, 'text');
  assert.match(msg.content[0].text, /SPRING 10 PRO 二代/);
  assert.match(msg.content[0].text, /10\.1 英寸/);
  assert.match(msg.content[0].text, /1024\*600/);
});

test('空输入给用法', () => {
  const h = harness();
  return h.run(' ').then((res) => {
    assert.equal(res.kind, 'error');
    assert.match(res.text, /用法/);
  });
});

test('工具 cp_docs 与 /cp-docs 命令同一套判定', { skip: !fs.existsSync(dataDir) }, async () => {
  const h = harness();
  assert.ok(h.tool, '应注册 cp_docs 工具');
  const res = await h.runTool('SPRING2PRO 的屏幕尺寸是多少');
  assert.equal(res.status, 'ok');
  assert.match(res.model, /SPRING/);
  assert.match(res.packet, /10\.1 英寸/);
  assert.match(res.instruction, /packet/);
  assert.equal(h.messages.length, 0, '工具直接返回资料给模型，不应 followup');
});

test('工具在认不出机型时不猜', { skip: !fs.existsSync(dataDir) }, async () => {
  const h = harness();
  const res = await h.runTool('这台机器怎么接线');
  assert.ok(['needs_confirmation', 'error'].includes(res.status), `unexpected status ${res.status}`);
});

test('注册了运行时 skill，与其它子插件同形', () => {
  const h = harness();
  assert.equal(h.skills.length, 1);
  assert.equal(h.skills[0].name, 'cp-docs');
  assert.ok(h.skills[0].description.length > 20);
});

test('注册了 cp_docs_images（与 cp_docs 同一 skill gate）', () => {
  const h = harness();
  assert.ok(h.imagesTool, '应注册 cp_docs_images 工具');
  assert.match(h.imagesTool.description, /线束/);
});

test('cp_docs_images 能按机型取图并标作用', { skip: !fs.existsSync(path.join(dataDir, 'images.json')) }, async () => {
  const h = harness();
  const res = await h.runImages({ model: 'TANK2' });
  assert.equal(res.status, 'ok');
  assert.match(res.model, /TANK 2/);
  assert.equal(res.total, 12);
  assert.equal(res.images.length, 12);
  assert.ok(res.images.every((img) => img.purpose && img.deliverAs));
  assert.ok(res.images.some((img) => /图4\.1\.2/.test(img.caption)));
});

test('cp_docs_images 关键词过滤命中线束 4 张', { skip: !fs.existsSync(path.join(dataDir, 'images.json')) }, async () => {
  const h = harness();
  const res = await h.runImages({ model: 'TANK2', keyword: '线束' });
  assert.equal(res.status, 'ok');
  assert.equal(res.count, 4);
  const caps = res.images.map((i) => i.caption).join(' ');
  assert.match(caps, /4\.1\.1/);
  assert.match(caps, /4\.1\.2/);
  assert.match(caps, /4\.1\.3/);
  assert.match(caps, /4\.1\.4/);
  assert.ok(res.images.every((i) => i.exists), '索引里的 path 应真实存在');
});

test('cp_docs_images 关键词无命中时不报错', { skip: !fs.existsSync(path.join(dataDir, 'images.json')) }, async () => {
  const h = harness();
  const res = await h.runImages({ model: 'TANK2', keyword: '不存在的图' });
  assert.equal(res.status, 'ok');
  assert.equal(res.count, 0);
  assert.match(res.instruction, /关键词/);
});

test('cp_docs_images 找不到机型时列候选', { skip: !fs.existsSync(dataDir) }, async () => {
  const h = harness();
  const res = await h.runImages({ model: 'SPRING2' });
  assert.equal(res.status, 'needs_confirmation');
  assert.ok(res.candidates.length >= 2);
});
