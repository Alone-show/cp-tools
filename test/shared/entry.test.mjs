import test from 'node:test';
import assert from 'node:assert/strict';
import { registerEntryCommand, entryMessage, ENTRY_COMMANDS } from '../../src/shared/entry.js';

function fakeCtx({ commands = true } = {}) {
  const registered = [];
  const effects = [];
  const child = {
    commands: commands
      ? { register: (definition) => (registered.push(definition), () => {}) }
      : undefined,
    effect: (fn, label) => {
      const dispose = fn();
      effects.push(label);
      return typeof dispose === 'function' ? dispose : () => {};
    },
  };
  const ctx = {
    inject: (deps, callback) => callback(child),
  };
  return { ctx, registered, effects, child };
}

const definition = { name: 'firmware', content: '# 固件查找\n\n先给机型目录。' };

function fakeGate() {
  const calls = [];
  return {
    calls,
    activate: (agent, skill) => calls.push({ agent, skill }),
    entered: () => false,
  };
}

test('命令入口清单与文档口径一致', () => {
  assert.deepEqual([...ENTRY_COMMANDS].sort(), ['bpms', 'firmware', 'tickets']);
});

test('handler 注入 skill 正文 + 用户请求，并激活本步可见', async () => {
  const { ctx, registered } = fakeCtx();
  const gate = fakeGate();
  registerEntryCommand(ctx, {
    name: 'firmware',
    skill: 'firmware',
    definition,
    description: '查固件',
    hint: '机型',
    defaultQuery: '先给机型目录',
    gate,
  });

  assert.equal(registered.length, 1);
  const messages = [];
  const agent = { session: {}, followup: (message) => messages.push(message) };
  const result = await registered[0].handler({ agent, rawInput: 'models', signal: new AbortController().signal });

  assert.equal(result.kind, 'success');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].source.kind, 'cp-tools-entry');
  assert.equal(messages[0].source.name, 'firmware');
  assert.ok(messages[0].source.summary.length <= 120);
  assert.ok(messages[0].content[0].text.includes('# 固件查找'), '应带 skill 正文');
  assert.ok(messages[0].content[0].text.includes('用户请求：models'));
  assert.deepEqual(gate.calls.map((call) => call.skill), ['firmware']);
});

test('空参数用默认请求；缺 agent 返回 error', async () => {
  const { ctx, registered } = fakeCtx();
  const gate = fakeGate();
  registerEntryCommand(ctx, {
    name: 'tickets',
    skill: 'tickets',
    definition: { content: '# 工单' },
    description: '查工单',
    defaultQuery: '先问我现象',
    gate,
  });

  const messages = [];
  await registered[0].handler({ agent: { session: {}, followup: (message) => messages.push(message) } });
  assert.ok(messages[0].content[0].text.includes('用户请求：先问我现象'));

  const error = await registered[0].handler({});
  assert.equal(error.kind, 'error');
  assert.match(error.text, /agent/);
});

test('没有 commands 服务时不抛，也不注册命令', () => {
  const { ctx, registered } = fakeCtx({ commands: false });
  assert.doesNotThrow(() =>
    registerEntryCommand(ctx, {
      name: 'bpms',
      skill: 'bpms',
      definition,
      description: 'BPMS',
      defaultQuery: '登录',
      gate: fakeGate(),
    }),
  );
  assert.equal(registered.length, 0);
});

test('没有 ctx.inject 时退回 ctx.commands.register', () => {
  const registered = [];
  const ctx = { commands: { register: (definition) => (registered.push(definition), () => {}) } };
  registerEntryCommand(ctx, {
    name: 'bpms',
    skill: 'bpms',
    definition,
    description: 'BPMS',
    defaultQuery: '登录',
    gate: fakeGate(),
  });
  assert.equal(registered[0].name, 'bpms');
});

test('entryMessage 把正文放在请求之前，并限制摘要长度', () => {
  const message = entryMessage({ name: 'firmware', skill: 'firmware', body: '# 正文', query: 'x'.repeat(200) });
  const text = message.content[0].text;
  assert.ok(text.indexOf('# 正文') < text.indexOf('用户请求：'));
  assert.ok(message.source.summary.length <= 120);
  assert.ok(message.source.summary.endsWith('…'));
});
