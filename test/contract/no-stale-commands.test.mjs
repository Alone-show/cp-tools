/**
 * 防回归：firmware 子插件不注册任何斜杠命令，提示里不能再让用户跑
 * `/firmware sync` / `/firmware login`（那只会把 sync/login 当自然语言喂给 skill）。
 * 同步/登录由 `/tickets` 的 ticket_sync / ticket_login 负责。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

test('源码不再提示不存在的 /firmware sync 或 /firmware login', () => {
  const hits = [];
  for (const file of walk(path.join(ROOT, 'src')).filter((p) => p.endsWith('.js'))) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, at) => {
      if (/\/firmware\s+(sync|login)\b/.test(line)) hits.push(`${path.relative(ROOT, file)}:${at + 1}`);
    });
  }
  assert.deepEqual(hits, [], `sync/login 应指向 /tickets，发现：${hits.join('、')}`);
});

test('包描述覆盖六个子插件（含 /tickets）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.description, /六个/, `package.description 的子插件数量不对：${pkg.description}`);
  for (const command of ['/cp-docs', '/firmware', '/tickets', '/cpservice', '/flash', '/bpms']) {
    assert.ok(pkg.description.includes(command), `package.description 缺 ${command}`);
  }
});
