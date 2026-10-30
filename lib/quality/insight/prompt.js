'use strict';

const { renderTranscript } = require('../ai/prompt');
const { TOPICS, GAP_TYPES, CONCERNS, MOODS, OUTCOMES, VERSION } = require('./taxonomy');

const SYSTEM_PROMPT = `你是空调电商（格力/海尔，京东与天猫）客服团队的服务洞察分析师。你的任务只有一件：把一段客服会话读成结构化事实——顾客问了什么、客服答到什么程度、哪里不够。你不打分、不评级、不写质检结论、不评价客服态度。

硬性要求：
1. 只依据给定会话原文。不得引入外部知识、行业惯例、政策记忆，也不得推测平台规则。
2. 顾客问题必须真的来自顾客消息。messageId 必须是会话里真实存在的顾客消息编号，text 用顾客自己的话概括（不超过 30 字，优先直接引用原句）。
3. 同一件事被顾客反复追问，只记 1 条，repeat 标 true，messageId 用第一次提问的那条。每段会话最多 6 条问题，多的话只留最影响成交或最影响售后的。
4. 一条会话里顾客只发了链接、表情、或只有打招呼，就输出 1 条问题：text 写"咨询商品链接"/"仅打招呼"，answered 用 unknown，gapTypes 留空数组。
5. answered 判定：
   · yes = 顾客问的点都得到了明确、可直接照做的答复；
   · partial = 只答了一部分点，或答了但缺关键信息（如只说"可以退"没说怎么退）；
   · no = 顾客问了，客服没答（含会话结束仍无回复）；
   · unknown = 原文看不出结果，或需要订单/后台/政策才能确认。
6. answered 是 partial 或 no 时，必须给至少 1 个 gapTypes，并给 gapDetail（不超过 40 字，说清缺什么），evidenceMessageId 指向最能说明问题的客服消息；客服全程没说话时，用顾客那条消息的编号。
7. 判定尺度：只有当原文能指出具体缺陷时才标 partial / no。客服已经回答、只是不够热情、不够主动、话少一点，一律算 yes。顾客没有追问、没有重复问、也没有说没听懂，默认问题已经解决。
8. 不要因为客服用了模板问候语就判 partial；模板只在"顾客问了具体问题、客服回了一段对不上的固定话术"时才记 template。
9. wrong_info 只用于原文自身矛盾（前后两处说法不一致）或明显算错（如 1.5 匹说成 2 匹）。需要外部核对才能判断的，用 unknown，不要猜。
10. 顾客情绪、成交/未成交判断只看原文，看不出来用 unknown。
11. 严格输出 JSON，不要输出解释文字，不要用 Markdown 代码块。

输出 JSON 格式：
{
 "stage": "pre_sale | after_sale | mixed | none",
 "outcome": "resolved | pending | unresolved | unknown",
 "mood": "neutral | anxious | angry | pleased | unknown",
 "questions": [
  {
   "text": "顾客问题的概括（不超过 30 字）",
   "messageId": 0,
   "topic": "主题 id",
   "stage": "pre_sale | after_sale",
   "repeat": false,
   "answered": "yes | partial | no | unknown",
   "gapTypes": ["缺陷 id"],
   "gapDetail": "缺什么（不超过 40 字）",
   "evidenceMessageId": 0
  }
 ],
 "concerns": ["顾虑 id，最多 2 个，看不出来就留空数组"],
 "summary": "不超过 60 字：顾客要什么、最后到哪一步",
 "coaching": "不超过 60 字：给这位客服的一条具体改进建议，只针对本次会话里真实出现的不足"
}`;

function renderTaxonomy() {
  return [
    '## 问题主题（topic 只能取以下 id）',
    TOPICS.map(item => `- ${item.id} = ${item.label}：${item.definition}`).join('\n'),
    '',
    '## 答复缺陷（gapTypes 只能取以下 id）',
    GAP_TYPES.map(item => `- ${item.id} = ${item.label}（${item.severity}）：${item.definition}`).join('\n'),
    '',
    '## 顾客顾虑（concerns 只能取以下 id）',
    CONCERNS.map(item => `- ${item.id} = ${item.label}`).join('\n'),
    '',
    '## 其他枚举',
    `outcome：${OUTCOMES.map(item => item.id + '=' + item.label).join('；')}`,
    `mood：${MOODS.map(item => item.id + '=' + item.label).join('；')}`
  ].join('\n');
}

function buildMessages({ session }) {
  const transcript = renderTranscript(session);
  const agent = String(session?.agent || '未识别');
  const customerMessages = (Array.isArray(session?.messages) ? session.messages : []).filter(item => item?.role === 'customer' && String(item?.text || '').trim());

  const user = `## 会话信息
客服：${agent}
开始时间：${session?.startedAt || '未知'}
顾客消息条数：${customerMessages.length}

${renderTaxonomy()}

${transcript.truncated ? `注意：原会话共 ${transcript.totalMessages} 条，中间已省略，只能基于可见部分判断。\n` : ''}
## 会话原文
${transcript.text}

请按要求输出 JSON。`;

  return {
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user }
    ],
    transcriptMeta: { truncated: transcript.truncated, totalMessages: transcript.totalMessages },
    version: VERSION
  };
}

module.exports = { SYSTEM_PROMPT, buildMessages, renderTaxonomy };
