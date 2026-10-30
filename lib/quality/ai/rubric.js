'use strict';

// 客服质检评分规则（数据驱动）。
// 结构沿用《UA质检日报》模板：关键项 70 分一票否决 + 非关键项 30 分（5/3/1 制）。
// 条目按空调电商（京东/天猫文字客服）场景改写：语音类项（语调语速、Hold 线）不适用，转为在线对应项。
// 改口径只改本文件；算分在 score.js，提示词在 prompt.js，关键词与链接检测在 keywords.js / link-policy.js。
//
// 版本历史：
//   achat-text-v2  17 项（红线 3 + 关键项 8 + 非关键项 6）
//   achat-text-v3  19 项（红线 3 + 关键项 9 + 非关键项 7）
//                  v3 变更（2026-10-22 客服主管提出）：
//                  ① 新增非关键项 completeness「回复完整度」，单字回复扣分
//                  ② 细化 hotline「平台高压线」：好评返现关键词清单 + 补偿/优惠场景规避
//                  ③ 细化 redline_fraud：明确加我/私我/扫码/线下交易属站外
//                  ④ 新增关键项 diversion「导流与链接」：同平台我司店铺放行，跨平台/非我司店铺违规

const RUBRIC_VERSION = 'achat-text-v3';
const CRITICAL_WEIGHT = 70;
const STANDARD_WEIGHT = 30;
const STANDARD_MAX = 5;

// 咨询类型：决定哪些规则适用，避免"没涉及就不该扣"的误判。
const CATEGORIES = Object.freeze([
  { id: 'pre_sale', label: '售前选购' },
  { id: 'price', label: '价格活动/国补' },
  { id: 'order', label: '订单/发货' },
  { id: 'logistics', label: '物流配送' },
  { id: 'install', label: '安装/预约' },
  { id: 'after_sale', label: '售后维修/报修' },
  { id: 'return', label: '退换货' },
  { id: 'invoice', label: '发票' },
  { id: 'complaint', label: '投诉/纠纷' },
  { id: 'other', label: '其他' }
]);

const CRITERIA = Object.freeze([
  // ========== 红线：命中即整单 0 分 ==========
  {
    id: 'redline_abuse',
    label: '辱骂攻击',
    kind: 'fatal',
    appliesTo: null,
    definition: '客服不得对顾客使用侮辱、嘲讽、威胁、驱赶性语言，不得因顾客反复询问而态度恶劣。',
    failWhen: ['出现辱骂/嘲讽/威胁/驱赶用语', '用反问句质问顾客（如"我不是跟你说了吗"）'],
    passWhen: ['全程用语克制，即使顾客情绪激烈也保持礼貌'],
    naWhen: []
  },
  {
    id: 'redline_privacy',
    label: '泄露隐私',
    kind: 'fatal',
    appliesTo: null,
    definition: '不得向第三方或公开渠道泄露顾客手机号、地址、身份证、订单信息。',
    failWhen: ['把顾客手机号/地址发到群聊或提供给无关人员', '截图包含顾客完整个人信息外发'],
    passWhen: ['未出现个人信息外泄'],
    naWhen: []
  },
  {
    id: 'redline_fraud',
    label: '虚假承诺/站外交易',
    kind: 'fatal',
    appliesTo: null,
    definition: '不得引导顾客脱离平台私下交易，不得作出明知无法兑现的承诺。站外引导的同义表述包括：加我、加微信、私我、私聊、扫我发的码、线下交易、私下转账、走支付宝。注意两种不属于本项：①真实能兑现的营销承诺（如按公司政策返现）属于"平台高压线"；②顾客主动说要加微信、客服明确拒绝或未答应，不属于本项。',
    failWhen: [
      '引导加微信/支付宝/QQ 私下转账、站外下单（含"加我""私我""扫码""线下交易"等同义表述）',
      '承诺明知无法兑现的时效或结果（如"保证明天一定到""百分百不坏"）'
    ],
    passWhen: [
      '所有承诺均有政策依据或明确说明以后台审核为准',
      '顾客主动提出加微信/私下转账，客服明确引导回平台内完成'
    ],
    naWhen: []
  },

  // ========== 关键项：任一项不合格 → 70 分全扣（沿用模板一票否决） ==========
  {
    id: 'hotline',
    label: '平台高压线',
    kind: 'critical',
    appliesTo: null,
    definition: '不得触碰平台规则红线：以返现、红包、补偿等金钱利益换取顾客好评或删改评价；刷单、虚假发货、擅自承诺赔付。判定核心是"对价关系"——金钱利益是否以顾客给出好评/晒图/五星为条件。',
    failWhen: [
      '以返现/红包/补偿换取好评，出现下列任一表述：好评返现、晒图返红包、好评补偿、五星好评、评价返现、晒图评价返现金、给五星返钱',
      '要求/诱导顾客追加评价、修改差评、删除差评',
      '承诺平台/品牌方并未提供的补贴、赠品、终身保修',
      '承诺平台赔付或自行垫付',
      '引导顾客取消订单后重新下单以规避规则'
    ],
    passWhen: [
      '未出现以金钱利益换取好评的表述',
      '售后场景下的补偿性返现：顾客要求赔偿、投诉、或商品有问题时，客服说明"给您返现/补偿"，但未与好评、晒图、五星、评价绑定',
      '优惠答疑场景下的返现说明：顾客询问优惠、活动、国补、能否便宜时，客服说明"有返现/红包活动"，且未要求顾客先给好评',
      '客服主动拒绝顾客的好评返现提议，或将顾客引导回平台正规评价流程'
    ],
    naWhen: [
      '顾客单方面提出"给好评能返现吗"，客服未承诺、未附条件'
    ]
  },
  {
    id: 'etiquette',
    label: '服务礼仪',
    kind: 'critical',
    appliesTo: null,
    definition: '礼貌用语、正确称呼（您/先生/女士）、不打断、不催促、不使用命令式口吻。',
    failWhen: ['连续 3 次以上未使用礼貌用语', '称呼错误（如把女士称先生）', '命令式或生硬口吻（"自己看详情页"）'],
    passWhen: ['全程使用"您/请/麻烦您"等礼貌用语，称呼得当'],
    naWhen: []
  },
  {
    id: 'response',
    label: '响应时效',
    kind: 'critical',
    appliesTo: null,
    definition: '首次响应 ≤ 60 秒；会话中顾客发言后单次等待 ≤ 120 秒（可按消息时间戳判断，系统自动回复除外）。',
    failWhen: ['首次响应超过 60 秒', '顾客发言后超过 120 秒无人回复且未说明', '顾客追问后长时间无响应导致会话中断'],
    passWhen: ['首次响应 ≤ 60 秒，且无超过 120 秒的空档'],
    naWhen: ['会话时间戳缺失，无法计算间隔']
  },
  {
    id: 'accuracy',
    label: '信息准确性',
    kind: 'critical',
    appliesTo: ['pre_sale', 'price', 'order', 'logistics', 'install', 'after_sale', 'return', 'invoice'],
    definition: '商品参数（匹数、能效、适用面积、内外机型号）、价格活动、国补资格、安装收费标准、保修政策必须准确，不得含糊或编造。',
    failWhen: ['参数说错（如把 2 匹说成 1.5 匹、能效等级说错）', '价格/活动与页面或政策不符', '国补资格或补贴金额说错', '安装收费、保修年限、退换货条件说错'],
    passWhen: ['关键参数与政策表述准确，不确定时说明"以页面/后台为准"'],
    naWhen: ['会话未涉及任何参数、价格或政策信息']
  },
  {
    id: 'process',
    label: '流程合规',
    kind: 'critical',
    appliesTo: ['order', 'logistics', 'install', 'after_sale', 'return', 'invoice', 'complaint'],
    definition: '按既有流程处理：该登记登记、该建单建单、该转接转接、该升级报备就报备（退换货、报修、安装预约、发票、纠纷）。',
    failWhen: ['该走退换货/报修流程却只口头答复', '未按规范登记或建工单', '该升级主管/平台介入却未升级', '不符合条件仍承诺退换货'],
    passWhen: ['按流程给出明确路径、时限和下一步动作'],
    naWhen: ['会话仅涉及选购咨询，无流程型操作']
  },
  {
    id: 'resolution',
    label: '问题解决',
    kind: 'critical',
    appliesTo: null,
    definition: '顾客本次的核心问题是否得到解决；本可当次解决的，是否一次解决。',
    failWhen: ['顾客就同一问题追问 ≥2 次仍未得到答案', '客服未回答核心问题，只回无关内容或让顾客"自己看页面"', '本可当次解答却推给顾客自行联系、反复转接且无后续路径', '承诺跟进但未留下跟进方式或时限'],
    passWhen: ['核心问题当场得到明确答复（即使是"没有""不支持"这类否定答复）', '给出明确可执行的后续方案与时限', '需要顾客自行操作但已说明具体步骤'],
    naWhen: ['会话因顾客主动结束或未再追问，且核心问题已明确答复']
  },
  {
    id: 'complaint',
    label: '投诉与敏感诉求',
    kind: 'critical',
    appliesTo: ['complaint', 'after_sale', 'return', 'logistics'],
    definition: '顾客表达不满或提及投诉、315、工商、媒体、差评时，须先安抚，再按规则报备主管。',
    failWhen: ['顾客已明确不满仍机械回复或推诿', '顾客提及投诉/315/媒体曝光未安抚、未报备'],
    passWhen: ['先致歉安抚，说明处理方案，并按需报备升级'],
    naWhen: ['顾客全程无不满表达，也未提及投诉类词汇']
  },
  {
    id: 'logic',
    label: '沟通逻辑',
    kind: 'critical',
    appliesTo: null,
    definition: '准确理解顾客诉求，答复前后一致，不答非所问、不自相矛盾。',
    failWhen: ['答非所问', '前后答复矛盾（如先说可退后说不可退）', '误解顾客需求且未确认'],
    passWhen: ['准确复述或确认需求，答复前后一致'],
    naWhen: []
  },
  {
    id: 'diversion',
    label: '导流与外店链接',
    kind: 'critical',
    appliesTo: null,
    definition: '客服不得把顾客引导到我司以外的店铺成交。判断分三档：①发我司【同一平台其他店铺】的链接或店铺名 → 合规，不判；②发【同平台但非我司店铺】的链接或引导词 → 不合格；③发【其他平台】（拼多多/抖音/闲鱼等）的店铺或引导词 → 不合格。链接域名无法识别归属时，不得判不合格，应判"不适用"交人工核对。',
    failWhen: [
      '发送其他商家店铺链接、商品链接或店铺名称，引导顾客到别家下单',
      '出现"去别家买""别家更便宜""这家不划算你换一家"这类把顾客推向其他商家的表述',
      '引导顾客前往我司未在售的平台（拼多多、抖音、快手、闲鱼等）成交'
    ],
    passWhen: [
      '发送我司同一平台其他店铺的链接或店铺名（如从格力旗舰店引导到格力空调换新）',
      '发送本店商品链接、店铺首页链接、平台官方活动页或帮助页',
      '未出现任何指向其他店铺或平台的内容'
    ],
    naWhen: [
      '会话未出现任何链接、网址或指向其他店铺的表述',
      '出现了链接但域名归属无法识别，且无其他导流迹象（交人工核对）'
    ]
  },

  // ========== 非关键项：6 项 × 5 分 = 30 分，5/3/1 制 ==========
  {
    id: 'opening',
    label: '开场与结束语',
    kind: 'standard',
    appliesTo: null,
    definition: '开场有问候与自我介绍（店铺/工号），结束有礼貌收尾并邀请继续咨询。',
    scoring: {
      5: '开场问候自然、有身份说明；结束语完整礼貌',
      3: '有开场或结束，但缺少身份说明或收尾生硬',
      1: '无开场问候或无结束语，直接开始/直接消失'
    },
    naWhen: []
  },
  {
    id: 'expression',
    label: '语言表达',
    kind: 'standard',
    appliesTo: null,
    definition: '表达简洁有条理、无错别字、不啰嗦、不复制粘贴大段模板。',
    scoring: {
      5: '简明扼要、条理清晰、无错别字',
      3: '能说清但偏啰嗦或有大段模板复制',
      1: '表达混乱、错别字多、难以理解'
    },
    naWhen: []
  },
  {
    id: 'completeness',
    label: '回复完整度（单字回复）',
    kind: 'standard',
    appliesTo: null,
    definition: '客服回复要有实际信息量，不得用单个字或"好的""是的"这类无内容回复敷衍顾客。只统计整条消息只有一个字或两个敷衍字、且没有后续解释的情况；"稍等""收到"属于正常流程用语不算敷衍；顾客问的是非题（能不能/有没有）且客服一个字答清并接续说明的，不算敷衍。',
    scoring: {
      5: '没有单字或敷衍式回复，每条回复都有实际信息',
      3: '偶发 1—2 次单字敷衍（如"嗯""好的"），但核心问题仍答清楚',
      1: '3 次以上用单字或"好的"敷衍顾客，或用单字回复本该解释清楚的问题'
    },
    naWhen: ['客服消息少于 3 条，样本不足以判断回复习惯']
  },
  {
    id: 'initiative',
    label: '服务主动性',
    kind: 'standard',
    appliesTo: null,
    definition: '在满足基本需求外，主动补充顾客未问但有用的信息（安装条件、耗材、保养、以旧换新）。',
    failWhen: [],
    scoring: {
      5: '主动补充关键提醒，替顾客想到下一步',
      3: '顾客问什么答什么，少量补充',
      1: '只作最简回答（"是的""没有"），无任何延伸'
    },
    naWhen: []
  },
  {
    id: 'empathy',
    label: '共情与情绪管理',
    kind: 'standard',
    appliesTo: null,
    definition: '对顾客等待、不满、着急等情绪有回应（致歉、安抚、感谢配合），不冷漠。',
    scoring: {
      5: '及时致歉/安抚/致谢，情绪回应自然',
      3: '有礼貌但缺少情绪回应',
      1: '全程冷漠机械，顾客着急也无回应'
    },
    naWhen: []
  },
  {
    id: 'probing',
    label: '需求确认与销售意识',
    kind: 'standard',
    appliesTo: ['pre_sale', 'price'],
    definition: '选购场景下主动确认面积、户型、匹数、能效偏好、预算等关键信息，并给出匹配建议或关联推荐。',
    scoring: {
      5: '主动确认关键信息并给出针对性推荐',
      3: '有简单询问，但推荐不够具体',
      1: '不询问需求，直接甩链接或让顾客自己看'
    },
    naWhen: ['会话不是选购场景（如纯售后、物流查询）']
  },
  {
    id: 'closing',
    label: '收尾与跟进承诺',
    kind: 'standard',
    appliesTo: null,
    definition: '结束前确认"还有其他问题吗"，需要跟进的给出明确时间点与方式。',
    scoring: {
      5: '主动确认无其他问题，需跟进的给出时间与方式',
      3: '有收尾但未确认需求是否已满足',
      1: '无收尾，会话直接中断'
    },
    naWhen: []
  }
]);

const GRADES = Object.freeze([
  { min: 95, grade: 'A+', label: '优秀' },
  { min: 85, grade: 'A', label: '良好' },
  { min: 70, grade: 'B', label: '达标' },
  { min: 40, grade: 'C', label: '待改进' },
  { min: 0, grade: 'D', label: '不合格' }
]);

const BY_ID = new Map(CRITERIA.map(item => [item.id, item]));

function gradeOf(score) {
  if (score == null || score === '') return { grade: '—', label: '待评分' };
  const value = Number(score);
  if (!Number.isFinite(value)) return { grade: '—', label: '待评分' };
  return GRADES.find(item => value >= item.min) || GRADES[GRADES.length - 1];
}

// 无分类信息时全部适用（宁可多判，不漏判）。
function applicableCriteria(categories) {
  const ids = Array.isArray(categories) && categories.length ? categories : null;
  return CRITERIA.filter(item => !item.appliesTo || !ids || item.appliesTo.some(id => ids.includes(id)));
}

function criterion(id) {
  return BY_ID.get(String(id)) || null;
}

module.exports = {
  RUBRIC_VERSION,
  CRITICAL_WEIGHT,
  STANDARD_WEIGHT,
  STANDARD_MAX,
  CATEGORIES,
  CRITERIA,
  GRADES,
  gradeOf,
  applicableCriteria,
  criterion
};
