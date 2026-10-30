'use strict';

// 产品知识库的分组与清洗口径。
//
// 三个分组与销售结构页保持同一套 id（gree-ac / haier-ac / haier-fridge），
// 这样「这台机器卖得怎么样」和「这台机器客服答得怎么样」能用同一个键对上。
//
// 这里只放静态事实（分组、型号正则、停用词、卖点关键词），不放业务判断。

const GROUPS = Object.freeze([
  {
    id: 'gree-ac',
    label: '格力空调',
    brand: '格力',
    category: '空调',
    example: 'KFR-35GW/NhAa1BAj',
    // 格力家用空调：KFR-35GW/... 挂机、KFR-72LW/... 柜机
    modelRe: /KFR-\d{2}(?:GW|LW)[A-Z0-9+\-/]*/i,
    hint: '详情页顶部标题、或「产品型号 / 型号」那一行'
  },
  {
    id: 'haier-ac',
    label: '海尔空调',
    brand: '海尔',
    category: '空调',
    example: 'KFR-35GW/B5LAA21U1',
    modelRe: /KFR-\d{2}(?:GW|LW)[A-Z0-9+\-/]*/i,
    hint: '海尔空调型号一般以 KFR- 开头，条码里带 /B 或 /A'
  },
  {
    id: 'haier-fridge',
    label: '海尔冰箱',
    brand: '海尔',
    category: '冰箱',
    example: 'BCD-501WGHFD14S8U1',
    modelRe: /BCD-\d{3}[A-Z0-9+\-/]*/i,
    hint: '海尔冰箱型号一般以 BCD- 开头（对开门/十字门都是）'
  }
]);

const GROUP_IDS = new Set(GROUPS.map(item => item.id));

function groupById(id) {
  return GROUPS.find(item => item.id === id) || null;
}

// 型号统一写法：全角转半角、去空格、大写。
// 详情页里「kfr-35gw / nhaa1baj」和「KFR-35GW/NhAa1BAj」必须是同一个型号。
// ⚠️ 只用于「比较」：主键判重、去重键、会话匹配。展示要给 cleanModel 的原始大小写，
//    否则台账上会显示成 KFR-35GW/NHAA1BAJ，和厂家写法不一致，人工核对时容易怀疑录错。
function normalizeModel(value) {
  return cleanModel(value).toUpperCase();
}

/** 只做「洗干净」，不改大小写：全角转半角、去空格、各种破折号统一 */
function cleanModel(value) {
  return String(value == null ? '' : value)
    .replace(/[\uFF01-\uFF5E]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\u3000\s]+/g, '')
    .replace(/[—–－]/g, '-');
}

// 参数名里的噪声。详情页抓下来时，配送/客服/优惠这些不是产品参数，
// 混进「参数」会让人以为这台机器有「包邮」这种属性。
const PARAM_STOPWORDS = Object.freeze([
  '客服', '咨询', '配送', '物流', '运费', '包邮', '发货', '优惠', '活动', '券', '赠品',
  '价格', '评价', '销量', '库存', '服务承诺', '七天', '无理由', '发票', '店铺', '品牌',
  '产地', '上市', '净重', '毛重', '包装尺寸', '商品编号', '货号', 'sku', 'SKU'
]);

// 参数名合法长度：太长的多半是整句描述，不是参数名
const PARAM_NAME_MAX = 12;

// 规则兜底用：详情页里出现这些词的行，八成是卖点而不是参数。
// 仅在没有 AI 或 AI 失败时用，正常路径由模型判断。
const FEATURE_HINTS = Object.freeze([
  '自清洁', '防直吹', '变频', '除湿', '除菌', '抗菌', '静音', '低噪', '省电', '节能',
  '新一级', '一级能效', '速冷', '速热', '新风', '净化', '除甲醛', '母婴', '防霉',
  'WiFi', '智能', '语音', '远场', '精准控温', '冷媒', 'R32', '无风感', '柔风',
  '宽温', '低温启动', '高温制冷', '变流', '直流', '双排', '冷凝器', '风道',
  '零度保鲜', '干湿分储', '全空间', '杀菌', '除味', '变频压缩机', '风冷无霜'
]);

// 售后口径：进「售后」区，不进参数区。客服答复最常错的就是这几类。
const SERVICE_HINTS = Object.freeze([
  '保修', '包修', '质保', '三包', '安装', '上门', '收费标准', '移机', '加长管',
  '支架', '打孔', '高空', '辅材', '退换', '七天无理由', '运费险', '以旧换新', '国补'
]);

// 不能当「卖点关键词」用的通用词：几乎每台空调都写，顾客也常在别的语境里说到
// （「2匹变频柜挂机」「只能上下送风」）。拿它们匹配会把不相干的对话拉进来，
// 进而给出「顾客问插座，你该补讲变频」这种牵强建议。
const GENERIC_KEYWORDS = Object.freeze([
  '变频', '直流', '智能', '远程', '送风', '冷风', '热风', '空调', '冰箱',
  '手机', '控制', '调温', '开关', '温度', '舒适', '功能', '效果', '制冷', '制热',
  '外观', '颜值', '静音模式', '使用'
]);

function isGenericKeyword(word) {
  return GENERIC_KEYWORDS.includes(String(word || '').trim());
}

function isParamNoise(name) {
  const text = String(name || '').trim();
  if (!text || text.length > PARAM_NAME_MAX) return true;
  const lower = text.toLowerCase();
  return PARAM_STOPWORDS.some(word => lower.includes(word.toLowerCase()));
}

function looksLikeFeature(text) {
  const value = String(text || '');
  return FEATURE_HINTS.some(word => value.includes(word));
}

function looksLikeService(text) {
  const value = String(text || '');
  return SERVICE_HINTS.some(word => value.includes(word));
}

module.exports = {
  GROUPS,
  GROUP_IDS,
  groupById,
  normalizeModel,
  cleanModel,
  PARAM_STOPWORDS,
  PARAM_NAME_MAX,
  FEATURE_HINTS,
  SERVICE_HINTS,
  GENERIC_KEYWORDS,
  isGenericKeyword,
  isParamNoise,
  looksLikeFeature,
  looksLikeService
};
