#!/usr/bin/env node
/**
 * 在线冒烟：TB token 状态 + alist 可达性。无凭据/断网时输出 SKIP，不当作失败。
 *
 *   node scripts/live-smoke.mjs
 *
 * 只做只读检查，不写任何业务数据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { checkToken } from '../src/firmware/login.js';
import { createAlist } from '../src/firmware/alist.js';

function findUp(name, start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const tbfw = process.env.DSH_TBFW_DIR
  ? path.resolve(process.env.DSH_TBFW_DIR)
  : findUp('.tbfw');
const token = tbfw ? checkToken(tbfw) : { state: 'missing', file: '(未找到 .tbfw)' };

if (token.state === 'valid' || token.state === 'expiring') {
  console.log(`PASS TB token：${token.state}，剩余约 ${token.minutesLeft} 分钟`);
} else {
  console.log(`SKIP TB token：${token.state}（${token.file}）—— 先运行 npm run login`);
}

try {
  const alist = createAlist({ cacheFile: '' });
  const list = await alist.list('/PROD');
  if (list === null) {
    console.log('SKIP alist：请求失败（断网或服务不可达）');
  } else {
    console.log(`PASS alist：/PROD 返回 ${list.length} 个条目`);
  }
} catch (err) {
  console.log(`SKIP alist：${err.message}`);
}
