import test from 'node:test';
import assert from 'node:assert/strict';
import { createWriteGuard } from '../../src/shared/write-guard.js';

function fakeGate() {
  return {
    entered: (skill, agent) => agent?.entered?.has(skill) === true,
    allow: (agent, skill) => {
      agent.entered ??= new Set();
      agent.entered.add(skill);
    },
  };
}

const rules = [
  { tool: 'bpms_update', skill: 'bpms', command: 'bpms', when: (args) => args?.apply === true },
  { tool: 'bpms_upload', skill: 'bpms', command: 'bpms' },
];

test('写操作未经命令进入时拒绝，理由指向命令', () => {
  const guard = createWriteGuard(fakeGate(), rules);
  const agent = { session: {} };
  const reason = guard({ name: 'bpms_update', arguments: { apply: true }, agent });
  assert.ok(reason);
  assert.match(reason, /\/bpms/);
  assert.match(reason, /写模式/);
});

test('dry-run、读类、未列出的工具都不拒绝', () => {
  const guard = createWriteGuard(fakeGate(), rules);
  const agent = { session: {} };
  assert.equal(guard({ name: 'bpms_update', arguments: { apply: false }, agent }), undefined);
  assert.equal(guard({ name: 'bpms_get', arguments: {}, agent }), undefined);
  assert.equal(guard({ name: 'firmware_find', arguments: {}, agent }), undefined);
});

test('命令进入后放行，且只对本次会话/该 agent 生效', () => {
  const gate = fakeGate();
  const guard = createWriteGuard(gate, rules);
  const agent = { session: {} };
  const other = { session: {} };
  gate.allow(agent, 'bpms');
  assert.equal(guard({ name: 'bpms_update', arguments: { apply: true }, agent }), undefined);
  assert.equal(guard({ name: 'bpms_upload', arguments: {}, agent }), undefined);
  assert.ok(guard({ name: 'bpms_update', arguments: { apply: true }, agent: other }));
});

test('没有 agent 时按未进入处理（安全默认）', () => {
  const guard = createWriteGuard(fakeGate(), rules);
  assert.ok(guard({ name: 'bpms_upload', arguments: {} }));
});

test('自定义拒绝理由优先', () => {
  const guard = createWriteGuard(fakeGate(), [
    { tool: 'ticket_sync', skill: 'tickets', command: 'tickets', reason: '先输入 /tickets sync' },
  ]);
  assert.equal(guard({ name: 'ticket_sync', arguments: {}, agent: { session: {} } }), '先输入 /tickets sync');
});
