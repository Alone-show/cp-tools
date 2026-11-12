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

const { loadConfig, maskSecrets, configCandidates } = await import('../../src/bpms/config.js');
const { indexFields, resolveField, diffPaths, onlyInside, buildUpdateBody, summarize } = await import(
  '../../src/bpms/records.js'
);
const { TOOL_FACTORIES, compact, rowsOf } = await import('../../src/bpms/tools.js');
const { configView, applyConfigUpdate, normalizeValues } = await import('../../src/bpms/http.js');
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

step('四个工具名唯一且 schema 合法', () => {
  const tools = TOOL_FACTORIES.map((factory) => factory());
  assert.deepEqual(tools.map((t) => t.name), ['bpms_login', 'bpms_fields', 'bpms_get', 'bpms_update']);
  const names = new Set(tools.map((t) => t.name));
  assert.equal(names.size, 4);
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
  assert.deepEqual(registered.tools.sort(), ['bpms_fields', 'bpms_get', 'bpms_login', 'bpms_update']);
  assert.deepEqual(registered.skills, ['bpms']);
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
