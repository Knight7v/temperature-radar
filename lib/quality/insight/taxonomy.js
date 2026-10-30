'use strict';

// 消费者洞察口径（数据驱动）。改口径只改本文件，改完必须升 VERSION，
// 否则批量分析会跳过旧结果、前端也会把新旧两份数据混在一起统计。
//
// 定位：质检回答「这一单该打几分」，洞察回答「顾客到底在问什么、我们哪里没答好」。
// 因此这里只有“问题类型”和“答复缺陷类型”，没有任何分数与等级。

const VERSION = 'consumer-insight-v1';

const STAGES = Object.freeze([
  { id: 'pre_sale', label: '售前' },
  { id: 'after_sale', label: '售后' },
  { id: 'mixed', label: '售前售后混合' },
  { id: 'none', label: '无可分析内容' }
]);

// 问题主题：空调电商（京东/天猫）真实咨询里出现频次最高的十几类。
// stage 只是默认归属，真实归属以模型判定的 question.stage 为准（同一主题售前售后都可能问）。
const TOPICS = Object.freeze([
  { id: 'selection', label: '选购对比', stage: 'pre_sale', definition: '在两三个型号之间选哪个、哪个更适合自己、匹数与房间面积怎么配' },
  { id: 'spec', label: '功能参数', stage: 'pre_sale', definition: '具体功能与参数：能效、耗电、噪音、防直吹、自清洁、WiFi、尺寸' },
  { id: 'price', label: '价格与活动', stage: 'pre_sale', definition: '现在多少钱、有没有活动、能不能再便宜、保价、什么时候买最划算' },
  { id: 'subsidy', label: '国补与以旧换新', stage: 'pre_sale', definition: '国补资格、可补贴地区、补贴额度、怎么用、以旧换新流程' },
  { id: 'bundle', label: '套装与多台搭配', stage: 'pre_sale', definition: '柜机加挂机怎么配、分开买还是套装买、多台是否更便宜' },
  { id: 'install_pre', label: '安装条件与费用', stage: 'pre_sale', definition: '是否免费安装、加长管线/外机架/打孔/高空作业收不收费、安装环境要求' },
  { id: 'delivery_pre', label: '库存与发货时效', stage: 'pre_sale', definition: '有没有现货、多久发货、能不能指定时间送达' },
  { id: 'gift', label: '赠品与附加服务', stage: 'pre_sale', definition: '送不送清洗券、赠品、延保、支架，能不能多送' },
  { id: 'invoice', label: '发票', stage: 'pre_sale', definition: '能不能开票、专票普票、开票时间与信息' },
  { id: 'logistics', label: '物流异常', stage: 'after_sale', definition: '一直不发货、物流不动、送错地址、签收异常' },
  { id: 'install_booking', label: '安装预约与进度', stage: 'after_sale', definition: '约不上安装、师傅没联系、上门时间、安装进度' },
  { id: 'install_fee_dispute', label: '安装收费争议', stage: 'after_sale', definition: '现场被加收费用、增项不认可、要求退安装费' },
  { id: 'repair', label: '故障维修', stage: 'after_sale', definition: '不制冷/不制热、噪音、漏水、漏氟、报修与上门维修' },
  { id: 'return', label: '退换货与退款', stage: 'after_sale', definition: '退货、换货、退款到账、退货运费与折旧' },
  { id: 'warranty', label: '质保与保修范围', stage: 'after_sale', definition: '保修几年、包修范围、自行加管/移机是否还保、经销商变更后谁负责' },
  { id: 'subsidy_refund', label: '国补核销与退回', stage: 'after_sale', definition: '退货后国补资格怎么退、补贴款退回、资格被占用' },
  { id: 'complaint', label: '投诉与升级', stage: 'after_sale', definition: '要求投诉、赔偿、找平台介入、曝光，或对处理进度不满' },
  { id: 'other', label: '其他', stage: null, definition: '以上都不属于的咨询' }
]);

// 客服答复缺陷：只记录“原文能指出”的缺陷，不记录“本可以更主动”这类推测。
// severity 只用于排序与展示，不参与任何打分。
const GAP_TYPES = Object.freeze([
  { id: 'no_reply', label: '未回复', severity: 'high', definition: '顾客的问题在会话结束前没有任何客服答复' },
  { id: 'partial', label: '只答一半', severity: 'high', definition: '顾客一次问了多个点，只回答了其中一部分' },
  { id: 'off_topic', label: '答非所问', severity: 'high', definition: '答复内容不是顾客问的那件事（问 A 答 B、或答成别的型号）' },
  { id: 'vague', label: '口径含糊', severity: 'high', definition: '用“应该、大概、看情况、不一定”等给不出确定答案，顾客无法据此决策' },
  { id: 'wrong_info', label: '信息可能有误', severity: 'high', definition: '给出的参数、政策、时效与常识或同会话前后表述冲突，需人工核实' },
  { id: 'no_close', label: '未闭环', severity: 'high', definition: '没有给出下一步、时间点或责任人，问题悬空结束' },
  { id: 'no_verify', label: '未核实就承诺', severity: 'high', definition: '没确认型号、订单、地区、补贴资格就给出承诺或结论' },
  { id: 'no_step', label: '缺操作步骤', severity: 'medium', definition: '只说了“可以/不能”，没说顾客具体该怎么操作、找谁、在哪点' },
  { id: 'no_followup', label: '未追问澄清', severity: 'medium', definition: '顾客表述含糊或信息不全，客服没有追问就直接作答' },
  { id: 'push_sale', label: '只推单不解惑', severity: 'medium', definition: '顾客在问参数或费用，客服主推下单、催付款，没有回答原问题' },
  { id: 'slow', label: '响应慢且无说明', severity: 'medium', definition: '顾客等待超过两分钟且客服没有说明原因或致歉' },
  { id: 'template', label: '模板刷屏', severity: 'low', definition: '大段复制固定话术或图片，与顾客当次问题对不上' }
]);

// 顾客顾虑：售前最常拦单的几类心理，用来给详情页/话术/客服培训找方向。
const CONCERNS = Object.freeze([
  { id: 'price', label: '怕买贵' },
  { id: 'subsidy', label: '怕拿不到补贴' },
  { id: 'install_cost', label: '怕安装加钱' },
  { id: 'energy', label: '怕费电' },
  { id: 'noise', label: '怕噪音' },
  { id: 'quality', label: '怕质量与售后' },
  { id: 'size', label: '怕装不下/尺寸不合' },
  { id: 'timing', label: '怕到货或安装太慢' }
]);

const MOODS = Object.freeze([
  { id: 'neutral', label: '平静' },
  { id: 'anxious', label: '着急' },
  { id: 'angry', label: '不满' },
  { id: 'pleased', label: '满意' },
  { id: 'unknown', label: '看不出' }
]);

const OUTCOMES = Object.freeze([
  { id: 'resolved', label: '已解决' },
  { id: 'pending', label: '待跟进' },
  { id: 'unresolved', label: '未解决' },
  { id: 'unknown', label: '不确定' }
]);

const ANSWER_STATES = Object.freeze([
  { id: 'yes', label: '已答清' },
  { id: 'partial', label: '答了一半' },
  { id: 'no', label: '没答' },
  { id: 'unknown', label: '看不出' }
]);

const TOPIC_MAP = new Map(TOPICS.map(item => [item.id, item]));
const GAP_MAP = new Map(GAP_TYPES.map(item => [item.id, item]));
const CONCERN_MAP = new Map(CONCERNS.map(item => [item.id, item]));
const STAGE_MAP = new Map(STAGES.map(item => [item.id, item]));
const OUTCOME_MAP = new Map(OUTCOMES.map(item => [item.id, item]));
const MOOD_MAP = new Map(MOODS.map(item => [item.id, item]));

const topicLabel = id => TOPIC_MAP.get(id)?.label || '其他';
const gapLabel = id => GAP_MAP.get(id)?.label || '未归类';
const gapSeverity = id => GAP_MAP.get(id)?.severity || 'medium';
const concernLabel = id => CONCERN_MAP.get(id)?.label || '';
const stageLabel = id => STAGE_MAP.get(id)?.label || '未判定';

// 未解决的问题若模型没给缺陷类型，统一落到“未归类”，不能静默丢弃——否则未解决率会偏低。
const UNCLASSIFIED = Object.freeze({ id: 'unclassified', label: '未说明不足', severity: 'medium' });

module.exports = {
  VERSION,
  STAGES,
  TOPICS,
  GAP_TYPES,
  CONCERNS,
  MOODS,
  OUTCOMES,
  ANSWER_STATES,
  UNCLASSIFIED,
  TOPIC_MAP,
  GAP_MAP,
  CONCERN_MAP,
  OUTCOME_MAP,
  MOOD_MAP,
  topicLabel,
  gapLabel,
  gapSeverity,
  concernLabel,
  stageLabel
};
