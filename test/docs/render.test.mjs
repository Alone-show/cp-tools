/**
 * cp_docs 的「模型可见内容」测试。
 *
 * 回归点：规范值（packet）不会进入模型，模型只看 output.render() + deferContext；
 * 之前 render 只回摘要，导致整包资料永远到不了模型。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apply } from '../../src/docs/index.js';
import { workspaceDir } from '../helpers/paths.mjs';

const workspace = workspaceDir() ?? path.resolve(import.meta.dirname, '../..');
const dataDir = path.join(workspace, '.cpdocs');
delete process.env.DSH_CPDOCS_DIR;

function harness() {
  const tools = [];
  const ctx = {
    logger: { warn: () => {} },
    commands: { register: () => () => {} },
    tools: { register: (definition) => (tools.push(definition), () => {}) },
    skills: { register: () => () => {} },
    effect: (fn) => {
      const dispose = fn();
      return typeof dispose === 'function' ? dispose : () => {};
    },
    get: (key) => {
      if (key !== 'workingDirectory') return undefined;
      return { defaultDirectory: workspace, async ensure() { return workspace; } };
    },
  };
  apply(ctx);
  const tool = tools.find((definition) => definition.name === 'cp_docs');
  return { tool, ctx };
}

function contentOf(tool, value, args = { query: 'x' }) {
  return tool.output.render(args, value).map((block) => block.text ?? '').join('');
}

test('ok：原生调用把整包交给 deferContext，render 只回摘要', { skip: !fs.existsSync(dataDir) }, async () => {
  const { tool } = harness();
  const deferred = [];
  const exec = {
    agent: {},
    signal: new AbortController().signal,
    deferContext: (message) => deferred.push(message),
  };
  const value = await tool.execute({ query: 'SPRING2PRO 的屏幕尺寸是多少' }, exec);

  assert.equal(value.status, 'ok');
  assert.equal(value.delivered, 'context');
  assert.equal(value.packet, undefined, '已由上下文投递时不再重复塞规范值');
  assert.equal(deferred.length, 1);
  const message = deferred[0];
  assert.equal(message.role, 'user');
  assert.equal(message.source.kind, 'cp-docs');
  assert.ok(message.content[0].text.includes('10.1 英寸'), '上下文里应有整包资料');
  assert.ok(message.content[0].text.includes('用户问题：'));

  const content = contentOf(tool, value);
  assert.ok(content.includes('整包资料已作为下一条上下文给出'));
  assert.ok(!content.includes('10.1 英寸'), '摘要里不需要重复整包');
});

test('ok：没有 deferContext 时 render 内联 packet（PTC/旧版本兜底）', { skip: !fs.existsSync(dataDir) }, async () => {
  const { tool } = harness();
  const value = await tool.execute(
    { query: 'SPRING2PRO 的屏幕尺寸是多少' },
    { agent: {}, signal: new AbortController().signal },
  );
  assert.equal(value.delivered, 'inline');
  assert.ok(value.packet.length > 1000);
  const content = contentOf(tool, value);
  assert.ok(content.includes('10.1 英寸'), '模型必须能看到资料');
});

test('ok：PTC 子调用（exec.parent 存在）走内联', { skip: !fs.existsSync(dataDir) }, async () => {
  const { tool } = harness();
  const value = await tool.execute(
    { query: 'SPRING2PRO 的屏幕尺寸是多少' },
    { parent: Symbol('parent'), agent: {}, signal: new AbortController().signal, deferContext: () => assert.fail('子调用不应注入上下文') },
  );
  assert.equal(value.delivered, 'inline');
});

test('catalog：render 给出机型清单，而不只是数量', { skip: !fs.existsSync(dataDir) }, async () => {
  const { tool } = harness();
  const value = await tool.execute(
    { query: '支持哪些机型' },
    { agent: {}, signal: new AbortController().signal, deferContext: () => {} },
  );
  assert.equal(value.status, 'catalog');
  const content = contentOf(tool, value);
  assert.ok(content.includes('机型目录'));
  assert.ok(/SPRING|APOLLO/.test(content), '清单要能被模型看到');
});

test('needs_confirmation：render 给出候选让模型转述', { skip: !fs.existsSync(dataDir) }, async () => {
  const { tool } = harness();
  const value = await tool.execute(
    { query: 'APOLLO2' },
    { agent: {}, signal: new AbortController().signal, deferContext: () => {} },
  );
  assert.equal(value.status, 'needs_confirmation');
  const content = contentOf(tool, value);
  assert.ok(content.includes('需要先确定机型'));
  assert.ok(/APOLLO/.test(content));
});

test('error：render 给出原因与用法，且不重复用法两次', { skip: !fs.existsSync(dataDir) }, async () => {
  const { tool } = harness();
  const value = await tool.execute(
    { query: '这台机器怎么接线' },
    { agent: {}, signal: new AbortController().signal, deferContext: () => {} },
  );
  assert.equal(value.status, 'error');
  const content = contentOf(tool, value);
  assert.ok(content.includes('用法：'));
  assert.equal(content.split('用法：').length - 1, 1, '用法只应出现一次');
});
