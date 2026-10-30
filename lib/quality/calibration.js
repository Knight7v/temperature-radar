'use strict';

// 质检准确率校准：先从已有 AI 结果的会话里按档位分层抽一批，让主管盲评给档位，
// 再算「AI 和主管的看法有多接近」。
//
// 三条设计原则：
// 1. 分层抽样，不是随机抽样。完全随机抽 60 条，里面大约 45 条都是 A 档，
//    看不出任何问题；所以优秀（A+）和不及格（D）两端要多抽。
// 2. 抽样必须可复现。用 sessionId 哈希排序取前 N 条，同样的候选池永远出同一批，
//    主管分三次做完、中间重启服务，都不会换题。
// 3. 一致性要分「差一档」和「差两档以上」。B 判成 A 是正常抖动，
//    A 判成 D 是漏判——把烂会话放过去了，必须单独计数。

const GRADE_ORDER = ['A+', 'A', 'B', 'C', 'D'];

// 档位折算成分数，只用于算「AI 平均偏高还是偏低」
const GRADE_REP = { 'A+': 97.5, A: 90, B: 77.5, C: 55, D: 20 };

// 默认配额合计 60：A+ 5 / A 20 / B 10 / C 5 / D 20
const DEFAULT_QUOTA = { 'A+': 5, A: 20, B: 10, C: 5, D: 20 };
const DEFAULT_SIZE = 60;

// 名额不足时的补齐顺序：优先低分档，因为「漏判烂会话」代价最大
const REFILL_ORDER = ['D', 'C', 'B', 'A', 'A+'];

function hash32(text) {
  let hash = 2166136261;
  const value = String(text || '');
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  // FNV 直接输出时，前缀相同的 ID 会聚在同一数值区间，排序后档位成片暴露；
  // 这里补一轮 murmur3 的雪崩混合，把高位的影响打散。
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function gradeIndex(grade) {
  return GRADE_ORDER.indexOf(String(grade || '').trim().toUpperCase());
}

/** 统一成 A+/A/B/C/D；没有存档位时按分数反推，两者都没有则视为不可用 */
function normalizeGrade(grade, score) {
  const text = String(grade || '').trim().toUpperCase();
  if (GRADE_ORDER.includes(text)) return text;
  if (score == null || score === '') return '';
  const value = Number(score);
  if (!Number.isFinite(value)) return '';
  if (value >= 95) return 'A+';
  if (value >= 85) return 'A';
  if (value >= 70) return 'B';
  if (value >= 40) return 'C';
  return 'D';
}

/**
 * 分层抽样。
 * candidates: [{ session_id, agent, started_at, score, grade, ai_summary }]
 * 返回 { items, size, missing }，items 已按哈希打散，避免主管从顺序里猜出 AI 档位。
 */
function buildSample(candidates, options = {}) {
  const size = Math.max(1, Math.round(Number(options.size) || DEFAULT_SIZE));
  const seed = String(options.seed || '');
  const quota = { ...DEFAULT_QUOTA, ...(options.quota || {}) };
  // 目标条数不是 60 时按比例缩放配额，保证各层结构不变
  const scale = size / DEFAULT_SIZE;

  const groups = new Map();
  for (const item of candidates || []) {
    if (!item || !item.session_id) continue;
    const grade = normalizeGrade(item.grade, item.score);
    if (!grade) continue;
    if (!groups.has(grade)) groups.set(grade, []);
    groups.get(grade).push({ ...item, grade });
  }
  for (const list of groups.values()) {
    list.sort((a, b) => hash32(seed + a.session_id) - hash32(seed + b.session_id));
  }

  const picked = [];
  const missing = [];
  const used = new Set();
  for (const grade of GRADE_ORDER) {
    const list = groups.get(grade) || [];
    const want = Math.max(0, Math.round((Number(quota[grade]) || 0) * scale));
    const take = Math.min(want, list.length);
    for (const item of list.slice(0, take)) {
      picked.push(item);
      used.add(item.session_id);
    }
    if (take < want) missing.push({ grade, want, got: take, gap: want - take });
  }

  // 名额不足从其他档位补：按 REFILL_ORDER 逐层补，取该层还没被抽中的
  let need = size - picked.length;
  for (const grade of REFILL_ORDER) {
    if (need <= 0) break;
    for (const item of groups.get(grade) || []) {
      if (need <= 0) break;
      if (used.has(item.session_id)) continue;
      picked.push(item);
      used.add(item.session_id);
      need -= 1;
    }
  }

  picked.sort((a, b) => hash32(`${seed}#${a.session_id}`) - hash32(`${seed}#${b.session_id}`));

  const pool = {};
  for (const grade of GRADE_ORDER) pool[grade] = (groups.get(grade) || []).length;

  return {
    items: picked,
    size,
    picked: picked.length,
    shortage: size - picked.length,
    missing,
    pool
  };
}

/**
 * 统计一致率。
 * marks: [{ aiGrade, aiScore, humanGrade }]
 * options.population: { 'A+': 9, A: 123, ... } 全体已分析会话的各档数量，用于加权还原
 */
function summarize(marks, options = {}) {
  const rows = [];
  for (const item of marks || []) {
    if (!item) continue;
    const aiGrade = normalizeGrade(item.aiGrade, item.aiScore);
    const humanGrade = normalizeGrade(item.humanGrade, null);
    if (!aiGrade || !humanGrade) continue;
    rows.push({
      aiGrade,
      humanGrade,
      aiScore: item.aiScore == null ? null : Number(item.aiScore)
    });
  }

  const byGrade = {};
  for (const grade of GRADE_ORDER) {
    byGrade[grade] = { grade, n: 0, exact: 0, close: 0, miss: 0, alarm: 0, rate: null };
  }
  const confusion = {};

  let exact = 0;
  let close = 0;
  let far = 0;
  let severeMiss = 0;
  let severeAlarm = 0;
  let biasSum = 0;
  let biasCount = 0;

  for (const row of rows) {
    const aiIndex = gradeIndex(row.aiGrade);
    const humanIndex = gradeIndex(row.humanGrade);
    const gap = Math.abs(aiIndex - humanIndex);

    if (!confusion[row.aiGrade]) confusion[row.aiGrade] = {};
    confusion[row.aiGrade][row.humanGrade] = (confusion[row.aiGrade][row.humanGrade] || 0) + 1;

    const bucket = byGrade[row.aiGrade];
    bucket.n += 1;
    if (gap === 0) {
      exact += 1;
      bucket.exact += 1;
    }
    if (gap <= 1) {
      close += 1;
      bucket.close += 1;
    } else {
      far += 1;
    }
    // 漏判：AI 说优秀或良好，主管说待改进或不合格
    if (aiIndex <= 1 && humanIndex >= 3) {
      severeMiss += 1;
      bucket.miss += 1;
    }
    // 误伤：AI 说不合格，主管说优秀或良好
    if (aiIndex >= 3 && humanIndex <= 1) {
      severeAlarm += 1;
      bucket.alarm += 1;
    }
    if (row.aiScore != null && Number.isFinite(row.aiScore)) {
      biasSum += GRADE_REP[row.humanGrade] - row.aiScore;
      biasCount += 1;
    }
  }

  for (const grade of GRADE_ORDER) {
    const bucket = byGrade[grade];
    bucket.rate = bucket.n ? Math.round((bucket.exact / bucket.n) * 1000) / 1000 : null;
  }

  const marked = rows.length;
  const population = options.population || null;
  let weightedExactRate = null;
  let weightedCoverage = 0;
  if (population) {
    let weighted = 0;
    let total = 0;
    for (const grade of GRADE_ORDER) {
      const weight = Number(population[grade]) || 0;
      const bucket = byGrade[grade];
      if (!weight || !bucket.n) continue;
      weighted += weight * (bucket.exact / bucket.n);
      total += weight;
    }
    if (total) {
      weightedExactRate = Math.round((weighted / total) * 1000) / 1000;
      const all = GRADE_ORDER.reduce((sum, grade) => sum + (Number(population[grade]) || 0), 0);
      weightedCoverage = all ? Math.round((total / all) * 1000) / 1000 : 0;
    }
  }

  return {
    marked,
    exact,
    exactRate: marked ? Math.round((exact / marked) * 1000) / 1000 : null,
    close,
    closeRate: marked ? Math.round((close / marked) * 1000) / 1000 : null,
    far,
    severeMiss,
    severeAlarm,
    avgBias: biasCount ? Math.round((biasSum / biasCount) * 10) / 10 : null,
    byGrade: GRADE_ORDER.map(grade => byGrade[grade]),
    confusion,
    weightedExactRate,
    weightedCoverage
  };
}

const pct = value => `${Math.round((Number(value) || 0) * 1000) / 10}%`;

/**
 * 把统计结果翻译成一句能直接汇报的话。
 * 分档标准看两件事：漏判占多少、档位一致率多高。
 * ok（可以放心用）/ watch（能筛问题，结论要人工确认）/ risk（漏判偏多，先调规则）
 */
function describe(summary) {
  const data = summary || {};
  if (!data.marked) {
    return { level: 'empty', headline: '还没有打分，先评几条再看结论', details: [] };
  }
  const details = [];
  let level = 'ok';
  const raise = next => {
    const rank = { ok: 0, watch: 1, risk: 2 };
    if (rank[next] > rank[level]) level = next;
  };

  const missShare = data.marked ? data.severeMiss / data.marked : 0;
  if (data.severeMiss > 0) {
    // 一条漏判在 20 条样本里是 5%，在 60 条里是 1.7%——按比例说，比按条数说更准
    if (missShare >= 0.1) {
      raise('risk');
      details.push(`${data.marked} 条里漏判了 ${data.severeMiss} 条（${pct(missShare)}），AI 判良好以上、主管判待改进或不合格 —— 等于把有问题的会话放过去了`);
    } else {
      raise('watch');
      details.push(`有 ${data.severeMiss} 条漏判（占 ${pct(missShare)}），比例不高，但要逐条看是什么情况再决定要不要调规则`);
    }
  }
  if (data.severeAlarm > 0) {
    raise('watch');
    details.push(`有 ${data.severeAlarm} 条 AI 判为不合格、主管判为优秀或良好 —— 属于误伤，客服会觉得冤枉`);
  }
  if (data.exactRate != null && data.exactRate < 0.6) {
    raise('risk');
    details.push(`档位完全一致率 ${pct(data.exactRate)}，低于 60%，说明判定尺度和主管差得比较多`);
  } else if (data.exactRate != null && data.exactRate < 0.8) {
    raise('watch');
    details.push(`档位完全一致率 ${pct(data.exactRate)}，落在 60%—80%，可以用来筛问题，但不能直接当定论`);
  } else if (data.exactRate != null) {
    details.push(`档位完全一致率 ${pct(data.exactRate)}，AI 判定和主管的判断基本对得上`);
  }
  if (data.avgBias != null && Math.abs(data.avgBias) >= 5) {
    details.push(`平均分差 ${data.avgBias > 0 ? '+' + data.avgBias : data.avgBias} 分，AI 整体偏${data.avgBias > 0 ? '严' : '松'}`);
  }
  if (data.marked < 30) {
    details.push(`目前只评了 ${data.marked} 条，样本偏少，结论先当参考，评到 30 条以上更稳`);
  }

  const headline = level === 'risk'
    ? 'AI 判定漏判偏多，先看看分歧的会话再决定要不要调规则'
    : level === 'watch'
      ? 'AI 判定可以用来筛问题会话，但结论要人工确认'
      : 'AI 判定和主管基本一致，可以放心作为参考';

  return { level, headline, details };
}

module.exports = {
  GRADE_ORDER,
  GRADE_REP,
  DEFAULT_QUOTA,
  DEFAULT_SIZE,
  hash32,
  gradeIndex,
  normalizeGrade,
  buildSample,
  summarize,
  describe
};
