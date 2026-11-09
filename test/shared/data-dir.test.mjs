import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  candidateDirs,
  findExistingDir,
  resolveWritableDir,
  copyDir,
} from '../../src/shared/data-dir.js';

function withEnv(name, value, fn) {
  const old = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (old === undefined) delete process.env[name];
    else process.env[name] = old;
  }
}

test('candidateDirs：env → 会话工作区 → 默认目录 → cwd', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-datadir-'));
  const explicit = path.join(tmp, 'explicit');
  const workspace = path.join(tmp, 'workspace');
  fs.mkdirSync(explicit, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  try {
    await withEnv('DSH_TEST_DATA', explicit, async () => {
      const ctx = {
        get: (k) => (k === 'workingDirectory'
          ? { defaultDirectory: workspace, ensure: async () => workspace }
          : undefined),
      };
      const dirs = await candidateDirs(ctx, { agent: {} }, {
        envNames: ['DSH_TEST_DATA'],
        subdir: '.cpdocs',
      });
      assert.equal(dirs[0], explicit);
      assert.ok(dirs.includes(path.join(workspace, '.cpdocs')));
      assert.equal(dirs[dirs.length - 1], path.join(process.cwd(), '.cpdocs'));
      assert.equal(new Set(dirs).size, dirs.length, '候选目录应去重');
    });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findExistingDir：按 marker 找第一个存在目录', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-datadir-'));
  try {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    fs.mkdirSync(a, { recursive: true });
    fs.mkdirSync(b, { recursive: true });
    fs.writeFileSync(path.join(b, 'models.json'), '{}');
    assert.equal(findExistingDir([a, b], 'models.json'), b);
    assert.equal(findExistingDir([a], 'models.json'), undefined);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('resolveWritableDir：跳过不可写候选，执行 prepare', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-datadir-'));
  try {
    const blocked = path.join(tmp, 'blocked');
    fs.writeFileSync(blocked, 'not a directory');
    const ok = path.join(tmp, 'ok');
    const dir = await resolveWritableDir([blocked, ok], async (d) => {
      await fs.promises.mkdir(path.join(d, 'raw'));
    });
    assert.equal(dir, ok);
    assert.ok(fs.existsSync(path.join(ok, 'raw')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('copyDir：递归复制', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-datadir-'));
  try {
    const from = path.join(tmp, 'from');
    const to = path.join(tmp, 'to');
    fs.mkdirSync(path.join(from, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(from, 'a.txt'), 'a');
    fs.writeFileSync(path.join(from, 'sub', 'b.txt'), 'b');
    copyDir(from, to);
    assert.equal(fs.readFileSync(path.join(to, 'a.txt'), 'utf8'), 'a');
    assert.equal(fs.readFileSync(path.join(to, 'sub', 'b.txt'), 'utf8'), 'b');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
