import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { __internals } from '../../src/tickets/index.js';

const PROJECT_ID = '65a8da81950780b816d12bd9';

function ctx() {
  return {
    get: () => undefined,
    effect: (fn) => {
      fn();
      return () => {};
    },
    on: () => () => {},
    tools: { register: () => () => {} },
    skills: { register: () => () => {} },
  };
}

test('issuesFromIndex：从共享 .tbfw 读取版本子任务', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-tickets-'));
  process.env.DSH_TBFW_DIR = dir;
  const board = {
    format: 2,
    projectId: PROJECT_ID,
    syncedAt: new Date().toISOString(),
    fetched: 1,
    items: [
      {
        id: 'p1',
        uniqueId: 7001,
        title: '【版本迭代】CP_SP2-10PRO_A_V1.16_LCD10',
        stage: '生产库归档',
        updated: '2026-01-02T00:00:00.000Z',
        created: '2026-01-01T00:00:00.000Z',
        accomplished: '2026-01-03T00:00:00.000Z',
        isDone: true,
        isArchived: false,
        executor: '张三',
        subtaskCount: { total: 1, done: 1 },
        url: 'https://www.teambition.com/task/p1',
        fields: {
          机型: ['RK / SPRING2-10PRO'],
          操作系统: ['Android'],
          客户ID: ['CP'],
          固件版本: 'CP_SP2-10PRO_A_V1.16_LCD10_B0_MDM_20260101',
        },
      },
    ],
  };
  const subtasks = {
    format: 1,
    projectId: PROJECT_ID,
    syncedAt: new Date().toISOString(),
    parents: {},
    byParent: {
      p1: [
        {
          id: 's1',
          parentId: 'p1',
          content: '摄像头热插拔出现断层',
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
  fs.writeFileSync(path.join(dir, `board-${PROJECT_ID}.json`), JSON.stringify(board));
  fs.writeFileSync(path.join(dir, `subtasks-${PROJECT_ID}.json`), JSON.stringify(subtasks));

  try {
    const res = await __internals.issuesFromIndex(ctx(), {}, {
      model: 'SP2-10PRO',
      query: '摄像头断层',
      customer: '*',
      source: 'index',
      limit: 5,
    });
    assert.equal(res.status, 'ok', JSON.stringify(res));
    assert.equal(res.mode, 'issues');
    assert.equal(res.summary.versions, 1);
    assert.equal(res.rows[0].subtasks[0].content, '摄像头热插拔出现断层');
    assert.equal(res.rows[0].task, 'https://www.teambition.com/task/p1');
  } finally {
    delete process.env.DSH_TBFW_DIR;
  }
});
