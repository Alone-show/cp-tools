/**
 * /bpms 的工具：登录、字段列表、读记录、改记录、上传附件。
 *
 * 约定：
 *   - 默认 dry-run，只有 apply:true 才写库
 *   - 附件项的 {path} 只在 apply 时才上传；dry-run 只校验文件
 *   - 写前备份 + updateTime 并发校验 + 写后白名单 diff
 *   - 任何返回值都不含密码/token
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, permissionWarning, writeBackup } from './config.js';
import { BpmsError, createClient } from './client.js';
import {
  buildUpdateBody,
  diffPaths,
  indexFields,
  onlyInside,
  parseParameters,
  resolveField,
  summarize,
} from './records.js';

const DETAIL = (id) => `/admin-api/crm/order-requirements/detail/${id}`;
const UPDATE = '/admin-api/crm/order-requirements/update';
const UPLOAD = '/admin-api/infra/file/upload';
const UPLOAD_DIRECTORY = 'bpms';
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

const STATUS = [
  'ok',
  'needs_config',
  'auth_failed',
  'not_found',
  'ambiguous',
  'conflict',
  'rejected',
  'error',
  'status_mismatch',
];

function text(render) {
  return (_args, value) => {
    const lines = render(value);
    return [{ type: 'text', text: lines.filter(Boolean).join('\n') }];
  };
}


/** 只保留可无损 JSON 化的值：丢掉 undefined，Date 转 ISO，NaN/Infinity 转 null。 */
function compact(value) {
  if (value === undefined) return null;
  return JSON.parse(
    JSON.stringify(value, (_key, item) => {
      if (item === undefined) return undefined;
      if (typeof item === 'number' && !Number.isFinite(item)) return null;
      return item;
    }) ?? 'null',
  );
}

/** 把工具定义从顶层 render 改成契约要求的 output.render，并保证返回值可无损 JSON 化。 */
function tool(definition) {
  const { render, execute, ...rest } = definition;
  return {
    ...rest,
    output: { ...rest.output, render },
    async execute(args, exec) {
      return compact(await execute(args, exec));
    },
  };
}

function fail(error) {
  const status =
    error instanceof BpmsError || error?.name === 'ConfigError'
      ? error.code === 'needs_config'
        ? 'needs_config'
        : error.code === 'auth_failed'
          ? 'auth_failed'
          : error.code === 'not_found'
            ? 'not_found'
            : error.code === 'ambiguous'
              ? 'ambiguous'
              : error.code === 'conflict'
                ? 'conflict'
                : 'error'
      : 'error';
  return {
    status,
    message: error?.message ?? String(error),
    ...(error?.paths ? { paths: error.paths } : {}),
    ...(error?.template ? { template: configTemplateForTool() } : {}),
    ...(error?.candidates ? { candidates: error.candidates } : {}),
    ...(error?.hint ? { hint: error.hint } : {}),
    ...(error?.uploaded ? { uploaded: error.uploaded } : {}),
  };
}

function configTemplateForTool() {
  return {
    base_url: 'https://bpms.cpuniverse.cn',
    username: '<BPMS 用户名>',
    password: '<BPMS 密码>',
    tenant_name: '从平',
  };
}

function makeClient(options = {}) {
  const { config } = loadConfig();
  return { client: createClient(config, options), config };
}

/** 上传按体积放宽超时：8 MB 实测约 4 s，30 MB 左右要十几秒，默认 20 s 会被掐断。 */
function makeUploadClient(sizeBytes) {
  const { config } = loadConfig();
  const mb = Number(sizeBytes || 0) / (1024 * 1024);
  const timeout_seconds = Math.max(Number(config.timeout_seconds) || 20, Math.ceil(30 + mb * 2));
  return createClient({ ...config, timeout_seconds });
}

function expandHomePath(value) {
  const raw = String(value ?? '').trim();
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
}

function humanSize(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

/** 上传前把文件校验一遍：存在、是文件、没超上限。不读内容，避免 dry-run 时白读几十 MB。 */
function assertUploadable(filePath) {
  const abs = path.resolve(expandHomePath(filePath));
  let stat;
  try {
    stat = fs.statSync(abs);
  } catch {
    throw new BpmsError('bad_query', `找不到本地文件：${filePath}`);
  }
  if (!stat.isFile()) throw new BpmsError('bad_query', `不是文件：${filePath}`);
  if (stat.size > MAX_UPLOAD_BYTES) {
    throw new BpmsError('bad_query', `文件 ${filePath} 有 ${humanSize(stat.size)}，超过 ${humanSize(MAX_UPLOAD_BYTES)} 上限`);
  }
  return { abs, size: stat.size };
}

/** 本地文件 → BPMS 附件存储，返回 { name, url, size }。 */
async function uploadLocalFile(filePath, displayName, directory = UPLOAD_DIRECTORY) {
  const { abs, size } = assertUploadable(filePath);
  const client = makeUploadClient(size);
  const buffer = await fs.promises.readFile(abs);
  const form = new FormData();
  form.append('file', new Blob([buffer]), path.basename(abs));
  if (directory) form.append('directory', String(directory).replace(/^\/+|\/+$/g, ''));
  const payload = await client.request(UPLOAD, { method: 'POST', form });
  const url = typeof payload?.data === 'string' ? payload.data : payload?.data?.url;
  if (!url) throw new BpmsError('error', '上传接口没有返回文件地址');
  return { name: String(displayName || path.basename(abs)), url, size };
}

/** 附件项归一：字符串（url 或本地路径）、{url,name}、{path,name} 都接受。 */
function normalizeAttachmentItem(item) {
  if (typeof item === 'string' && item.trim()) {
    const raw = item.trim();
    if (/^https?:\/\//i.test(raw)) return { url: raw, name: raw.split('/').pop() };
    return { path: expandHomePath(raw), name: path.basename(expandHomePath(raw)) };
  }
  if (!item || typeof item !== 'object') return null;
  const name = item.name ? String(item.name) : '';
  if (item.path) {
    const abs = expandHomePath(item.path);
    return { path: abs, name: name || path.basename(abs) };
  }
  if (item.url) return { name: name || String(item.url).split('/').pop(), url: String(item.url) };
  return null;
}

function fieldValueLabel(entry) {
  const value = entry.item?.value;
  if (entry.item?.type === 'upload') {
    const files = Array.isArray(value) ? value : [];
    return `[附件 ${files.length} 个] ${files.map((f) => f?.name ?? '').filter(Boolean).join(', ')}`.trim();
  }
  if (Array.isArray(value)) return value.join(' / ');
  if (value === undefined || value === null || value === '') return '(空)';
  const s = String(value);
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export function loginTool() {
  return tool({
    name: 'bpms_login',
    description:
      '用插件配置里的 BPMS 账号登录并缓存 token。账号密码填在 ~/.dsh/cp-tools/bpms.json 或插件目录 bpms_config.json（字段：base_url/username/password/tenant_name）。配置缺失时返回应为哪个文件、填什么。',
    parameters: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: '强制重新登录，忽略缓存 token，默认 false' },
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS },
          message: { type: 'string' },
          userId: { type: 'integer' },
          tenantId: { type: 'integer' },
          configPath: { type: 'string' },
          expiresAt: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          template: { type: 'object' },
        },
      },
    },
    render: text((r) =>
      r.status === 'ok'
        ? [
            `BPMS 登录成功：userId=${r.userId}，tenant=${r.tenantId}`,
            `配置：${r.configPath}`,
            `token 过期时间：${r.expiresAt}`,
          ]
        : [`登录失败（${r.status}）：${r.message}`, r.paths?.length ? `可写入的配置文件：\n  ${r.paths.join('\n  ')}` : ''],
    ),
    async execute(args = {}) {
      try {
        const { config, path } = loadConfig();
        const client = createClient(config);
        const token = await client.login(Boolean(args.force));
        return {
          status: 'ok',
          userId: Number(token.userId ?? 0) || undefined,
          tenantId: client.tenantId ?? undefined,
          configPath: path,
          expiresAt: token.expiresTime ? new Date(token.expiresTime).toISOString() : undefined,
          warning: permissionWarning(path) || undefined,
        };
      } catch (error) {
        return fail(error);
      }
    },
  });
}

export function fieldsTool() {
  return tool({
    name: 'bpms_fields',
    description:
      '列出某张订单需求表里所有可按「分区/字段名」寻址的字段及其当前值（附件只显示文件名与数量）。改字段前先用它确认字段名。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '订单需求主键（详情页 URL 里的数字 id）' },
        filter: { type: 'string', description: '可选。只显示 key 里包含该子串的字段' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS },
          message: { type: 'string' },
          id: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                type: { type: 'string' },
                value: { type: 'string' },
                path: { type: 'string' },
              },
            },
          },
        },
      },
    },
    render: text((r) =>
      r.status === 'ok'
        ? [`记录 ${r.id} 的字段（${r.fields.length} 个）：`, ...r.fields.map((f) => `- ${f.key}  [${f.type}]  ${f.value}`)]
        : [`失败（${r.status}）：${r.message}`],
    ),
    async execute(args = {}) {
      try {
        const id = String(args.id ?? '').trim();
        if (!id) throw new BpmsError('bad_query', '需要 id');
        const { client } = makeClient();
        const detail = await client.request(DETAIL(id));
        const parameters = parseParameters(detail);
        const filter = String(args.filter ?? '').trim();
        const fields = indexFields(parameters)
          .filter((entry) => !filter || entry.key.includes(filter))
          .map((entry) => ({
            key: entry.key,
            type: String(entry.item?.type ?? ''),
            value: fieldValueLabel(entry),
            path: entry.path,
          }));
        return { status: 'ok', id, fields };
      } catch (error) {
        return fail(error);
      }
    },
  });
}

export function getTool() {
  return tool({
    name: 'bpms_get',
    description:
      '读取一张订单需求表：返回编号/客户/型号/状态/交期等摘要；传 fields 可附带指定字段的值。不返回整包 JSON。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '订单需求主键；也可以直接给需求编号 CPS-SY…（会先按列表接口查 id）' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: '可选。要附带取值的字段，如 ["产品外观工艺/铭牌图样上传"]',
        },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS },
          message: { type: 'string' },
          record: { type: 'object' },
          fields: { type: 'array', items: { type: 'object' } },
        },
      },
    },
    render: text((r) =>
      r.status === 'ok'
        ? [
            `${r.record.requirementsNumber ?? r.record.id}  ${r.record.name ?? ''}`,
            `客户：${r.record.orgName ?? ''}   状态：${r.record.status}   模板：${r.record.templateName ?? ''}`,
            `交期：${r.record.expectedDeliveryDate ? new Date(r.record.expectedDeliveryDate).toISOString().slice(0, 10) : ''}   更新：${r.record.updateTime ? new Date(r.record.updateTime).toISOString() : ''}`,
            ...(r.fields ?? []).map((f) => `- ${f.key} [${f.type}] ${f.value}`),
          ]
        : [`失败（${r.status}）：${r.message}`],
    ),
    async execute(args = {}) {
      try {
        const id = await resolveId(String(args.id ?? '').trim());
        const { client } = makeClient();
        const detail = await client.request(DETAIL(id));
        const parameters = parseParameters(detail);
        const index = indexFields(parameters);
        const picked = [];
        for (const query of args.fields ?? []) {
          const entry = resolveField(index, query);
          picked.push({ key: entry.key, type: String(entry.item?.type ?? ''), value: fieldValueLabel(entry) });
        }
        return { status: 'ok', record: summarize(detail), fields: picked };
      } catch (error) {
        return fail(error);
      }
    },
  });
}

/** select-list 的响应有两种形态：直出分页对象，或 {code,data:{list}}。 */
function rowsOf(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.records)) return payload.records;
  if (Array.isArray(payload.list)) return payload.list;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.data?.records)) return payload.data.records;
  if (Array.isArray(payload.data?.list)) return payload.data.list;
  return [];
}

/** 需求编号 → 主键：先用 requirementsNumber 过滤（服务端支持），没命中再翻页扫。 */
export async function resolveId(input) {
  if (!input) throw new BpmsError('bad_query', '需要 id 或需求编号');
  if (/^\d{6,}$/.test(input)) return input;
  const { client } = makeClient();
  const listPath = '/admin-api/crm/order-requirements/select-list';
  const pick = (rows) => rows.filter((row) => String(row?.requirementsNumber ?? '') === input).map((row) => String(row.id));

  const filtered = await client.request(listPath, {
    method: 'POST',
    body: { pageNo: 1, pageSize: 50, requirementsNumber: input },
  });
  const direct = [...new Set(pick(rowsOf(filtered)))];
  if (direct.length === 1) return direct[0];
  if (direct.length > 1) throw new BpmsError('ambiguous', `需求编号 ${input} 命中多条记录`, { candidates: direct });

  const hits = [];
  for (let pageNo = 1; pageNo <= 10; pageNo += 1) {
    const payload = await client.request(listPath, { method: 'POST', body: { pageNo, pageSize: 100 } });
    const rows = rowsOf(payload);
    hits.push(...pick(rows));
    const total = Number(payload?.total ?? payload?.data?.total ?? 0);
    if (rows.length < 100) break;
    if (Number.isFinite(total) && total > 0 && pageNo * 100 >= total) break;
  }
  const unique = [...new Set(hits)];
  if (unique.length === 1) return unique[0];
  if (unique.length === 0) throw new BpmsError('not_found', `找不到需求编号 ${input}`);
  throw new BpmsError('ambiguous', `需求编号 ${input} 命中多条记录`, { candidates: unique });
}

export function updateTool() {
  return tool({
    name: 'bpms_update',
    description:
      '改订单需求表的字段：默认 dry-run 只返回 diff；apply:true 才写库（写前备份、校验 updateTime、写后只允许白名单内的字段变化）。patch 的键是 bpms_fields 返回的「分区/字段名」。附件字段可以给本地文件 [{path:"/abs/x.zip"}]，apply 时才上传；expectStatus 可在订单状态不符时中止（上传安装包传 0=暂存）。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '订单需求主键' },
        patch: {
          type: 'object',
          description:
            '要改的字段：{ "分区/字段名": 新值 }。文本/下拉直接给字符串，多选给数组；附件给 [{name,url}] 或 [{path:"/abs/x.zip",name:"显示名"}]（path 只在 apply 时上传）',
        },
        apply: { type: 'boolean', description: 'true 才真正写库；默认 false（dry-run）' },
        expectStatus: {
          type: 'number',
          description: '可选。要求记录当前状态等于该值，否则返回 status_mismatch、不写库也不上传（0=暂存）',
        },
        attachmentMode: {
          type: 'string',
          enum: ['replace', 'append'],
          description: '附件字段写入方式：replace=整字段替换（默认），append=在现有附件后按 url 去重追加',
        },
        restoreFrom: { type: 'string', description: '可选。用备份文件恢复该记录（忽略 patch）' },
      },
      required: ['id'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS },
          message: { type: 'string' },
          id: { type: 'string' },
          applied: { type: 'boolean' },
          changes: { type: 'array', items: { type: 'object' } },
          backupPath: { type: 'string' },
          rejected: { type: 'array', items: { type: 'object' } },
          currentStatus: { type: 'number' },
          expectedStatus: { type: 'number' },
          uploads: { type: 'array', items: { type: 'object' } },
          uploaded: { type: 'array', items: { type: 'object' } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    render: text((r) => {
      if (r.status === 'status_mismatch') {
        return [
          `订单状态是 ${r.currentStatus}，不是 expectStatus=${r.expectedStatus}：按约定不写库、不上传。`,
          r.message ?? '',
        ];
      }
      if (r.status !== 'ok') {
        return [
          `失败（${r.status}）：${r.message}`,
          r.uploaded?.length ? `已上传但未写库：${r.uploaded.map((u) => u.url).join(', ')}` : '',
        ];
      }
      const head = r.applied ? `已保存 ${r.id}` : `dry-run（未写库）${r.id}`;
      return [
        head,
        ...r.changes.map((c) => `- ${c.key}: ${c.before} → ${c.after}`),
        r.uploads?.length ? `待上传（apply 时执行）：${r.uploads.map((u) => u.name).join(', ')}` : '',
        r.uploaded?.length ? `已上传：${r.uploaded.map((u) => u.url).join(', ')}` : '',
        r.backupPath ? `备份：${r.backupPath}` : '',
        r.rejected?.length ? `被拒绝的改动：${r.rejected.map((x) => x.path).join(', ')}` : '',
      ];
    }),
    async execute(args = {}) {
      const id = String(args.id ?? '').trim();
      try {
        if (!id) throw new BpmsError('bad_query', '需要 id');
        const { client } = makeClient();

        if (args.restoreFrom) return await restore(client, id, String(args.restoreFrom));

        const patch = args.patch ?? {};
        if (typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length === 0) {
          throw new BpmsError('bad_query', 'patch 不能为空');
        }

        const before = await client.request(DETAIL(id));
        if (args.expectStatus !== undefined && args.expectStatus !== null) {
          const expected = Number(args.expectStatus);
          if (!Number.isFinite(expected)) throw new BpmsError('bad_query', 'expectStatus 必须是数字');
          if (Number(before.status) !== expected) {
            return {
              status: 'status_mismatch',
              id,
              currentStatus: Number(before.status),
              expectedStatus: expected,
              message: `订单状态是 ${before.status}，不是 ${expected}；已按约定中止（未上传、未写库）`,
            };
          }
        }

        const beforeParams = parseParameters(before);
        const index = indexFields(beforeParams);

        const next = JSON.parse(JSON.stringify(beforeParams));
        const nextIndex = indexFields(next);
        const changes = [];
        const mode = args.attachmentMode === 'append' ? 'append' : 'replace';
        const pending = [];
        for (const [key, value] of Object.entries(patch)) {
          const entry = resolveField(index, key);
          const target = resolveField(nextIndex, entry.key);
          const prev = target.item?.value;
          const isUpload = String(entry.item?.type ?? '') === 'upload';
          target.item.value = isUpload
            ? planAttachmentValue({ entry, raw: value, prev, mode, pending })
            : cloneValue(value);
          changes.push({
            key: entry.key,
            path: entry.path,
            before: fieldValueLabel({ item: { type: entry.item?.type, value: prev } }),
            after: fieldValueLabel({ item: { type: entry.item?.type, value: target.item.value } }),
          });
        }

        const diffs = diffPaths(beforeParams, next);
        const allowed = changes.map((c) => c.path);
        const rejected = diffs.filter((diff) => !onlyInside([diff], allowed));
        if (rejected.length > 0) {
          return { status: 'rejected', id, message: '有超出 patch 范围的改动，已中止', rejected };
        }

        const planned = pending.map((p) => ({ name: p.name, path: p.path, size: assertUploadable(p.path).size }));
        if (!args.apply) {
          return { status: 'ok', id, applied: false, changes, uploads: planned.length ? planned : undefined };
        }

        const uploaded = [];
        for (const item of pending) {
          try {
            uploaded.push({ ...(await uploadLocalFile(item.path, item.name)), path: item.path });
          } catch (error) {
            throw new BpmsError(
              'error',
              `上传 ${item.name} 失败：${error?.message ?? error}${uploaded.length ? `（已上传 ${uploaded.length} 个文件，未写库，会在存储里留下孤儿文件）` : ''}`,
              { uploaded },
            );
          }
        }
        if (uploaded.length) fillAttachmentUrls(next, uploaded);

        const fresh = await client.request(DETAIL(id));
        if (Number(fresh.updateTime) !== Number(before.updateTime)) {
          return {
            status: 'conflict',
            id,
            message: '这条记录刚被别人改过（updateTime 变化），已中止；本地文件已上传但未写库',
            uploaded: uploaded.length ? uploaded : undefined,
          };
        }

        const backupPath = writeBackup(id, before);
        await client.request(UPDATE, { method: 'POST', body: buildUpdateBody(before, next) });

        const after = await client.request(DETAIL(id));
        const afterParams = parseParameters(after);
        const afterDiffs = diffPaths(beforeParams, afterParams);
        const unexpected = afterDiffs.filter((diff) => !onlyInside([diff], allowed));
        if (unexpected.length > 0) {
          return {
            status: 'error',
            id,
            message: '保存成功，但回读到的改动超出 patch 范围，请用备份恢复后复核',
            applied: true,
            changes,
            backupPath,
            uploaded: uploaded.length ? uploaded : undefined,
            rejected: unexpected,
          };
        }

        return {
          status: 'ok',
          id,
          applied: true,
          changes,
          backupPath,
          uploaded: uploaded.length ? uploaded : undefined,
          appliedDiffs: afterDiffs.length,
        };
      } catch (error) {
        return fail(error);
      }
    },
  });
}

/** 附件字段的值规划：{path} 先用 local: 占位，apply 时再替换成真实 url。 */
function planAttachmentValue({ entry, raw, prev, mode, pending }) {
  const incoming = (Array.isArray(raw) ? raw : [raw]).filter((item) => item !== null && item !== undefined && item !== '');
  const items = incoming.map(normalizeAttachmentItem);
  if (items.length === 0 || items.some((item) => !item)) {
    throw new BpmsError('bad_query', `${entry.key}：附件项要写 {path:"本地文件"} 或 {name,url}`);
  }
  const planned = [];
  for (const [i, item] of items.entries()) {
    if (item.url) {
      planned.push({ name: item.name, url: item.url, uid: Date.now() + i, status: 'success' });
      continue;
    }
    const { abs, size } = assertUploadable(item.path);
    pending.push({ path: abs, name: item.name || path.basename(abs), size });
    planned.push({ name: item.name || path.basename(abs), url: `local:${abs}`, uid: 0, status: 'pending' });
  }
  if (mode !== 'append') return planned;

  const existing = (Array.isArray(prev) ? prev : []).filter(Boolean).map((item) => cloneValue(item));
  const seen = new Set(existing.map((item) => item?.url).filter(Boolean));
  for (const item of planned) {
    if (seen.has(item.url)) continue;
    existing.push(item);
    seen.add(item.url);
  }
  return existing;
}

/** 把 local: 占位换成真实上传结果（递归处理整包 parameters）。 */
function fillAttachmentUrls(value, uploaded) {
  const byPath = new Map(uploaded.map((item) => [item.path, item]));
  const stamp = Date.now();
  const walk = (node) => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.url === 'string' && node.url.startsWith('local:')) {
      const hit = byPath.get(node.url.slice('local:'.length));
      if (hit) return { name: hit.name, url: hit.url, uid: stamp, status: 'success' };
    }
    const out = {};
    for (const [key, item] of Object.entries(node)) out[key] = walk(item);
    return out;
  };
  for (const key of Object.keys(value)) value[key] = walk(value[key]);
  return value;
}

function cloneValue(value) {
  return value === null || typeof value !== 'object' ? value : JSON.parse(JSON.stringify(value));
}

async function restore(client, id, file) {
  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (String(backup.id) !== String(id)) {
    throw new BpmsError('rejected', `备份文件属于记录 ${backup.id}，不是 ${id}`);
  }
  const current = await client.request(DETAIL(id));
  const parameters = parseParameters(backup);
  await client.request(UPDATE, { method: 'POST', body: buildUpdateBody(current, parameters) });
  return { status: 'ok', id, applied: true, changes: [{ key: '(restore)', before: '(current)', after: `恢复自 ${file}` }] };
}

export function uploadTool() {
  return tool({
    name: 'bpms_upload',
    description:
      '把本地文件传到 BPMS 附件存储，返回可直接写进附件字段的 {name,url}。不写库；一般用 bpms_update 的 {path} 一步到位，需要先拿 url 时才单独调。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '本地文件路径，支持 ~/' },
        name: { type: 'string', description: '可选。BPMS 里显示的附件名，默认取文件名' },
        directory: { type: 'string', description: '可选。存储目录，默认 bpms' },
      },
      required: ['path'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: STATUS },
          message: { type: 'string' },
          file: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              url: { type: 'string' },
              size: { type: 'number' },
            },
          },
        },
      },
    },
    render: text((r) =>
      r.status === 'ok' && r.file
        ? [`已上传：${r.file.name}（${humanSize(r.file.size)}）`, r.file.url]
        : [`上传失败（${r.status ?? 'error'}）：${r.message ?? ''}`],
    ),
    async execute(args = {}) {
      try {
        const raw = String(args.path ?? '').trim();
        if (!raw) throw new BpmsError('bad_query', '需要 path（本地文件路径）');
        const file = await uploadLocalFile(raw, args.name, args.directory || UPLOAD_DIRECTORY);
        return { status: 'ok', file };
      } catch (error) {
        return fail(error);
      }
    },
  });
}

export const TOOL_FACTORIES = [loginTool, fieldsTool, getTool, updateTool, uploadTool];
export { compact, rowsOf, planAttachmentValue, fillAttachmentUrls, normalizeAttachmentItem };

