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
  const ctx = {
    commands: { register: (d) => registered.push(d) },
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
  const agent = { followup: (m) => messages.push(m) };
  return {
    def,
    messages,
    run: (rawInput) => def.handler({ commandId: 'c1', agent, rawInput, attachments: [], signal: new AbortController().signal }),
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
