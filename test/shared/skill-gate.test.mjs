import test from 'node:test';
import assert from 'node:assert/strict';
import { createSkillGate, withSkillScope } from '../../src/shared/skill-gate.js';

/** 最小假 ctx：只提供 gate 用到的 effect / on。 */
function fakeCtx() {
  const listeners = new Map();
  return {
    ctx: {
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
    },
    emit(name, ...args) {
      for (const fn of listeners.get(name) ?? []) fn(...args);
    },
  };
}

/** 假 agent：默认没有会话日志。 */
function fakeAgent(events = undefined) {
  return {
    session:
      events === undefined
        ? undefined
        : {
            snapshotEvents: () => events,
          },
  };
}

function withGateOff(fn) {
  const old = process.env.CP_TOOLS_SKILL_GATE;
  process.env.CP_TOOLS_SKILL_GATE = 'off';
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env.CP_TOOLS_SKILL_GATE;
    else process.env.CP_TOOLS_SKILL_GATE = old;
  }
}

test('模型成功调用 skill(bpms) 后只点亮 bpms，不点亮别的 skill', () => {
  const { ctx, emit } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms', 'tickets']);
  const agent = fakeAgent();
  emit('tools/result', { name: 'skill', arguments: { name: 'bpms' }, agent }, { isError: false });
  assert.equal(gate.when('bpms')({ agent }), true);
  assert.equal(gate.when('tickets')({ agent }), false);
});

test('tool/call 事件里的 arguments 是 JSON 字符串也要认得（补水的同一解析）', () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent([
    { type: 'tool/call', data: { name: 'skill', arguments: '{"name":"bpms"}' } },
  ]);
  assert.equal(gate.when('bpms')({ agent }), true);
});

test('加载失败、PTC 嵌套调用、非本插件 skill 都不点亮', () => {
  const { ctx, emit } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  emit('tools/result', { name: 'skill', arguments: { name: 'bpms' }, agent }, { isError: true });
  emit('tools/result', { name: 'skill', arguments: { name: 'bpms' }, agent, parent: 'root' }, { isError: false });
  emit('tools/result', { name: 'skill', arguments: { name: 'flash' }, agent }, { isError: false });
  emit('tools/result', { name: 'bash', arguments: {}, agent }, { isError: false });
  assert.equal(gate.when('bpms')({ agent }), false);
});

test('resume：会话日志里已有的 skill 调用自动恢复（含旧的手势注入消息）', () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms', 'tickets']);
  const byTool = fakeAgent([{ type: 'tool/call', data: { name: 'skill', arguments: { name: 'tickets' } } }]);
  const byGesture = fakeAgent([
    { type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'bpms' } } },
  ]);
  assert.equal(gate.when('tickets')({ agent: byTool }), true);
  assert.equal(gate.when('bpms')({ agent: byGesture }), true);
});

test('agent/disposed 之后状态清空', () => {
  const { ctx, emit } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  emit('tools/result', { name: 'skill', arguments: { name: 'bpms' }, agent }, { isError: false });
  assert.equal(gate.when('bpms')({ agent }), true);
  emit('agent/disposed', { agent });
  assert.equal(gate.when('bpms')({ agent }), false);
});

test('条件内部抛错时返回 false，不让 step 失败（TOOL_ACTIVATION_FAILED）', () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = {
    session: {
      snapshotEvents() {
        throw new Error('session log unreadable');
      },
    },
  };
  assert.equal(gate.when('bpms')({ agent }), false);
});

test('没有会话与事件来源时（缺 ctx.on）不抛，默认不可见', () => {
  const gate = createSkillGate({ effect: (fn) => fn() }, ['bpms']);
  assert.equal(gate.when('bpms')({ agent: fakeAgent() }), false);
});

test('CP_TOOLS_SKILL_GATE=off 时恒可见（急停开关）', () => {
  const { ctx } = fakeCtx();
  const gate = createSkillGate(ctx, ['bpms']);
  const agent = fakeAgent();
  withGateOff(() => {
    assert.equal(gate.when('bpms')({ agent }), true);
  });
  assert.equal(gate.when('bpms')({ agent }), false);
});

test('withSkillScope 前置边界文本且不改 name/parameters', () => {
  const tool = { name: 'demo', description: '原始描述', parameters: { type: 'object' } };
  const scoped = withSkillScope(tool, '【demo 技能】只读。');
  assert.equal(scoped.name, 'demo');
  assert.equal(scoped.description, '【demo 技能】只读。 原始描述');
  assert.deepEqual(scoped.parameters, tool.parameters);
  assert.equal(tool.description, '原始描述', '原对象不能被改');
});
