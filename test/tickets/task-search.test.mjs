import test from 'node:test';
import assert from 'node:assert/strict';

import { searchBoardTasks, renderIssues } from '../../src/tickets/lib/issues.js';
import { expandSymptom, matchScore } from '../../src/tickets/lib/symptoms.js';
import { normalizeTask, findLiveRecords } from '../../src/tb/live.js';

const shantui = {
  id: 't-6685',
  uniqueId: 6685,
  title: 'ITR:【山推技术】偶现sim卡出现两张，并且无法上网',
  stage: '验证通过',
  created: '2026-01-07T06:54:40.410Z',
  accomplished: '2026-01-14T05:52:19.746Z',
  updated: '2026-08-05T12:18:02.304Z',
  isDone: true,
  isArchived: false,
  executor: '卓俊源',
  url: 'https://www.teambition.com/task/695e03303cae266779f8543e',
  fields: {},
};

const versionParent = {
  id: 'p1',
  uniqueId: 7001,
  title: '【版本迭代】CP_APOLLO2-7_A_V1.10_LCD7_B0_CN_20260101',
  stage: '生产库归档',
  created: '2026-01-01T00:00:00.000Z',
  accomplished: '2026-01-03T00:00:00.000Z',
  updated: '2026-01-03T00:00:00.000Z',
  isDone: true,
  isArchived: false,
  executor: '张三',
  url: 'https://www.teambition.com/task/p1',
  fields: {
    机型: ['RK / APOLLO2-7'],
    操作系统: ['Android'],
    客户ID: ['CP'],
    固件版本: 'CP_APOLLO2-7_A_V1.10_LCD7_B0_CN_20260101',
  },
};

const board = { format: 2, items: [shantui, versionParent] };

test('expandSymptom：口语归一', () => {
  const variants = expandSymptom('单卡 设置里出现两个卡 上不去网');
  assert.ok(variants.some((v) => v.includes('无法上网')), variants.join(' | '));
  assert.ok(variants.some((v) => v.includes('双卡')), variants.join(' | '));
  assert.ok(variants.includes('无法上网'));
});

test('matchScore：上不去网 能命中 无法上网', () => {
  const scored = matchScore('上不去网', '偶现sim卡出现两张，并且无法上网');
  assert.ok(scored.substring || scored.score >= 100);
  assert.ok(scored.score > 0);
});

test('searchBoardTasks：无子任务、无客户字段的 ITR 单也返回任务号', () => {
  const result = searchBoardTasks(board, null, { query: '单卡 设置里出现两个卡 上不去网', limit: 5 });
  assert.equal(result.status, 'ok');
  assert.equal(result.mode, 'tasks');
  assert.equal(result.tasks[0].taskNo, 6685);
  assert.equal(result.tasks[0].title, shantui.title);
  assert.equal(result.tasks[0].outcome, 'solved');
  const text = renderIssues(result);
  assert.match(text, /#6685/);
  assert.match(text, /验证通过/);
  assert.match(text, /ITR/);
});

test('searchBoardTasks：子任务命中挂回父版本', () => {
  const subtasks = {
    byParent: {
      p1: [
        {
          id: 's1',
          content: '单卡样机设置里出现两个卡，上不去网',
          note: '',
          status: '验证通过',
          isDone: true,
          created: '',
          updated: '',
          accomplished: '2026-01-03T00:00:00.000Z',
          executor: '张三',
          uniqueId: 7002,
          url: 'https://www.teambition.com/task/s1',
        },
      ],
    },
  };
  const result = searchBoardTasks(board, subtasks, { query: '两个卡 上不去网', limit: 5 });
  assert.equal(result.status, 'ok');
  assert.equal(result.tasks[0].taskNo, 7002);
  assert.equal(result.tasks[0].parentVersion, 'CP_APOLLO2-7_A_V1.10_LCD7_B0_CN_20260101');
});

test('searchBoardTasks：空关键词要求补充现象', () => {
  const result = searchBoardTasks(board, null, { query: '' });
  assert.equal(result.status, 'needs_model');
});

test('normalizeTask：实时任务保留 uniqueId/执行人/完成时间', () => {
  const task = normalizeTask(
    {
      _id: 'x1',
      content: 'ITR:测试单',
      uniqueId: 1234,
      isDone: true,
      accomplished: '2026-01-02T00:00:00.000Z',
      executor: { name: '李四' },
      taskflowstatus: { name: '验证通过' },
    },
    {},
  );
  assert.equal(task.uniqueId, 1234);
  assert.equal(task.executor, '李四');
  assert.equal(task.accomplished, '2026-01-02T00:00:00.000Z');
});

test('findLiveRecords(includeTasks)：0 子任务、无客户字段也返回', async () => {
  const raw = {
    _id: 't-6685',
    content: shantui.title,
    uniqueId: 6685,
    isDone: true,
    accomplished: shantui.accomplished,
    executor: { name: '卓俊源' },
    taskflowstatus: { name: '验证通过' },
    created: shantui.created,
    updated: shantui.updated,
  };
  const client = {
    search: async () => [raw],
    defs: async () => ({}),
    task: async () => raw,
    subtasks: async () => [],
  };
  const found = await findLiveRecords({
    client,
    projectId: 'pid',
    query: '单卡 上不去网',
    includeTasks: true,
    extraQueries: ['无法上网', '两张卡'],
  });
  assert.equal(found.tasks.length, 1);
  assert.equal(found.tasks[0].uniqueId, 6685);
  assert.equal(found.records.length, 0);
  assert.ok(found.queries.includes('无法上网'));
});
