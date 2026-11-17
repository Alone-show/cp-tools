/**
 * @local/cp-tools/docs —— /cp-docs 命令 + cp_docs 模型工具（产品资料检索）。
 *
 * 斜杠命令 /cp-docs 直接返回资料（不经 ctx.tools）；模型侧另有 cp_docs 工具，
 * 但带 skill 激活门——只有加载过 cp-docs skill 才可见。用户输入 /cp-docs SPRING2PRO 的屏幕尺寸，
 * 插件做机型归一（与 firmware-finder 共用 shared/model-core）；**唯一命中机型后把该机型全部本地资料整包**
 * 作为一条「上下文」followup 给会话（source.kind 非 user，客户端渲染为折叠卡片），
 * 由模型自行定位作答。检索全程离线。
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDataDir, loadDataset, loadModelFiles, loadLabels, loadImages, loadModelImages } from './lib/store.js';
import { parseQuery } from './lib/parse.js';
import { renderPacket, buildPacketMessage } from './lib/packet.js';
import { resolveImageRoot, locateImage, suggestName, searchImages } from './lib/image-index.js';
import { renderCandidates, renderCatalog } from './lib/framing.js';
import { readBundledSkill as readSkillFile } from '../shared/skill.js';
import { createSkillGate, withSkillScope } from '../shared/skill-gate.js';

export const name = 'cp-docs';
/** 与 firmware / tickets / bpms 同形：工具 + skill 是主入口，命令保留给 GUI 快捷触发。 */
export const inject = ['commands', 'tools', 'skills'];

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_FILE = path.join(PLUGIN_DIR, 'skills', 'cp-docs', 'SKILL.md');
/** 工具描述前置的作用边界（模型可见）。 */
const CP_DOCS_SCOPE = '【cp-docs 技能】只读本机 .cpdocs：不联网、不补充资料之外的内容。';

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
  '  /cp-docs TANK2 的线束图',
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
function describeMaterials(spec, programming, workpoints, imageCount = 0) {
  const bits = [];
  const tables = spec?.tables?.length || 0;
  const params = Object.keys(spec?.params_flat || {}).length;
  const pages = programming?.pages?.length || 0;
  const points = workpoints?.entries?.length || 0;
  if (tables) bits.push(`${tables} 张表`);
  if (params) bits.push(`${params} 项参数`);
  const figures = spec?.figures?.length || 0;
  if (figures) bits.push(`${figures} 张图内文字`);
  if (imageCount) bits.push(`${imageCount} 张图片`);
  if (pages) bits.push(`${pages} 页编程节点`);
  if (points) bits.push(`${points} 组工作点`);
  return bits.join(' / ');
}

function loadPacket(dir, entry, labels) {
  const files = loadModelFiles(dir, entry);
  if (!files.spec) return null;
  const imageEntry = loadModelImages(dir, entry.id);
  const images = imageEntry?.images || [];
  return {
    files,
    images,
    imageEntry,
    packet: renderPacket({
      entry,
      spec: files.spec,
      programming: files.programming,
      workpoints: files.workpoints,
      images,
      labels,
    }),
  };
}

/**
 * 命令与工具共用的唯一判定入口：文本 → 机型 → 资料。
 * 返回 kind：packet（唯一命中/多机型资料相同）/ catalog / ambiguous / sync / help / error。
 * 命令侧把它翻成 followup，工具侧把它翻成结构化结果，两边不各写一套解析。
 */
async function resolveDocsAnswer(ctx, agent, signal, rawText) {
  const text = String(rawText || '').trim();
  if (!text) return { kind: 'help', text: USAGE, question: text };

  let dir;
  try {
    dir = await resolveDataDir(ctx, agent, signal);
  } catch (err) {
    return { kind: 'error', text: `cp-docs 没有本地资料：${err.message}`, question: text };
  }
  const dataset = loadDataset(dir);
  const parsed = parseQuery(text, dataset.models);

  if (parsed.intent === 'sync') {
    return {
      kind: 'sync',
      text: '资料快照更新需要文档站登录态，这一步尚未启用；日常检索不受影响（全部读本地 .cpdocs）。',
      question: text,
    };
  }

  if (parsed.intent === 'help') {
    return { kind: 'help', text: `${USAGE}\n\n没有从问题里认出机型。`, question: text };
  }

  if (parsed.intent === 'catalog') {
    return {
      kind: 'catalog',
      question: text,
      count: dataset.models.length,
      text: renderCatalog(dataset.models),
    };
  }

  // 歧义：整包完全相同则合并作答，否则列候选让用户选
  if (parsed.intent === 'ambiguous') {
    const scored = parsed.candidates || [];
    if (!scored.length) {
      return { kind: 'help', text: `${USAGE}\n\n没能唯一确定机型。`, question: text };
    }
    const labels = loadLabels(dir);
    const built = scored
      .map(([, g]) => ({ g, ...(loadPacket(dir, g, labels) || { packet: '' }) }))
      .filter((x) => x.packet);
    const first = built[0];
    if (first && built.length > 1 && built.every((x) => x.packet === first.packet)) {
      const entries = built.map((x) => x.g);
      return {
        kind: 'packet',
        question: cleanQuestion(parsed.question),
        modelText: parsed.modelText,
        entry: first.g,
        entries,
        same: true,
        packet: first.packet,
        files: first.files,
        images: first.images,
        materials: describeMaterials(
          first.files?.spec,
          first.files?.programming,
          first.files?.workpoints,
          first.images?.length || 0,
        ),
        text: renderCandidates({ query: parsed.modelText || text, scored }),
      };
    }
    return {
      kind: 'ambiguous',
      question: text,
      modelText: parsed.modelText,
      candidates: scored.map(([, g]) => ({ id: g.id, model: g.model })),
      text: renderCandidates({ query: parsed.modelText || text, scored }),
    };
  }

  // 唯一命中：整包返回该机型全部资料，定位交给模型
  const entry = parsed.hit;
  const labels = loadLabels(dir);
  const loaded = loadPacket(dir, entry, labels);
  if (!loaded) {
    return {
      kind: 'error',
      question: text,
      entry,
      text: `已命中机型 ${entry.id} ${entry.model}，但本地缺少资料文件（${entry.spec}）。请重建索引：node scripts/import-docs.mjs`,
    };
  }
  return {
    kind: 'packet',
    question: cleanQuestion(parsed.question),
    entry,
    entries: [entry],
    packet: loaded.packet,
    files: loaded.files,
    images: loaded.images,
    imageEntry: loaded.imageEntry,
    materials: describeMaterials(
      loaded.files.spec,
      loaded.files.programming,
      loaded.files.workpoints,
      loaded.images?.length || 0,
    ),
  };
}

async function handleCommand(ctx, inv) {
  const r = await resolveDocsAnswer(ctx, inv.agent, inv.signal, inv.rawInput);

  switch (r.kind) {
    case 'packet': {
      const framing = buildPacketMessage({
        question: r.question,
        entry: r.entry,
        packet: r.packet,
        ...(r.same
          ? {
              extraNotes: [
                `问题里的机型写法「${r.modelText}」对应多个机型，它们的资料完全相同：${r.entries
                  .map((x) => x.model)
                  .join(' / ')}`,
              ],
            }
          : {}),
      });
      inv.agent.followup(
        contextMessage(framing, `${r.entry.id} ${r.entry.model}${r.materials ? ` · ${r.materials}` : ''}`),
      );
      return {
        kind: 'success',
        text: r.same
          ? `命中 ${r.entry.id} ${r.entry.model} 等机型（资料相同），正在生成回答…`
          : `已命中 ${r.entry.id} ${r.entry.model}：全量资料 ${r.materials}，正在生成回答…`,
      };
    }
    case 'catalog': {
      const framing = [
        '【cp-docs 检索结果 · 机型清单】',
        `用户问题：${r.question}`,
        r.text,
        '请基于以上清单回答用户（不要补充清单之外的机型）。',
      ].join('\n');
      inv.agent.followup(contextMessage(framing, `机型目录 · ${r.count} 款机型`));
      return { kind: 'success', text: `已列出 ${r.count} 款机型，正在生成回答…` };
    }
    case 'ambiguous':
      return { kind: 'success', text: r.text };
    case 'sync':
      return { kind: 'success', text: r.text };
    case 'help':
      return { kind: 'error', text: r.text };
    default:
      return { kind: 'error', text: r.text };
  }
}

/* ------------------------------------------------------------------ *
 * 图片检索：cp_docs_images（与 cp_docs 同一套机型归一 + skill gate）
 * ------------------------------------------------------------------ */
function pickImage(entry, image, root) {
  const loc = locateImage(image, root);
  return {
    idx: image.idx,
    sha8: image.sha8,
    caption: image.caption || image.captions?.[0] || '',
    section: image.section || '',
    kind: image.kind || '',
    purpose: image.purpose || '',
    tags: image.tags || [],
    path: loc.path || '',
    exists: Boolean(loc.exists),
    via: loc.via,
    deliverAs: suggestName(entry.model, image),
  };
}

async function resolveImagesAnswer(ctx, agent, signal, { model, keyword = '', limit = 20 } = {}) {
  const text = String(model || '').trim();
  if (!text) return { kind: 'help' };
  let dir;
  try {
    dir = await resolveDataDir(ctx, agent, signal);
  } catch (err) {
    return { kind: 'error', text: `cp-docs 没有本地资料：${err.message}` };
  }
  const dataset = loadDataset(dir);
  const parsed = parseQuery(text, dataset.models);

  if (parsed.intent === 'catalog') {
    return { kind: 'catalog', count: dataset.models.length, text: renderCatalog(dataset.models) };
  }
  if (parsed.intent === 'help') {
    return { kind: 'help', text: `${USAGE}\n\n没有从问题里认出机型。` };
  }
  if (parsed.intent === 'ambiguous') {
    return {
      kind: 'ambiguous',
      modelText: parsed.modelText,
      candidates: (parsed.candidates || []).map(([, g]) => ({ id: g.id, model: g.model })),
      text: renderCandidates({ query: parsed.modelText || text, scored: parsed.candidates || [] }),
    };
  }

  const entry = parsed.hit;
  const index = loadImages(dir);
  const imageEntry = index?.byModel?.[entry.id];
  if (!imageEntry) {
    return {
      kind: 'noindex',
      entry,
      text: `已命中 ${entry.id} ${entry.model}，但本地没有图片索引（`
        + `${index ? '该机型无图' : '.cpdocs/images.json 缺失'}）。请重建：node scripts/import-docs.mjs`,
    };
  }
  const workspace = ctx?.get?.('workingDirectory')?.defaultDirectory;
  const root = resolveImageRoot({ dataDir: dir, index, workspace });
  const hits = searchImages(imageEntry.images, keyword, limit);
  return {
    kind: 'ok',
    entry,
    keyword: String(keyword || ''),
    total: imageEntry.images.length,
    imageRootOk: Boolean(root),
    images: hits.map((img) => pickImage(entry, img, root)),
  };
}

function renderImagesResult(v) {
  if (!v || typeof v !== 'object') return 'cp-docs 图片：没有返回结果。';
  if (v.status === 'ok') {
    const head = [
      `cp-docs 图片 · ${v.model}（共 ${v.total} 张${v.keyword ? `，关键词「${v.keyword}」` : ''}）`,
      v.images.length
        ? `命中 ${v.images.length} 张${v.imageRootOk ? '' : '（⚠ 图片根目录未找到，发送前先重建索引）'}`
        : '没有匹配的图片；可换关键词（线束 / 接口 / 安装 / 外观 / 参数）。',
    ];
    for (const img of v.images) {
      const label = img.caption || img.sha8;
      const where = img.exists ? img.path : `⚠ 文件缺失（${img.path || img.sha8}）`;
      head.push(`- [${label}] 作用：${img.purpose}｜${where}｜建议名：${img.deliverAs}`);
    }
    if (v.images.length) head.push('发送用 path（已存在的命名文件）；回复里写明图号与作用，同一张图不要重复发。');
    return head.join('\n');
  }
  if (v.status === 'needs_confirmation') return `cp-docs 图片 · 需要先确定机型\n${v.message}`;
  if (v.status === 'catalog') return [`cp-docs 图片 · 机型目录（${v.count ?? '?'} 款）`, v.catalog ?? ''].filter(Boolean).join('\n');
  if (v.status === 'noindex' || v.status === 'error') return `cp-docs 图片 · 取不到资料\n${v.message}`;
  return 'cp-docs 图片：没有返回结果。';
}

function cpDocsImagesToolFor(ctx) {
  return {
    name: 'cp_docs_images',
    description:
      '按机型检索本地产品图片（接口图 / 线束图 / 接线表 / 参数表 / 安装图 / 外观图），'
      + '返回每张图的图号、作用、本地路径与建议文件名。用户要发某机型的图、找线束图/接口图/安装图时调用；'
      + 'query（model）必须含机型写法，keyword 可用「线束 / 接口 / 安装 / 外观 / 参数 / 针脚」。'
      + '发送时用返回的 path 调 dsh_im_return_file，并在回复里写明图号与作用；不查固件版本（用 firmware_find）。',
    parameters: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description: '机型写法，如 "TANK2"、"SPRING2-10PRO"、"APOLLO2 12PRO"',
        },
        keyword: {
          type: 'string',
          description: '可选：按图号/标题/作用/标签过滤，如 "线束"、"接口"、"安装"、"外观"、"针脚"',
        },
        limit: { type: 'integer', description: '返回条数上限，默认 20，最大 50' },
      },
      required: ['model'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'catalog', 'needs_confirmation', 'noindex', 'error'] },
          model: { type: 'string' },
          total: { type: 'integer' },
          keyword: { type: 'string' },
          count: { type: 'integer' },
          imageRootOk: { type: 'boolean' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                idx: { type: 'integer' },
                sha8: { type: 'string' },
                caption: { type: 'string' },
                section: { type: 'string' },
                kind: { type: 'string' },
                purpose: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } },
                path: { type: 'string' },
                exists: { type: 'boolean' },
                via: { type: 'string' },
                deliverAs: { type: 'string' },
              },
            },
          },
          message: { type: 'string' },
          instruction: { type: 'string' },
          usage: { type: 'string' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, model: { type: 'string' } },
            },
          },
          catalog: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderImagesResult(value) }],
    },
    async execute(args, exec) {
      const model = typeof args?.model === 'string' ? args.model : '';
      const keyword = typeof args?.keyword === 'string' ? args.keyword : '';
      const limit = Number(args?.limit);
      const r = await resolveImagesAnswer(ctx, exec?.agent, exec?.signal, { model, keyword, limit });

      if (r.kind === 'ok') {
        return {
          status: 'ok',
          model: `${r.entry.id} ${r.entry.model}`,
          total: r.total,
          keyword: r.keyword,
          count: r.images.length,
          imageRootOk: r.imageRootOk,
          images: r.images,
          instruction: r.images.length
            ? '用 path 调 dsh_im_return_file 发送；回复里写清图号与作用（如「图4.1.2 26P接线图：线序/线径/线色，线束制作用」）。'
            : '没有命中：建议换成 线束 / 接口 / 安装 / 外观 / 参数 等关键词，或去掉 keyword 看全部。',
        };
      }
      if (r.kind === 'catalog') {
        return { status: 'catalog', count: r.count, catalog: r.text, instruction: '列出机型让用户先选一个。' };
      }
      if (r.kind === 'ambiguous') {
        return {
          status: 'needs_confirmation',
          candidates: r.candidates,
          message: r.text,
          instruction: '把候选给用户选；不要自己挑一个继续发图。',
        };
      }
      if (r.kind === 'noindex') {
        return {
          status: 'noindex',
          model: `${r.entry.id} ${r.entry.model}`,
          message: r.text,
          instruction: '告诉用户需要重建索引：node scripts/import-docs.mjs（不要编造图片路径）。',
        };
      }
      return { status: 'error', message: r.text || '取不到图片资料', usage: USAGE };
    },
  };
}

/* ------------------------------------------------------------------ *
 * 模型工具：cp_docs（与 /cp-docs 命令同一套判定；IM 通道没有命令入口，
 * 靠这个工具取资料，行为与 GUI 的整包路径一致）
 * ------------------------------------------------------------------ */
function cpDocsToolFor(ctx) {
  return {
    name: 'cp_docs',
    description:
      '查 CP 机型的本地产品资料（参数 / 接口 / 线束 / 编程节点 / 工作点），离线读本机 .cpdocs。'
      + '用户问某机型的屏幕尺寸、RS232/RS485 引脚、GPIO、工作温度、设备节点，或发 /cp-docs 时调用。'
      + 'query 必须包含机型写法；返回 ok 时整包资料会作为下一条上下文给出（模型直接可见），据此作答并标注出处；'
      + '返回 needs_confirmation 就把候选列给用户，选定后带精确机型重试；返回 catalog 就列机型让用户挑。'
      + '整包里只列图片标题；用户要发图 / 找线束图接口图，再用 cp_docs_images 取路径与作用。'
      + '不负责固件版本与刷机直链（用 firmware_find）、工单与历史 bug（用 ticket_search / ticket_bug_check）。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '自然语言问题，需包含机型写法，如 "SPRING2PRO 的屏幕尺寸"、"APOLLO2 12PRO 的工作温度范围"',
        },
      },
      required: ['query'],
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ok', 'catalog', 'needs_confirmation', 'unsupported', 'error'] },
          source: { type: 'string' },
          model: { type: 'string' },
          materials: { type: 'string' },
          question: { type: 'string' },
          note: { type: 'string' },
          packet: { type: 'string' },
          delivered: { type: 'string', enum: ['context', 'inline'] },
          instruction: { type: 'string' },
          count: { type: 'integer' },
          catalog: { type: 'string' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, model: { type: 'string' } },
            },
          },
          message: { type: 'string' },
          usage: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDocsResult(value) }],
    },
    async execute(args, exec) {
      const query = typeof args?.query === 'string' ? args.query : '';
      const r = await resolveDocsAnswer(ctx, exec?.agent, exec?.signal, query);

      if (r.kind === 'packet') {
        const packet = String(r.packet).slice(0, 40000);
        // 原生调用把整包作为附加上下文注入（模型可见、客户端折叠）；PTC 子调用/无 deferContext 时内联。
        const canDefer =
          exec !== undefined && exec !== null && exec.parent === undefined && typeof exec.deferContext === 'function';
        if (canDefer) {
          exec.deferContext(
            contextMessage(
              buildPacketMessage({
                question: r.question,
                entry: r.entry,
                packet,
                ...(r.same
                  ? {
                      extraNotes: [
                        `问题里的机型写法「${r.modelText}」对应多个机型，它们的资料完全相同：${r.entries
                          .map((x) => x.model)
                          .join(' / ')}`,
                      ],
                    }
                  : {}),
              }),
              `${r.entry.id} ${r.entry.model}${r.materials ? ` · ${r.materials}` : ''}`,
            ),
          );
        }
        return {
          status: 'ok',
          source: 'cp-docs/.cpdocs',
          model: `${r.entry.id} ${r.entry.model}`,
          materials: r.materials,
          question: r.question,
          ...(r.same
            ? { note: `写法对应多个机型且资料相同：${r.entries.map((x) => `${x.id} ${x.model}`).join(' / ')}` }
            : {}),
          delivered: canDefer ? 'context' : 'inline',
          ...(canDefer ? {} : { packet }),
          instruction: canDefer
            ? '整包资料已作为下一条上下文给出：基于它作答并标注来源表/章节，不要补充资料之外的内容。'
            : '基于 packet 作答并标注来自哪张表/哪一节；packet 里没有的字段直接说没有，不要补机型或猜参数。',
        };
      }
      if (r.kind === 'catalog') {
        return {
          status: 'catalog',
          count: r.count,
          catalog: r.text,
          instruction: '列出机型让用户先选一个，再用精确机型调用 cp_docs。',
        };
      }
      if (r.kind === 'ambiguous') {
        return {
          status: 'needs_confirmation',
          candidates: r.candidates,
          message: r.text,
          instruction: '把候选给用户选；不要自己挑一个继续答。',
        };
      }
      if (r.kind === 'sync') return { status: 'unsupported', message: r.text };
      return { status: 'error', message: r.text, usage: USAGE };
    },
  };
}

function readBundledSkill() {
  return readSkillFile(SKILL_FILE);
}

/**
 * 工具结果的模型可见内容。
 *
 * 关键：`render` 的返回值就是模型看到的内容（规范值只在执行期存在），所以：
 *   - ok + delivered=context → 一行摘要（整包已由 deferContext 作为下一条上下文给出）；
 *   - ok + delivered=inline  → 摘要 + 整包（PTC 子调用/无 deferContext 的兜底）；
 *   - catalog / needs_confirmation / error → 直接给清单、候选、用法，不再只给计数。
 */
function renderDocsResult(v) {
  if (!v || typeof v !== 'object') return 'cp-docs：没有返回结果。';
  if (v.status === 'ok') {
    const head = [`cp-docs · ${v.model}`, v.materials ? `  ${v.materials}` : '', v.note ? `  ${v.note}` : '']
      .filter(Boolean)
      .join('\n');
    if (v.delivered === 'context') return `${head}\n整包资料已作为下一条上下文给出。`;
    return v.packet ? `${head}\n\n${v.packet}` : head;
  }
  if (v.status === 'catalog') {
    return [`cp-docs · 机型目录（${v.count ?? '?'} 款）`, v.catalog ?? ''].filter(Boolean).join('\n');
  }
  if (v.status === 'needs_confirmation') {
    return v.message ? `cp-docs · 需要先确定机型\n${v.message}` : 'cp-docs · 需要先确定机型';
  }
  if (v.status === 'unsupported') return `cp-docs · ${v.message ?? '暂不支持'}`;
  if (v.status === 'error') {
    const message = String(v.message ?? '');
    const lines = ['cp-docs · 错误', message];
    if (v.usage !== undefined && !message.includes('用法：')) lines.push(v.usage);
    return lines.filter(Boolean).join('\n\n');
  }
  return 'cp-docs：没有返回结果。';
}

export function apply(ctx) {
  // 先解析 skill：解析失败就让插件行显式失败，避免留下永远不可见的工具。
  const skill = readBundledSkill();
  // cp_docs 工具只在加载过 cp-docs skill 之后才可见；
  // /cp-docs 命令走 handleCommand → resolveDocsAnswer，不经过 ctx.tools，因此不受影响。
  const gate = createSkillGate(ctx, ['cp-docs']);
  const when = gate.when('cp-docs');
  ctx.effect(() => ctx.tools.register(withSkillScope(cpDocsToolFor(ctx), CP_DOCS_SCOPE), { when }));
  ctx.effect(() => ctx.tools.register(withSkillScope(cpDocsImagesToolFor(ctx), CP_DOCS_SCOPE), { when }));
  ctx.effect(() => ctx.skills.register(skill));

  // GUI 快捷入口保留：命令与工具共用 resolveDocsAnswer，行为不变。
  ctx.effect(() =>
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
    }),
  );
}
