import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillGate, withSkillScope, foldGateState, emptyGateState, GATE_KEY } from '../../src/shared/skill-gate.js';

/** 最小假 ctx：effect / on / get / logger。 */
function fakeCtx({ projections, logger } = {}) {
  const listeners = new Map();
  return {
    ctx: {
      get: (name) => (name === 'sessionProjections' ? projections : undefined),
      effect: (fn) => {
        const dispose = fn();
        return typeof dispose === 'function' ? dispose : () => {};
      },
      on: (name, fn) => {
        const set = listeners.get(name) ?? new Set();
        set.add(fn);
        listeners.set(name, set);
        return () => set.delete(fn);
      },
      logger: logger ?? { warn: () => {} },
    },
    emit(name, ...args) {
      for (const fn of listeners.get(name) ?? []) fn(...args);
    },
  };
}

function fakeAgent(session = {}) {
  return { session };
}

/** 假投影服务：register 返回 thenable handle，stateOf 读外部可控状态。 */
function fakeProjections(state) {
  const registrations = [];
  return {
    registrations,
    register(definition) {
      registrations.push(definition);
      return Promise.resolve({
        stateOf: () => state,
        dispose: async () => {},
      });
    },
  };
}

async function withGateOff(fn) {
  const old = process.env.CP_TOOLS_SKILL_GATE;
  process.env.CP_TOOLS_SKILL_GATE = 'off';
  try {
    return await fn();
  } finally {
    if (old === undefined) delete process.env.CP_TOOLS_SKILL_GATE;
    else process.env.CP_TOOLS_SKILL_GATE = old;
  }
}

test('投影折叠：skill 调用成功才点亮，失败只清 pending', () => {
  let state = emptyGateState();
  state = foldGateState(state, {
    type: 'tool/call',
    data: { name: 'skill', arguments: '{"name":"bpms"}', callId: 'c1' },
  });
  assert.deepEqual(state.pending, [{ callId: 'c1', name: 'bpms' }]);
  state = foldGateState(state, {
    type: 'tool/result',
    data: { toolCallId: 'c1', message: { isError: true } },
  });
  assert.deepEqual(state.loaded, []);
  assert.deepEqual(state.pending, []);

  state = foldGateState(state, {
    type: 'tool/call',
    data: { name: 'skill', arguments: { name: 'tickets' }, callId: 'c2' },
  });
  state = foldGateState(state, {
    type: 'tool/result',
    data: { toolCallId: 'c2', message: { isError: false } },
  });
  assert.deepEqual(state.loaded, ['tickets']);
});

test('投影折叠：手势只点亮，命令入口点亮 + 记录 entered', () => {
  let state = emptyGateState();
  state = foldGateState(state, {
    type: 'user/message',
    data: { source: { kind: 'skill-invocation', name: 'bpms' } },
  });
  assert.deepEqual(state.loaded, ['bpms']);
  assert.deepEqual(state.entered, []);

  state = foldGateState(state, {
    type: 'user/message',
    data: { source: { kind: 'cp-tools-entry', name: 'tickets' } },
  });
  assert.deepEqual(state.loaded, ['bpms', 'tickets']);
  assert.deepEqual(state.entered, ['tickets']);
});

test('投影折叠：无关事件返回同一引用', () => {
  const state = emptyGateState();
  assert.equal(foldGateState(state, { type: 'turn/start', data: {} }), state);
  assert.equal(
    foldGateState(state, { type: 'user/message', data: { source: { kind: 'user' } } }),
    state,
  );
});

test('有投影时：when 读投影状态，不碰已弃用的 snapshotEvents', async () => {
  const state = { loaded: [], entered: [], pending: [] };
  const projections = fakeProjections(state);
  const { ctx } = fakeCtx({ projections });
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent({
    snapshotEvents() {
      throw new Error('主路径不应读会话日志');
    },
  });

  assert.equal(await gate.when('bpms')({ agent }), false);
  state.loaded.push('bpms');
  assert.equal(await gate.when('bpms')({ agent }), true);
  assert.equal(projections.registrations.length, 1);
  const definition = projections.registrations[0];
  assert.equal(definition.key, GATE_KEY);
  assert.deepEqual(definition.stateSchema.parse({ loaded: ['bpms'], entered: [], pending: [] }), {
    loaded: ['bpms'],
    entered: [],
    pending: [],
  });
  assert.throws(() => definition.stateSchema.parse({ loaded: 'bpms' }));
  assert.throws(() => definition.stateSchema.parse({ loaded: [], entered: [], pending: [{ callId: 1 }] }));
});

test('有投影时：activate 让本步立即可见，entered 供写类 guard 使用', async () => {
  const state = { loaded: [], entered: [], pending: [] };
  const { ctx } = fakeCtx({ projections: fakeProjections(state) });
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  assert.equal(await gate.when('bpms')({ agent }), false);
  gate.activate(agent, 'bpms');
  assert.equal(await gate.when('bpms')({ agent }), true);
  assert.equal(gate.entered('bpms', agent), true);
  assert.equal(gate.entered('tickets', agent), false);
});

test('无投影时：从日志补水，失败调用不点亮，命令入口点亮 entered', async () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms', 'tickets']);
  const agent = fakeAgent({
    snapshotEvents: () => [
      { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"bpms"}', callId: 'c1' } },
      { type: 'tool/result', data: { toolCallId: 'c1', message: { isError: true } } },
      { type: 'user/message', data: { source: { kind: 'cp-tools-entry', name: 'tickets' } } },
    ],
  });
  assert.equal(await gate.when('bpms')({ agent }), false, '失败的加载不应点亮');
  assert.equal(await gate.when('tickets')({ agent }), true);
  assert.equal(gate.entered('tickets', agent), true);
  assert.equal(gate.entered('bpms', agent), false);
});

test('实时 tools/result 观察：PTC 嵌套调用与非本插件 skill 不点亮', async () => {
  const state = { loaded: [], entered: [], pending: [] };
  const { ctx, emit } = fakeCtx({ projections: fakeProjections(state) });
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  emit('tools/result', { name: 'skill', arguments: { name: 'bpms' }, agent, parent: 'root' }, { isError: false });
  assert.equal(await gate.when('bpms')({ agent }), false);
  emit('tools/result', { name: 'skill', arguments: { name: 'flash' }, agent }, { isError: false });
  assert.equal(await gate.when('bpms')({ agent }), false);
  emit('tools/result', { name: 'skill', arguments: { name: 'bpms' }, agent }, { isError: false });
  assert.equal(await gate.when('bpms')({ agent }), true);
});

test('agent/disposed 之后内存状态清空', async () => {
  const { ctx, emit } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  gate.activate(agent, 'bpms');
  assert.equal(await gate.when('bpms')({ agent }), true);
  emit('agent/disposed', { agent });
  assert.equal(await gate.when('bpms')({ agent }), false);
});

test('条件内部抛错时返回 false 并只告警一次（不让 step 失败）', async () => {
  const warnings = [];
  const { ctx } = fakeCtx({ logger: { warn: (message) => warnings.push(message) } });
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent({
    snapshotEvents() {
      throw new Error('session log unreadable');
    },
  });
  assert.equal(await gate.when('bpms')({ agent }), false);
  assert.equal(await gate.when('bpms')({ agent }), false);
  assert.equal(warnings.filter((message) => message.includes('补水失败')).length, 1);
});

test('没有投影服务时只告警一次，并退化为默认不可见', async () => {
  const warnings = [];
  const { ctx } = fakeCtx({ logger: { warn: (message) => warnings.push(message) } });
  const gate = createSkillGate(ctx, ['bpms']);
  assert.equal(await gate.when('bpms')({ agent: fakeAgent() }), false);
  assert.equal(warnings.filter((message) => message.includes('没有 sessionProjections')).length, 1);
});

test('投影注册失败时退回内存 + 日志补水', async () => {
  const warnings = [];
  const projections = {
    register() {
      return Promise.reject(new Error('boom'));
    },
  };
  const { ctx } = fakeCtx({ projections, logger: { warn: (message) => warnings.push(message) } });
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent({
    snapshotEvents: () => [{ type: 'user/message', data: { source: { kind: 'cp-tools-entry', name: 'bpms' } } }],
  });
  assert.equal(await gate.when('bpms')({ agent }), true);
  assert.ok(warnings.some((message) => message.includes('注册失败')));
});

test('CP_TOOLS_SKILL_GATE=off 时恒可见（急停开关）', async () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  await withGateOff(async () => {
    assert.equal(await gate.when('bpms')({ agent }), true);
  });
  assert.equal(await gate.when('bpms')({ agent }), false);
});

test('when 只对 owned skill 生效', async () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  gate.activate(agent, 'tickets');
  assert.equal(await gate.when('tickets')({ agent }), false);
});

test('withSkillScope 前置边界文本且不改 name/parameters', () => {
  const tool = { name: 'demo', description: '原始描述', parameters: { type: 'object' } };
  const scoped = withSkillScope(tool, '【demo 技能】只读。');
  assert.equal(scoped.name, 'demo');
  assert.equal(scoped.parameters, tool.parameters);
  assert.ok(scoped.description.startsWith('【demo 技能】'));
  assert.ok(scoped.description.includes('原始描述'));
  assert.equal(withSkillScope({ name: 'x' }, '【x】').description, '【x】');
});
