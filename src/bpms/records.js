/**
 * 订单需求表的字段寻址、差异比较与保存体构造。
 *
 * 这里是这次在 BPMS 上踩出来的规则，工具与测试共用：
 *   - 字段按「分区/字段名」寻址，不按 requireInfoList[2].fieldList[5] 这种下标（模板一改就错位）
 *   - 保存是整包回写，parameters 必须重新序列化成字符串
 *   - 写后只允许白名单内的叶子路径变化
 */
import { BpmsError } from './client.js';

/** parameters 里按 label 组织的四个列表；orderFittingList 是配件表，按 partNumber 走，不做 label 寻址。 */
export const LABEL_LISTS = [
  { key: 'basicInfoList', section: '基本信息' },
  { key: 'orderSummaryList', section: '订单配置总结' },
  { key: 'requireInfoList', section: null },
];

export function parseParameters(detail) {
  if (!detail || typeof detail !== 'object') throw new BpmsError('bad_record', '详情为空');
  if (detail.parameters && typeof detail.parameters === 'object') return detail.parameters;
  try {
    return JSON.parse(detail.parameters ?? '{}');
  } catch (error) {
    throw new BpmsError('bad_record', `parameters 不是合法 JSON：${error.message}`);
  }
}

/**
 * 给所有可按 label 寻址的字段建索引。
 * @returns {Array<{key: string, labels: string[], section: string, label: string, path: string, item: object}>}
 */
export function indexFields(parameters) {
  const out = [];
  for (const spec of LABEL_LISTS) {
    const list = parameters?.[spec.key];
    if (!Array.isArray(list)) continue;
    list.forEach((item, i) => {
      if (!item || typeof item !== 'object') return;
      const section = spec.section ?? String(item.label ?? '').trim();
      if (Array.isArray(item.fieldList)) {
        item.fieldList.forEach((field, j) => {
          if (!field || !field.label) return;
          out.push({
            key: `${section}/${field.label}`,
            labels: [section, String(field.label)],
            section,
            label: String(field.label),
            path: `${spec.key}[${i}].fieldList[${j}]`,
            item: field,
          });
        });
        return;
      }
      if (!item.label) return;
      out.push({
        key: `${spec.section}/${item.label}`,
        labels: [spec.section, String(item.label)],
        section: spec.section,
        label: String(item.label),
        path: `${spec.key}[${i}]`,
        item,
      });
    });
  }
  return out;
}

/** 按 key 或 labels 找字段；同名多份时报 ambiguous，不猜。 */
export function resolveField(index, query) {
  const wanted = Array.isArray(query) ? query.join('/') : String(query ?? '').trim();
  if (!wanted) throw new BpmsError('bad_query', '字段名不能为空');
  const hits = index.filter((entry) => entry.key === wanted);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new BpmsError('ambiguous', `「${wanted}」匹配到 ${hits.length} 个字段，请用更完整的路径`, {
      candidates: hits.map((hit) => hit.path),
    });
  }
  const fuzzy = index.filter((entry) => entry.key.endsWith(`/${wanted}`));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) {
    throw new BpmsError('ambiguous', `「${wanted}」匹配到多个字段`, {
      candidates: fuzzy.map((entry) => entry.key),
    });
  }
  throw new BpmsError('not_found', `找不到字段「${wanted}」`, {
    hint: '先调用 bpms_fields 看可编辑字段列表',
  });
}

/** 叶子路径差异，返回 [{path, before, after}]；用于白名单校验与 diff 展示。 */
export function diffPaths(before, after, base = '') {
  const out = [];
  if (before === after) return out;
  const bothObjects =
    before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after);
  if (bothObjects) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      out.push(...diffPaths(before[key], after[key], `${base}${base ? '.' : ''}${key}`));
    }
    return out;
  }
  const bothArrays = Array.isArray(before) && Array.isArray(after);
  if (bothArrays && before.length === after.length) {
    before.forEach((item, i) => out.push(...diffPaths(item, after[i], `${base}[${i}]`)));
    return out;
  }
  out.push({ path: base || '(root)', before, after });
  return out;
}

/** 变化的路径是否都落在允许的字段路径下。 */
export function onlyInside(diffs, allowedPaths) {
  const allowed = allowedPaths.map((p) => (p.endsWith('.') ? p : p));
  return diffs.every((diff) => allowed.some((prefix) => diff.path === prefix || diff.path.startsWith(`${prefix}.`)));
}

/**
 * 构造 update 的请求体：与 UI 抓包一致（整包回写，parameters 为字符串）。
 * 只从详情里取需要的字段，避免把 createTime/updateTime 之类只读字段回写。
 */
export function buildUpdateBody(detail, parameters) {
  return {
    systemVersionAuthoritativeFlag: false,
    productId: detail.productId ?? null,
    templateId: detail.templateId ?? null,
    type: detail.type ?? null,
    subType: detail.subType ?? null,
    name: detail.name ?? null,
    expectedDeliveryDate: detail.expectedDeliveryDate ?? null,
    parentId: detail.parentId ?? null,
    orgName: detail.orgName ?? null,
    companyName: detail.companyName ?? null,
    status: detail.status ?? null,
    rejectRemake: detail.rejectRemake ?? null,
    createUser: detail.createUser ?? null,
    contractStatus: detail.contractStatus ?? null,
    templateName: detail.templateName ?? null,
    id: detail.id ?? null,
    customerId: detail.customerId ?? null,
    contractId: detail.contractId ?? null,
    parameters: JSON.stringify(parameters),
    parentRequirementsNumber: detail.parentRequirementsNumber ?? null,
    newOsFlag: null,
    dingTalkProcessFlag: true,
    dingtalkProcessInstanceId: null,
    rejectRecords: [],
    _rowKey: detail.id ?? null,
  };
}

/** 详情摘要：只给结论字段，不返回整包，避免把上下文撑爆。 */
export function summarize(detail) {
  return {
    id: detail.id,
    requirementsNumber: detail.requirementsNumber,
    name: detail.name,
    type: detail.type,
    status: detail.status,
    orgName: detail.orgName,
    customerId: detail.customerId,
    productId: detail.productId,
    templateId: detail.templateId,
    templateName: detail.templateName,
    expectedDeliveryDate: detail.expectedDeliveryDate,
    createTime: detail.createTime,
    updateTime: detail.updateTime,
    parentId: detail.parentId ?? null,
  };
}
