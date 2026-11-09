/**
 * @local/cp-tools/docs —— /cp-docs + 自然语言的产品资料检索。
 *
 * 只注册一个斜杠命令（不注册模型工具）：用户输入 /cp-docs SPRING2PRO 的屏幕尺寸，
 * 插件做机型归一（与 firmware-finder 共用 shared/model-core）；**唯一命中机型后把该机型全部本地资料整包**
 * 作为一条「上下文」followup 给会话（source.kind 非 user，客户端渲染为折叠卡片），
 * 由模型自行定位作答。检索全程离线。
 */
import crypto from 'node:crypto';
import { resolveDataDir, loadDataset, loadModelFiles, loadLabels } from './lib/store.js';
import { parseQuery } from './lib/parse.js';
import { renderPacket, buildPacketMessage } from './lib/packet.js';
import { renderCandidates, renderCatalog } from './lib/framing.js';

export const name = 'cp-docs';
export const inject = ['commands'];

/** 注入消息的 source.kind：非 'user' → 客户端渲染为折叠的上下文/触发卡片，不占用户气泡 */
const SOURCE_KIND = 'cp-docs';
/** 折叠行摘要上限，对齐 DSH 的 boundContextSummary（120 字符、单行） */
const SUMMARY_MAX = 120;

const USAGE = [
  '用法：/cp-docs <自然语言>',
  '例：',
  '  /cp-docs SPRING2PRO 的屏幕尺寸',
  '  /cp-docs SPRING2PRO 的 RS232 引脚在第几脚',
  '  /cp-docs APOLLO2 12PRO 的工作温度范围',
  '  /cp-docs CP023 的 INPUT1 接到哪个 GPIO',
  '  /cp-docs APOLLO 7 PRO 的 RS485 设备节点',
  '  /cp-docs 支持哪些机型',
].join('\n');

function bound(summary) {
  const one = String(summary || '').replace(/\s+/g, ' ').trim();
  return one.length > SUMMARY_MAX ? `${one.slice(0, SUMMARY_MAX - 1)}…` : one;
}

function contextMessage(text, summary) {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary: bound(summary) },
  };
}

/** 去掉机型串后遗留的句首助词，仅供报文头部展示 */
function cleanQuestion(q) {
  return String(q || '')
    .replace(/^[\s的，,。.、]+/, '')
    .trim();
}

/** 命令返回文案里的资料计数（可审计，便于确认走的是整包路径） */
function describeMaterials(spec, programming, workpoints) {
  const bits = [];
  const tables = spec?.tables?.length || 0;
  const params = Object.keys(spec?.params_flat || {}).length;
  const pages = programming?.pages?.length || 0;
  const points = workpoints?.entries?.length || 0;
  if (tables) bits.push(`${tables} 张表`);
  if (params) bits.push(`${params} 项参数`);
  const figures = spec?.figures?.length || 0;
  if (figures) bits.push(`${figures} 张图内文字`);
  if (pages) bits.push(`${pages} 页编程节点`);
  if (points) bits.push(`${points} 组工作点`);
  return bits.join(' / ');
}

function loadPacket(dir, entry, labels) {
  const files = loadModelFiles(dir, entry);
  if (!files.spec) return null;
  return {
    files,
    packet: renderPacket({
      entry,
      spec: files.spec,
      programming: files.programming,
      workpoints: files.workpoints,
      labels,
    }),
  };
}

async function handleCommand(ctx, inv) {
  const text = String(inv.rawInput || '').trim();
  if (!text) return { kind: 'error', text: USAGE };

  let dir;
  try {
    dir = await resolveDataDir(ctx, inv.agent, inv.signal);
  } catch (err) {
    return { kind: 'error', text: `cp-docs 没有本地资料：${err.message}` };
  }
  const dataset = loadDataset(dir);
  const parsed = parseQuery(text, dataset.models);

  if (parsed.intent === 'sync') {
    return {
      kind: 'success',
      text: '资料快照更新需要文档站登录态，这一步尚未启用；日常检索不受影响（全部读本地 .cpdocs）。',
    };
  }

  if (parsed.intent === 'help') {
    return { kind: 'error', text: `${USAGE}\n\n没有从问题里认出机型。` };
  }

  if (parsed.intent === 'catalog') {
    const framing = [
      '【cp-docs 检索结果 · 机型清单】',
      `用户问题：${text}`,
      renderCatalog(dataset.models),
      '请基于以上清单回答用户（不要补充清单之外的机型）。',
    ].join('\n');
    inv.agent.followup(contextMessage(framing, `机型目录 · ${dataset.models.length} 款机型`));
    return { kind: 'success', text: `已列出 ${dataset.models.length} 款机型，正在生成回答…` };
  }

  // 歧义：整包完全相同则合并作答，否则列候选让用户选
  if (parsed.intent === 'ambiguous') {
    const scored = parsed.candidates || [];
    if (scored.length) {
      const labels = loadLabels(dir);
      const built = scored
        .map(([, g]) => ({ g, ...(loadPacket(dir, g, labels) || { packet: '' }) }))
        .filter((x) => x.packet);
      const first = built[0];
      if (first && built.length > 1 && built.every((x) => x.packet === first.packet)) {
        const framing = buildPacketMessage({
          question: cleanQuestion(parsed.question),
          entry: first.g,
          packet: first.packet,
          extraNotes: [
            `问题里的机型写法「${parsed.modelText}」对应多个机型，它们的资料完全相同：${built.map((x) => x.g.model).join(' / ')}`,
          ],
        });
        inv.agent.followup(
          contextMessage(framing, `资料相同：${built.map((x) => `${x.g.id} ${x.g.model}`).join(' / ')}`),
        );
        return { kind: 'success', text: `命中 ${first.g.id} ${first.g.model} 等机型（资料相同），正在生成回答…` };
      }
      return { kind: 'success', text: renderCandidates({ query: parsed.modelText || text, scored }) };
    }
    return { kind: 'error', text: `${USAGE}\n\n没能唯一确定机型。` };
  }

  // 唯一命中：整包返回该机型全部资料，定位交给模型
  const entry = parsed.hit;
  const labels = loadLabels(dir);
  const loaded = loadPacket(dir, entry, labels);
  if (!loaded) {
    return {
      kind: 'error',
      text: `已命中机型 ${entry.id} ${entry.model}，但本地缺少资料文件（${entry.spec}）。请重建索引：node scripts/import-docs.mjs`,
    };
  }
  const materials = describeMaterials(loaded.files.spec, loaded.files.programming, loaded.files.workpoints);
  const framing = buildPacketMessage({ question: cleanQuestion(parsed.question), entry, packet: loaded.packet });
  inv.agent.followup(contextMessage(framing, `${entry.id} ${entry.model}${materials ? ` · ${materials}` : ''}`));
  return {
    kind: 'success',
    text: `已命中 ${entry.id} ${entry.model}：全量资料 ${materials}，正在生成回答…`,
  };
}

export function apply(ctx) {
  ctx.commands.register({
    name: 'cp-docs',
    description: '按机型返回本地全部产品资料（参数/接口/线束/编程节点/工作点），由模型定位作答',
    input: { hint: '用自然语言问，如：SPRING2PRO 的屏幕尺寸' },
    handler: async (inv) => {
      try {
        return await handleCommand(ctx, inv);
      } catch (err) {
        return { kind: 'error', text: `cp-docs 出错：${err?.stack || err}` };
      }
    },
  });
}
