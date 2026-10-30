'use strict';

const client = require('../ai/client');
const { VERSION } = require('./taxonomy');

const REPORT_VERSION = `${VERSION}-report`;

const SYSTEM_PROMPT = `你是电商公司服务运营分析师，向副总经理汇报。给你的是同一批客服会话的统计结果（都是已经算好的数字），你要写出能直接拿去开周会的结论。

硬性要求：
1. 只能使用给定统计里的数字和样本，不得推算、不得补充外部知识、不得编造比例。要引用数字就把原数字写出来（如"87 条问题里 23 条没答清"）。
2. 每个结论必须能落到具体问题上：哪个主题、哪种答复缺陷、哪类顾客顾虑。不要写"服务意识有待提升"这种空话。
3. 行动建议要能派活：写清做什么、谁来做（客服主管/培训/运营/详情页/仓储/售后），不要写"加强培训"就结束。
4. 样本量小（会话少于 30 条）时，结论要用"初步看"这类措辞，不要把话说满。
5. 全文中文，口语化，短句。不写客套话，不写"综上所述"。
6. 严格输出 JSON，不要解释文字，不要用 Markdown 代码块。

输出 JSON：
{
 "headline": "不超过 40 字，一句话说清这批会话最要紧的问题",
 "findings": [
  {"title": "不超过 16 字", "detail": "不超过 90 字，必须带具体数字", "level": "high | medium | low"}
 ],
 "actions": [
  {"action": "不超过 40 字，做什么", "owner": "客服主管 | 培训 | 运营 | 详情页 | 仓储 | 售后", "why": "不超过 40 字，解决哪个问题", "priority": "P0 | P1 | P2"}
 ],
 "watch": ["不超过 30 字，需要留意但样本还不够下结论的点"]
}
findings 给 3-5 条，actions 给 4-6 条，watch 最多 3 条。`;

function compactFacts(stats, meta = {}) {
  return {
    scope: meta.scope || '全部日期',
    sessions: stats.sessions,
    skipped: stats.skipped,
    stageSplit: stats.stages.map(item => ({ label: item.label, sessions: item.sessions, rate: item.rate })),
    questions: stats.questions,
    sessionsWithGap: stats.sessionsWithGap,
    sessionsWithGapRate: stats.sessionsWithGapRate,
    outcomes: stats.outcomes.filter(item => item.count),
    moods: stats.moods.filter(item => item.count),
    concerns: stats.concerns,
    topics: stats.topics.slice(0, 12).map(item => ({
      label: item.label,
      questions: item.questions,
      sessions: item.sessions,
      unresolved: item.unresolved,
      samples: item.samples.slice(0, 2).map(sample => sample.text)
    })),
    gaps: stats.gaps.slice(0, 10).map(item => ({
      label: item.label,
      severity: item.severity,
      questions: item.questions,
      sessions: item.sessions,
      samples: item.samples.slice(0, 2).map(sample => sample.detail)
    })),
    agents: stats.agents.map(item => ({
      agent: item.agent,
      sessions: item.sessions,
      questions: item.questions,
      unresolved: item.unresolved,
      unresolvedRate: item.unresolvedRate,
      topGaps: item.gaps.map(gap => gap.label)
    })),
    openSamples: stats.open.slice(0, 15).map(item => ({
      question: item.text,
      agent: item.agent,
      gaps: item.gapTypes,
      detail: item.gapDetail
    }))
  };
}

async function generateReport(stats, meta = {}) {
  const facts = compactFacts(stats, meta);
  const result = await client.chatWithRetry(
    {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `## 统计范围\n${meta.scope || '全部日期'}\n\n## 统计结果（JSON）\n${JSON.stringify(facts)}\n\n请按要求输出 JSON。` }
      ],
      maxTokens: 1800,
      temperature: 0.2
    },
    { retries: 2 }
  );
  const raw = client.parseJson(result.content);
  const level = new Set(['high', 'medium', 'low']);
  const priority = new Set(['P0', 'P1', 'P2']);
  const clean = (value, max) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);

  return {
    version: REPORT_VERSION,
    model: result.model,
    generatedAt: new Date().toISOString(),
    headline: clean(raw?.headline, 80),
    findings: (Array.isArray(raw?.findings) ? raw.findings : [])
      .filter(item => item && item.title)
      .slice(0, 5)
      .map(item => ({
        title: clean(item.title, 24),
        detail: clean(item.detail, 140),
        level: level.has(item.level) ? item.level : 'medium'
      })),
    actions: (Array.isArray(raw?.actions) ? raw.actions : [])
      .filter(item => item && item.action)
      .slice(0, 6)
      .map(item => ({
        action: clean(item.action, 60),
        owner: clean(item.owner, 12),
        why: clean(item.why, 60),
        priority: priority.has(item.priority) ? item.priority : 'P1'
      })),
    watch: (Array.isArray(raw?.watch) ? raw.watch : []).filter(Boolean).slice(0, 3).map(item => clean(item, 50)),
    usage: {
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null
    }
  };
}

module.exports = { generateReport, REPORT_VERSION, compactFacts };
