#!/usr/bin/env node
/**
 * /bpms 离线冒烟：不联网、不读写真实 BPMS。
 * 覆盖：配置优先级与脱敏、按 label 寻址、diff 白名单、保存体形状、工具注册表。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bpms-smoke-'));

const configPath = path.join(TMP, 'bpms.json');
fs.writeFileSync(
  configPath,
  JSON.stringify({ base_url: 'https://bpms.example.test', username: 'u1', password: 'p1', tenant_name: '从平' }),
  { mode: 0o600 },
);
process.env.BPMS_CONFIG = configPath;
process.env.DSH_HOME = TMP; // token / 备份都写到测试目录，别碰真实 ~/.dsh

const { loadConfig, maskSecrets, configCandidates } = await import('../../src/bpms/config.js');
const { indexFields, resolveField, diffPaths, onlyInside, buildUpdateBody, summarize } = await import(
  '../../src/bpms/records.js'
);
const { TOOL_FACTORIES, compact, rowsOf, planAttachmentValue, fillAttachmentUrls, normalizeAttachmentItem } = await import('../../src/bpms/tools.js');
const { configView, applyConfigUpdate, normalizeValues, testLogin } = await import('../../src/bpms/http.js');
const bpms = await import('../../src/bpms/index.js');

let failed = 0;
function step(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}\n  ${error.message}`);
  }
}

const detail = {
  id: '2000550683162509709',
  requirementsNumber: 'CPS-SY2026DX0949',
  name: '订单需求表-示例',
  type: '正式',
  status: 0,
  orgName: '示例客户',
  customerId: 914,
  productId: '1815943458106413058',
  templateId: '1982701989500358657',
  templateName: 'FORM-ED-001 A13',
  expectedDeliveryDate: 1795017600000,
  createTime: 1794371756000,
  updateTime: 1794389543000,
  parameters: JSON.stringify({
    basicInfoList: [{ label: '品名', type: 'text', value: 'SPRING2 10特别版' }],
    orderSummaryList: [{ label: '特殊需求', type: 'textarea', value: '1、需要更新wifi和MDM固件' }],
    orderFittingList: [{ partNumber: 'P2018010006', name: 'RAM支架', number: '1' }],
    requireInfoList: [
      {
        label: '产品外观工艺',
        fieldList: [
          { label: '面壳', type: 'select', value: '特别版面壳（无中框）' },
          { label: '铭牌图样上传', type: 'upload', value: [{ name: 'a.png', url: 'https://oss/a.png' }] },
        ],
      },
      {
        label: '包装需求信息',
        fieldList: [
          { label: '彩盒', type: 'select', value: '中性' },
          { label: '彩盒图案上传', type: 'upload', value: [{ name: 'b.png', url: 'https://oss/b.png' }] },
          { label: '卡通箱图案上传', type: 'upload', value: [] },
        ],
      },
    ],
  }),
};

step('配置按 BPMS_CONFIG 命中，且能解析默认值', () => {
  const { config, path: hit, source } = loadConfig({ BPMS_CONFIG: configPath });
  assert.equal(source, 'env');
  assert.equal(hit, configPath);
  assert.equal(config.base_url, 'https://bpms.example.test');
  assert.equal(config.tenant_name, '从平');
  assert.equal(config.timeout_seconds, 20);
});

step('配置缺 username/password 时报 needs_config 并给出候选路径', () => {
  const empty = path.join(TMP, 'empty.json');
  fs.writeFileSync(empty, JSON.stringify({ base_url: 'https://x', username: '', password: '' }));
  assert.throws(
    () => loadConfig({ BPMS_CONFIG: empty }),
    (error) => error.code === 'needs_config' && Array.isArray(error.paths) && error.paths.length > 0,
  );
});

step('环境变量覆盖配置文件', () => {
  const { config } = loadConfig({ BPMS_CONFIG: configPath, BPMS_USERNAME: 'env-user', BPMS_TENANT: '测试租户' });
  assert.equal(config.username, 'env-user');
  assert.equal(config.tenant_name, '测试租户');
});

step('候选配置路径包含 DSH home 与插件目录', () => {
  const list = configCandidates({});
  assert.ok(list.some((p) => p.endsWith(path.join('cp-tools', 'bpms.json'))));
  assert.ok(list.some((p) => p.endsWith(path.join('cp-tools', 'bpms_config.json'))));
});

step('脱敏不泄漏 password/token', () => {
  const masked = maskSecrets({ username: 'u', password: 'secret', nested: { accessToken: 'tk', ok: 1 } });
  assert.equal(masked.password, '***');
  assert.equal(masked.nested.accessToken, '***');
  assert.equal(masked.nested.ok, 1);
});

step('按 分区/字段名 建索引', () => {
  const index = indexFields(JSON.parse(detail.parameters));
  const keys = index.map((entry) => entry.key);
  assert.ok(keys.includes('产品外观工艺/铭牌图样上传'));
  assert.ok(keys.includes('包装需求信息/彩盒'));
  assert.ok(keys.includes('基本信息/品名'));
  assert.ok(keys.includes('订单配置总结/特殊需求'));
  assert.ok(!keys.some((key) => key.includes('partNumber')), '配件表不参与 label 寻址');
});

step('寻址：精确、模糊、找不到时明确报错', () => {
  const index = indexFields(JSON.parse(detail.parameters));
  assert.equal(resolveField(index, '包装需求信息/彩盒').key, '包装需求信息/彩盒');
  assert.equal(resolveField(index, '彩盒').key, '包装需求信息/彩盒');
  assert.throws(() => resolveField(index, '不存在的字段'), (error) => error.code === 'not_found');
});

step('寻址：同名多份时报 ambiguous，不猜', () => {
  const index = indexFields({
    requireInfoList: [
      { label: '包装需求信息', fieldList: [{ label: '备注', type: 'text' }, { label: '备注', type: 'text' }] },
    ],
  });
  assert.throws(
    () => resolveField(index, '包装需求信息/备注'),
    (error) => error.code === 'ambiguous' && error.candidates.length === 2,
  );
});

step('diff 只认叶子路径，白名单外必须拒绝', () => {
  const before = JSON.parse(detail.parameters);
  const after = JSON.parse(JSON.stringify(before));
  after.requireInfoList[0].fieldList[1].value[0].url = 'https://oss/new.png';
  const diffs = diffPaths(before, after);
  assert.equal(diffs.length, 1);
  assert.equal(diffs[0].path, 'requireInfoList[0].fieldList[1].value[0].url');
  assert.ok(onlyInside(diffs, ['requireInfoList[0].fieldList[1]']));
  assert.ok(!onlyInside(diffs, ['requireInfoList[1].fieldList[0]']));

  after.status = 1;
  const withStatus = diffPaths(before, after);
  assert.ok(!onlyInside(withStatus, ['requireInfoList[0].fieldList[1]']));
});

step('保存体是整包回写，parameters 重新序列化为字符串', () => {
  const params = JSON.parse(detail.parameters);
  const body = buildUpdateBody(detail, params);
  assert.equal(body.id, detail.id);
  assert.equal(body.templateId, detail.templateId);
  assert.equal(body.status, detail.status);
  assert.equal(typeof body.parameters, 'string');
  assert.deepEqual(JSON.parse(body.parameters), params);
  assert.ok(!('createTime' in body), '不回写 createTime');
  assert.ok(!('updateTime' in body), '不回写 updateTime');
});

step('详情摘要只给结论字段', () => {
  const s = summarize(detail);
  assert.equal(s.requirementsNumber, 'CPS-SY2026DX0949');
  assert.ok(!('parameters' in s));
});

step('工具返回值可无损 JSON 化（丢 undefined、Date 转 ISO）', () => {
  const value = compact({ a: undefined, b: Number.NaN, c: new Date('2026-11-12T00:00:00Z'), d: [1, undefined] });
  assert.deepEqual(value, { b: null, c: '2026-11-12T00:00:00.000Z', d: [1, null] });
  assert.equal(compact(undefined), null);
  assert.equal(JSON.stringify(value), JSON.stringify(JSON.parse(JSON.stringify(value))));
});

step('列表响应两种形态都能取到 rows', () => {
  assert.equal(rowsOf({ records: [{ id: 1 }] }).length, 1);
  assert.equal(rowsOf({ data: { list: [{ id: 2 }] } }).length, 1);
  assert.equal(rowsOf({ data: [{ id: 3 }] }).length, 1);
  assert.equal(rowsOf({ data: null }).length, 0);
  assert.equal(rowsOf(null).length, 0);
});

step('五个工具名唯一且 schema 合法', () => {
  const tools = TOOL_FACTORIES.map((factory) => factory());
  assert.deepEqual(tools.map((t) => t.name), ['bpms_login', 'bpms_fields', 'bpms_get', 'bpms_update', 'bpms_upload']);
  const names = new Set(tools.map((t) => t.name));
  assert.equal(names.size, 5);
  for (const tool of tools) {
    assert.equal(typeof tool.execute, 'function', tool.name);
    assert.equal(tool.parameters.type, 'object', tool.name);
    assert.equal(typeof tool.output?.render, 'function', `${tool.name}.output.render`);
    assert.equal(typeof tool.output?.schema, 'object', `${tool.name}.output.schema`);
    assert.equal(tool.render, undefined, `${tool.name} 不能把 render 放在顶层`);
    const rendered = tool.output.render({}, { status: 'ok', message: '', record: {}, fields: [], changes: [] });
    assert.ok(Array.isArray(rendered) && rendered.length > 0, `${tool.name}.output.render 返回内容片`);
  }
  const update = tools.find((t) => t.name === 'bpms_update');
  assert.ok(update.parameters.properties.patch);
  assert.equal(update.parameters.properties.apply.type, 'boolean');
});

step('skill 与插件导出符合契约', () => {
  assert.equal(bpms.name, 'cp-bpms');
  assert.deepEqual(bpms.inject, ['tools', 'skills']);
  const skill = bpms.readBundledSkill();
  assert.equal(skill.name, 'bpms');
  assert.ok(skill.description.length > 0);
  assert.ok(!/[<>]/.test(skill.description));
  assert.ok(skill.content.includes('登录流程'));
  assert.ok(skill.content.includes('寻址规则'));
  // 订单链路（与 flash / cpservice 联动）的硬规则不许被删
  for (const kw of ['订单链路', '软件需求信息/OS版本', 'expectStatus', 'merge-package.sh', '暂存', '等用户说']) {
    assert.ok(skill.content.includes(kw), `SKILL.md 缺订单链路关键词：${kw}`);
  }
});

step('Web 配置接口：首次读取是 missing，保存后可读且密码不回显', () => {
  const target = path.join(TMP, 'web', 'bpms.json');
  const initial = configView(target);
  assert.equal(initial.exists, false);
  assert.equal(initial.revision, 'missing');
  assert.equal(initial.secrets.password.set, false);

  const saved = applyConfigUpdate(
    {
      revision: 'missing',
      values: { base_url: 'https://bpms.test', username: 'u2', tenant_name: '从平', timeout_seconds: 25 },
      password: { action: 'set', value: 'p2' },
    },
    target,
  );
  assert.equal(saved.exists, true);
  assert.equal(saved.values.username, 'u2');
  assert.equal(saved.secrets.password.set, true);
  assert.ok(!JSON.stringify(saved).includes('p2'), '密码不能出现在视图里');
  const mode = fs.statSync(target).mode & 0o777;
  assert.equal(mode, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).password, 'p2');
});

step('Web 配置接口：revision 过期拒绝覆盖，保留未知键', () => {
  const target = path.join(TMP, 'web', 'bpms.json');
  const view = configView(target);
  assert.throws(
    () => applyConfigUpdate({ revision: 'stale', values: { username: 'x' } }, target),
    (error) => error.code === 'stale' && error.status === 409,
  );
  const data = JSON.parse(fs.readFileSync(target, 'utf8'));
  data.extra_flag = 'keep-me';
  fs.writeFileSync(target, JSON.stringify(data, null, 2));
  const next = applyConfigUpdate(
    { revision: configView(target).revision, values: { username: 'u3' } },
    target,
  );
  assert.equal(next.values.username, 'u3');
  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).extra_flag, 'keep-me');
});

step('Web 配置接口：非法值拒绝，清空密码会被拦', () => {
  const target = path.join(TMP, 'web2', 'bpms.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ username: 'u', password: 'p', tenant_name: '从平' }));
  const revision = configView(target).revision;
  assert.throws(
    () => applyConfigUpdate({ revision, values: { base_url: 'ftp://x' } }, target),
    (error) => error.code === 'invalid' && error.field === 'base_url',
  );
  assert.throws(
    () => applyConfigUpdate({ revision, password: { action: 'clear' } }, target),
    (error) => error.code === 'invalid',
  );
  assert.throws(() => normalizeValues({ timeout_seconds: 1000 }), (error) => error.code === 'invalid');
});

step('试登录：未保存配置也能用页面上的账号验证', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: init.body });
    if (url.includes('get-id-by-name')) return new Response(JSON.stringify({ code: 0, data: 1 }), { status: 200 });
    if (url.includes('/auth/login')) {
      return new Response(
        JSON.stringify({ code: 0, data: { accessToken: 'tk', refreshToken: 'rf', userId: 155, expiresTime: Date.now() + 3600_000 } }),
        { status: 200 },
      );
    }
    return new Response('{}', { status: 404 });
  };
  const ok = await testLogin({ username: 'u', password: 'p' }, { fetchImpl, env: {} });
  assert.equal(ok.ok, true);
  assert.equal(ok.userId, 155);
  assert.equal(calls.length, 2);

  const failImpl = async (url) => {
    if (url.includes('get-id-by-name')) return new Response(JSON.stringify({ code: 0, data: 1 }), { status: 200 });
    return new Response(JSON.stringify({ code: 1, msg: '密码错误' }), { status: 200 });
  };
  const bad = await testLogin({ username: 'u', password: 'x' }, { fetchImpl: failImpl });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /密码错误/);
});

step('浏览器 bundle 能加载并注册插件页', () => {
  const file = path.join(ROOT, 'src', 'bpms', 'web-client.js');
  const calls = [];
  const sandbox = { window: { __ModuleLoader__: { load: (spec) => calls.push(spec) } }, console };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id, '@local/cp-tools');
  assert.equal(typeof calls[0].factory, 'function');

  const fakeReact = {
    createElement: () => ({}),
    useState: (initial) => [initial, () => {}],
    useCallback: (fn) => fn,
    useEffect: () => {},
  };
  const fakeUi = { SettingsValueField: () => ({}), SettingsSecretField: () => ({}), SettingsForm: () => ({}) };
  const mod = calls[0].factory((name) => (name === 'react' ? fakeReact : fakeUi));
  assert.deepEqual([...mod.inject], ['slots', 'locale']);

  const registered = { slots: [], locales: [] };
  mod.apply({
    effect: (fn) => fn(),
    locale: { register: (ns) => registered.locales.push(ns) },
    slots: {
      inject: (_name, fn) => fn(),
      register: (descriptor) => registered.slots.push(descriptor),
    },
  });
  assert.deepEqual(registered.locales, ['settings.cp-tools-bpms']);
  assert.equal(registered.slots[0].key, '@local/cp-tools');
  assert.equal(registered.slots[0].name, 'plugins.bundle.config');
});

step('apply 能把工具和 skill 注册进 ctx', () => {
  const registered = { tools: [], skills: [] };
  const ctx = {
    effect(fn) {
      fn();
    },
    tools: { register: (tool) => registered.tools.push(tool.name) },
    skills: { register: (skill) => registered.skills.push(skill.name) },
  };
  bpms.apply(ctx);
  assert.deepEqual(registered.tools.sort(), ['bpms_fields', 'bpms_get', 'bpms_login', 'bpms_update', 'bpms_upload']);
  assert.deepEqual(registered.skills, ['bpms']);
});


// ── 附件上传与状态门（离线：stub 掉 fetch，不碰真实 BPMS）────────────────────
async function stepAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}\n  ${error.message}`);
  }
}

/** 记录所有请求；按 URL 子串路由到假响应。 */
function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    const method = String(init.method ?? 'GET').toUpperCase();
    calls.push({ href, method, init });
    for (const [needle, handler] of routes) {
      if (href.includes(needle)) {
        const body = await handler({ href, method, init });
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ code: 501, msg: `no route: ${href}` }), { status: 200 });
  };
  return calls;
}

const loginRoutes = [
  ['/tenant/get-id-by-name', () => ({ code: 0, data: 1 })],
  ['/auth/login', () => ({ code: 0, data: { accessToken: 'test-token', expiresTime: Date.now() + 3600_000, userId: 1 } })],
];
const toolByName = (name) => TOOL_FACTORIES.map((factory) => factory()).find((tool) => tool.name === name);
const tmpZip = path.join(TMP, 'pkg.zip');
fs.writeFileSync(tmpZip, 'PK\u0003\u0004fake');

await stepAsync('bpms_upload：multipart 字段 file，返回 url，不泄漏 token', async () => {
  const calls = stubFetch([
    ...loginRoutes,
    ['/infra/file/upload', () => ({ code: 0, data: 'https://oss.example/up/demo.zip' })],
  ]);
  const result = await toolByName('bpms_upload').execute({ path: tmpZip, name: 'demo_20261112.zip' });
  assert.equal(result.status, 'ok');
  assert.equal(result.file.url, 'https://oss.example/up/demo.zip');
  assert.equal(result.file.name, 'demo_20261112.zip');
  const up = calls.find((call) => call.href.includes('/infra/file/upload'));
  assert.ok(up, '应当调用上传接口');
  assert.equal(up.method, 'POST');
  assert.ok(up.init.body instanceof FormData, 'body 必须是 FormData');
  assert.ok(up.init.body.has('file'), 'multipart 字段名必须是 file');
  assert.notEqual(String(up.init.headers['Content-Type'] ?? ''), 'application/json');
  assert.ok(!JSON.stringify(result).includes('test-token'), '工具返回值不能带 accessToken');
});

await stepAsync('expectStatus 不符：不下载/不上传/不写库', async () => {
  const calls = stubFetch([
    ...loginRoutes,
    ['/order-requirements/detail/', () => ({ ...detail, status: 3 })],
  ]);
  const result = await toolByName('bpms_update').execute({
    id: detail.id,
    patch: { '包装需求信息/卡通箱图案上传': [{ path: tmpZip }] },
    expectStatus: 0,
  });
  assert.equal(result.status, 'status_mismatch');
  assert.equal(result.currentStatus, 3);
  assert.equal(calls.some((call) => call.href.includes('/infra/file/upload')), false, '不该上传');
  assert.equal(calls.some((call) => call.href.includes('/update')), false, '不该写库');
});

await stepAsync('dry-run 带本地文件：只校验，不上传', async () => {
  const calls = stubFetch([...loginRoutes, ['/order-requirements/detail/', () => detail]]);
  const result = await toolByName('bpms_update').execute({
    id: detail.id,
    patch: { '包装需求信息/卡通箱图案上传': [{ path: tmpZip, name: 'c.zip' }] },
    expectStatus: 0,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.applied, false);
  assert.equal(result.uploads?.length, 1);
  assert.equal(result.uploads[0].name, 'c.zip');
  assert.equal(calls.some((call) => call.href.includes('/infra/file/upload')), false, 'dry-run 不该上传');
});

await stepAsync('apply：先上传再把 url 写进附件字段', async () => {
  const calls = stubFetch([
    ...loginRoutes,
    ['/infra/file/upload', () => ({ code: 0, data: 'https://oss.example/up/c.zip' })],
    ['/order-requirements/update', () => ({ code: 0, data: true })],
    ['/order-requirements/detail/', () => detail],
  ]);
  const result = await toolByName('bpms_update').execute({
    id: detail.id,
    patch: { '包装需求信息/卡通箱图案上传': [{ path: tmpZip, name: 'c.zip' }] },
    expectStatus: 0,
    apply: true,
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.uploaded?.length, 1);
  const update = calls.find((call) => call.href.includes('/order-requirements/update'));
  assert.ok(update, '应当写库');
  const body = JSON.parse(update.init.body);
  assert.ok(body.parameters.includes('https://oss.example/up/c.zip'), '写库时应带真实 url');
  assert.ok(!body.parameters.includes('local:'), '不能把本地占位写进库');
});

step('附件项归一与 append 去重', () => {
  assert.deepEqual(normalizeAttachmentItem('https://oss/a.zip'), { url: 'https://oss/a.zip', name: 'a.zip' });
  assert.equal(normalizeAttachmentItem('~/x/y.zip').name, 'y.zip');
  assert.equal(normalizeAttachmentItem({ path: '/tmp/a.zip', name: '显示名.zip' }).name, '显示名.zip');
  assert.equal(normalizeAttachmentItem({}), null);

  const pending = [];
  const entry = { key: '包装需求信息/卡通箱图案上传' };
  const prev = [{ name: 'c.zip', url: 'https://oss/c.zip', uid: 1, status: 'success' }];
  const appended = planAttachmentValue({
    entry,
    raw: [{ url: 'https://oss/c.zip' }, { url: 'https://oss/d.zip' }],
    prev,
    mode: 'append',
    pending,
  });
  assert.equal(appended.length, 2, '同 url 不重复追加');
  assert.equal(pending.length, 0);
});

step('fillAttachmentUrls 回填 local: 占位', () => {
  const params = {
    requireInfoList: [
      { label: '包装需求信息', fieldList: [{ label: '卡通箱图案上传', type: 'upload', value: [{ name: 'c.zip', url: 'local:/tmp/a.zip' }] }] },
    ],
  };
  fillAttachmentUrls(params, [{ path: '/tmp/a.zip', name: 'c.zip', url: 'https://oss/c.zip', size: 3 }]);
  const value = params.requireInfoList[0].fieldList[0].value[0];
  assert.equal(value.url, 'https://oss/c.zip');
  assert.equal(value.status, 'success');
  delete globalThis.fetch;
});

step('插件里不写死本机绝对路径', () => {
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p, out);
      else if (/\.(js|json|md)$/.test(p)) out.push(p);
    }
    return out;
  };
  const home = os.homedir();
  const bad = walk(path.join(ROOT, 'src', 'bpms')).filter((file) => fs.readFileSync(file, 'utf8').includes(home));
  assert.deepEqual(bad, []);
});

fs.rmSync(TMP, { recursive: true, force: true });
if (failed > 0) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\nBPMS 冒烟通过');
