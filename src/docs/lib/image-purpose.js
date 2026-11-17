/**
 * 图片「作用」标注规则。
 *
 * 产品资料里的图只有标题（caption/section）和类别（spec 的 kind、抓取清单的 category），
 * 用户需要知道每张图**拿来干什么**才能检索。这里用固定模板 + 标题关键词生成作用与标签：
 *   - 只转述标题里已有的信息，不引入任何新参数、数值或技术结论；
 *   - 模板可被逐张覆盖（ai-readable/figure-purpose.json，见 mergeOverrides）。
 *
 * 词表（tags）用于 cp_docs_images 的关键词检索，保持短、稳定、可枚举。
 */

/** 作用模板：按 spec 的 kind */
const BY_KIND = {
  param: { purpose: '查整机参数（系统 / 显示 / 通讯 / 电源 / 环境）', tags: ['参数', '配置'] },
  interface: { purpose: '查接口各针脚信号定义（接线前核对）', tags: ['接口', '针脚', '定义'] },
  harness: { purpose: '查线序、针位、线径、线色（线束制作与核对）', tags: ['线束', '接线', '线序'] },
  drawing: { purpose: '图内尺寸 / 孔位 / 安装说明（结构核对）', tags: ['尺寸', '安装', '结构'] },
  photo: { purpose: '实物示意（外观 / 位置参考）', tags: ['外观', '实物'] },
};

/**
 * 标题细化规则：命中即覆盖 kind 模板（越具体越靠前）。
 * 每条 note 用「以…为准」把容易被误用的图指向正确入口。
 */
const BY_CAPTION = [
  {
    re: /CABLE\s*ASSEMBLY|线缆规格|线缆规格书|规格书/i,
    purpose: '成品线缆规格书（接头定义 / 线序 / 长度选型，采购与来料核对）',
    tags: ['线束', '线缆', '规格'],
  },
  {
    re: /线束外观|线束走线|走线图|外观图/,
    when: (t) => /线束/.test(t),
    purpose: '线束走向与外观示意（针脚以同机型接线表为准）',
    tags: ['线束', '外观'],
  },
  {
    re: /接线表|接线图|线束定义表/,
    purpose: '线序 / 针位 / 线径 / 线色总表（线束制作与核对）',
    tags: ['线束', '接线', '线序'],
  },
  {
    re: /线束/,
    purpose: '线束相关图纸（针位以同机型接线表为准）',
    tags: ['线束'],
  },
  {
    re: /安装指导|安装说明|安装图|支架/,
    purpose: '安装方式、支架与固定孔位（结构核对）',
    tags: ['安装', '尺寸'],
  },
  {
    re: /坐标|IMU|轴向/,
    purpose: 'IMU 轴向 / 坐标定义（安装朝向核对）',
    tags: ['坐标', 'IMU'],
  },
  {
    re: /接口图/,
    purpose: '机身接口位置示意（找口用，针脚定义见接口定义表）',
    tags: ['接口', '外观'],
  },
  {
    re: /接口定义|接口表/,
    purpose: '查接口各针脚信号定义（接线前核对）',
    tags: ['接口', '针脚', '定义'],
  },
  {
    re: /参数表|配置信息/,
    purpose: '查整机参数（系统 / 显示 / 通讯 / 电源 / 环境）',
    tags: ['参数', '配置'],
  },
  {
    re: /正面图|背面图|反面图|侧面图|俯视图|外观/,
    purpose: '整机外观、尺寸与安装孔位（结构核对）',
    tags: ['外观', '尺寸'],
  },
];

/** 抓取清单 category → kind（仅在没有 spec 记录时兜底；已知会误判，所以优先级最低） */
const CATEGORY_KIND = {
  参数表: 'param',
  接口定义表: 'interface',
  线束定义表: 'harness',
  线束外观图: 'harness',
  接口实物图: 'photo',
  外观图: 'drawing',
  安装图: 'drawing',
  // 「其他图表」故意不映射：落到标题模板/兜底，避免把所有杂图说成「尺寸/孔位」
};

const KIND_LABEL = {
  param: '参数表',
  interface: '接口定义表',
  harness: '线束定义表',
  drawing: '工程图',
  photo: '实物图',
  skipped: '未转写图',
};

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** spec.skipped 的 reason 形如「外观图｜图2.1.1 正面图：非表格，见原图」 */
function reasonText(reason) {
  const raw = clean(reason);
  if (!raw) return '';
  const m = raw.match(/^[^｜|]{1,12}[｜|]\s*(.+)$/);
  return m ? m[1].trim() : raw;
}

/** 由 kind 兜底（含 manifest category 的映射） */
export function kindOf({ kind, category } = {}) {
  if (kind) return kind;
  if (category && CATEGORY_KIND[category]) return CATEGORY_KIND[category];
  return '';
}

/**
 * @param {object} p
 * @param {string} [p.kind]      spec 的 kind（param/interface/harness/drawing/photo/skipped）
 * @param {string} [p.category]  抓取清单的 category（仅兜底）
 * @param {string} [p.caption]   图片标题（如「图4.1.2 26P接线图」）
 * @param {string} [p.section]   所在章节（如「4.1 TANK2线束定义」）
 * @param {string} [p.title]     图内标题/图纸标题（spec.figures[].title，如「M12 X-CODE MALE TO RJ45 CABLE ASSEMBLY」）
 * @param {string} [p.reason]    spec.skipped 的降级理由
 * @returns {{ purpose: string, tags: string[], detectedBy: string, confidence: string }}
 */
export function purposeFor({ kind, category, caption, section, title, reason } = {}) {
  const heading = clean([title, caption, section].filter(Boolean).join(' '));
  const k = kindOf({ kind, category });

  for (const rule of BY_CAPTION) {
    if (!rule.re.test(heading)) continue;
    if (rule.when && !rule.when(heading)) continue;
    return { purpose: rule.purpose, tags: rule.tags.slice(), detectedBy: 'caption', confidence: 'high' };
  }

  if (k === 'skipped') {
    const text = reasonText(reason);
    return {
      purpose: text || '未转写的图片（见原图）',
      tags: ['未转写'],
      detectedBy: 'reason',
      confidence: 'medium',
    };
  }

  if (BY_KIND[k]) {
    return { purpose: BY_KIND[k].purpose, tags: BY_KIND[k].tags.slice(), detectedBy: 'kind', confidence: 'high' };
  }

  return {
    purpose: caption ? `图片：${clean(caption)}` : '图片（无标题）',
    tags: [],
    detectedBy: 'fallback',
    confidence: 'low',
  };
}

/** 图表类别标签（渲染用） */
export function kindLabel(kind) {
  return KIND_LABEL[kind] || '';
}

/** 合并逐张覆盖（figure-purpose.json：sha256 → { purpose, tags }） */
export function mergeOverride(base, o) {
  if (!o || typeof o !== 'object') return base;
  const purpose = clean(o.purpose) || base.purpose;
  const tags = Array.isArray(o.tags) && o.tags.length ? o.tags.map(clean).filter(Boolean) : base.tags;
  return { purpose, tags, detectedBy: 'override', confidence: 'high' };
}

/** 检索同义词：用户说法 → 需要额外匹配的标签/标题词 */
export const KEYWORD_SYNONYMS = {
  接线: ['线束', '接线', '线序'],
  接线图: ['线束', '接线'],
  线序: ['线序', '接线'],
  针脚: ['针脚', '接口', '定义'],
  引脚: ['针脚', '接口', '定义'],
  脚位: ['针脚', '接口'],
  原理: ['接线', '接口'],
  结构: ['尺寸', '安装'],
  孔位: ['尺寸', '安装'],
  温度: ['参数'],
};
