import test from 'node:test';
import assert from 'node:assert/strict';
import { renderCandidates, renderCatalog } from '../../src/docs/lib/framing.js';

test('候选列表：列机型且提示细写', () => {
  const text = renderCandidates({
    query: 'SPRING2',
    scored: [
      [10, { id: '1.21', model: 'SPRING 10 二代', aliases: ['SPRING2 10', 'SPRING 10 二代'] }],
      [9, { id: '1.23', model: 'SPRING 10 PRO 二代', aliases: ['SPRING2-10PRO', 'SP2-10PRO'] }],
    ],
  });
  assert.match(text, /机型「SPRING2」不唯一/);
  assert.match(text, /1\.21 SPRING 10 二代/);
  assert.match(text, /1\.23 SPRING 10 PRO 二代/);
});

test('机型目录：按系列分组并计数', () => {
  const text = renderCatalog([
    { id: '1.21', model: 'SPRING 10 二代', family: 'SPRING' },
    { id: '1.23', model: 'SPRING 10 PRO 二代', family: 'SPRING' },
    { id: '1.1', model: 'APOLLO 7 PRO', family: 'APOLLO PRO' },
  ]);
  assert.match(text, /共 3 款机型/);
  assert.match(text, /【SPRING】/);
  assert.match(text, /【APOLLO PRO】/);
});
