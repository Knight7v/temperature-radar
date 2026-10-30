'use strict';

// 详情页 → 结构化产品知识。
//
// 两条路：
//  1. 有 DeepSeek：模型读原文，输出外观/卖点/参数/售后。**每条事实必须带 evidence（原文片段）**，
//     落地前逐条回原文核对，找不到的参数直接丢弃、卖点保留但标「待复核」。
//  2. 没有 Key 或调不通：规则解析。宁可少抓，也不猜——型号、参数、外观靠正则，卖点只认关键词行。
//
// 这里不做任何业务判断（不决定「这条卖点重不重要」），只负责把页面变成可核对的事实。

const client = require('../quality/ai/client');
const {
  GROUP_IDS,
  groupById,
  normalizeModel,
  cleanModel,
  isParamNoise,
  isGenericKeyword,
  looksLikeFeature,
  looksLikeService,
  FEATURE_HINTS
} = require('./groups');
const { featureCat } = require('./gree-table');

const MAX_SOURCE = 24000; // 一次喂给模型的字数上限，详情页正文很少超过这个数
const MAX_FEATURES = 30;
const MAX_PARAMS = 80;
const MAX_APPEARANCE = 16;
const MAX_SERVICE = 20;

const text = (value, max) => {
  const clean = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return max && clean.length > max ? clean.slice(0, max) : clean;
};

// 核验用：去掉所有空白再比，允许模型把换行、全角空格写成空格
const compact = value => String(value == null ? '' : value).replace(/\s+/g, '');

const ENTITIES = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&times;': '×',
  '&deg;': '°',
  '&mdash;': '—'
};

/**
 * 把详情页原文（HTML 或已复制出来的文字）清成纯文本。
 * 只做“去标签、还原换行、去重行”，不改写内容——后面要靠它核对引文。
 */
function cleanSource(raw) {
  const input = String(raw == null ? '' : raw);
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  let body = input;
  if (isHtml) {
    body = body
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|dd|dt|td|th)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n· ')
      .replace(/<[^>]+>/g, ' ');
  }
  body = body.replace(/&[a-z#0-9]+;/gi, match => ENTITIES[match.toLowerCase()] || ' ');
  const lines = [];
  const seen = new Set();
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/[\t\u3000]+/g, ' ').replace(/ {2,}/g, ' ').trim();
    if (!line) continue;
    // 详情页同一段文案会重复出现（标题、面包屑、推荐位），完全相同的行只留一次
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }
  const full = lines.join('\n');
  const truncated = full.length > MAX_SOURCE;
  return {
    text: truncated ? full.slice(0, MAX_SOURCE) : full,
    fullChars: full.length,
    chars: Math.min(full.length, MAX_SOURCE),
    truncated,
    isHtml
  };
}

function guessModel(source, groupId) {
  const group = groupById(groupId);
  if (group) {
    const hit = String(source || '').match(group.modelRe);
    if (hit) return cleanModel(hit[0]);
  }
  for (const item of ['gree-ac', 'haier-ac', 'haier-fridge']) {
    const g = groupById(item);
    const hit = String(source || '').match(g.modelRe);
    if (hit) return cleanModel(hit[0]);
  }
  const line = String(source || '')
    .split('\n')
    .find(item => /^(产品)?型号[：:\s]/.test(item));
  if (line) {
    const value = line.replace(/^(产品)?型号[：:\s]*/, '');
    return cleanModel(value.split(/[|｜]/)[0]).slice(0, 40);
  }
  return '';
}

function guessName(source, groupId) {
  const first = String(source || '')
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length >= 6 && !/^型号|^产品参数|^商品详情|^¥|^\d+$/.test(line));
  if (first) return text(first, 80);
  const group = groupById(groupId);
  return group ? group.label : '';
}

/** 从「参数名：值」这类行里抠参数。返回 [{name,value,unit}] */
function parseParams(source) {
  const out = [];
  const seen = new Set();
  for (const line of String(source || '').split('\n')) {
    let name = '';
    let value = '';
    const colon = line.match(/^([^：:]{1,12})[：:]\s*(.+)$/);
    if (colon) {
      name = colon[1].trim();
      value = colon[2].trim();
    } else {
      const spaced = line.match(/^([^\s：:]{2,12})[\s]+(.{1,48})$/);
      if (spaced && /\d/.test(spaced[2])) {
        name = spaced[1].trim();
        value = spaced[2].trim();
      }
    }
    if (!name || !value) continue;
    if (isParamNoise(name)) continue;
    if (value.length > 48) continue;
    // 「颜色：白色」这种属于外观，交给外观区，不重复进参数
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const unitMatch = value.match(/^(-?[\d.]+)\s*([A-Za-z%℃°]{1,6})$/);
    out.push({
      name,
      value,
      unit: unitMatch ? unitMatch[2] : ''
    });
    if (out.length >= MAX_PARAMS) break;
  }
  return out;
}

function parseLabelValues(source, test) {
  const out = [];
  const seen = new Set();
  for (const line of String(source || '').split('\n')) {
    if (!test(line)) continue;
    const hit = line.match(/^([^：:]{2,12})[：:]\s*(.+)$/);
    const label = hit ? hit[1].trim() : line.slice(0, 10).trim();
    const value = hit ? hit[2].trim() : line.trim();
    if (!value || value.length > 60) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label, value });
  }
  return out;
}

const APPEARANCE_RE = /颜色|面板|材质|尺寸|长|宽|高|厚|重量|外观|机身|风口|配色/;

/** 规则兜底：只认关键词行，宁少不多 */
function parseFallback(source, groupId) {
  const group = groupById(groupId);
  const features = [];
  const seen = new Set();
  for (const line of String(source || '').split('\n')) {
    const body = line.replace(/^[·•●▪◆✓★*\-—\d.、)）\s]+/, '').trim();
    if (body.length < 6 || body.length > 80) continue;
    if (!looksLikeFeature(body)) continue;
    const key = body.slice(0, 12);
    if (seen.has(key)) continue;
    seen.add(key);
    const title = body.split(/[，,；;。]/)[0].slice(0, 18);
    features.push({
      title,
      detail: body,
      keywords: sanitizeKeywords(featureKeywords(body), title),
      stage: looksLikeService(body) ? 'after_sale' : 'pre_sale',
      evidence: body,
      needsReview: false
    });
    if (features.length >= MAX_FEATURES) break;
  }
  return {
    group: groupId,
    model: guessModel(source, groupId),
    name: guessName(source, groupId),
    brand: group ? group.brand : '',
    category: group ? group.category : '',
    appearance: parseLabelValues(source, line => APPEARANCE_RE.test(line)).slice(0, MAX_APPEARANCE),
    features,
    params: parseParams(source),
    service: parseLabelValues(source, line => looksLikeService(line) && !/^\d/.test(line)).slice(0, MAX_SERVICE),
    summary: '',
    source: { type: 'text', name: '', chars: String(source || '').length, aiUsed: false }
  };
}

// 从卖点正文里取 2-4 个关键词，用于后面把会话里的顾客提问对上卖点。
// 只取词表里出现过的词，取不到就用标题本身，不自由切词（切错会误导匹配）。
function featureKeywords(body) {
  const hits = FEATURE_HINTS.filter(word => String(body || '').includes(word));
  const unique = [...new Set(hits)].slice(0, 4);
  if (unique.length) return unique;
  const short = String(body || '').split(/[，,；;。、]/)[0].trim();
  return short && short.length <= 10 ? [short] : [];
}

const SYSTEM_PROMPT = `你是空调/冰箱电商团队的"商品资料整理员"。任务：把一段商品详情页原文整理成结构化资料，供客服回答顾客提问时核对。你不写营销文案，不评价商品好坏，不做推荐。

硬性要求：
1. 只允许使用原文里明确写到的信息。原文没有的，宁可不写，也不要按行业常识补。
2. 每一条卖点、参数、售后口径都必须给 evidence：直接抄原文里连续的一段话（10-60 字，不要改写、不要拼接两处）。
3. params 只放可量化的硬参数：匹数、能效等级、制冷量/制热量、功率、噪音、循环风量、尺寸、重量、冷媒、电压、频率范围等。营销词（如"静音舒适""高端大气"）不是参数。
4. features 放卖点：每条 title 不超过 12 字（如"自清洁""防直吹""一级能效"），detail 用原文信息说清它到底指什么（不超过 60 字），keywords 给 1-4 个顾客可能会用的说法（如"费电""电费""耗电"）。
5. stage 判断这条卖点主要在售前用还是售后用：售前 pre_sale（选型、参数、卖点），售后 after_sale（安装、保修、清洗、移机），两者都算 both。
6. appearance 放外观类：颜色、面板材质、室内机尺寸、出风口、机身厚薄等。
7. service 放服务与政策口径：保修年限、安装收费标准、辅材、退换、以旧换新、国补。原文没写就不填。
8. model 必须是原文出现的真实型号（如 KFR-35GW/NhAa1BAj、BCD-501WGHFD14S8U1），照原样抄，不要自己补全。
9. 严格输出 JSON，不要 Markdown 代码块，不要解释文字。数组没有内容时给空数组。

输出 JSON 结构：
{
 "model": "型号",
 "name": "商品标题（原文标题，可截断到 40 字）",
 "brand": "格力 | 海尔",
 "category": "空调 | 冰箱",
 "appearance": [{"label":"颜色","value":"白色"}],
 "features": [{"title":"自清洁","detail":"...","keywords":["..."],"stage":"pre_sale","evidence":"原文片段"}],
 "params": [{"name":"制冷量","value":"3500","unit":"W","evidence":"原文片段"}],
 "service": [{"name":"整机保修","value":"6 年","evidence":"原文片段"}],
 "summary": "不超过 40 字：这台机器最值得客服记住的 1-2 件事"
}`;

function buildMessages({ source, groupId }) {
  const group = groupById(groupId);
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        `分组：${group ? group.label : groupId}（品牌 ${group ? group.brand : ''}，品类 ${group ? group.category : ''}）`,
        '下面三引号里是详情页原文，请按要求整理：',
        '"""',
        source,
        '"""'
      ].join('\n')
    }
  ];
}

/**
 * 有 Key 时走模型。失败（超时、限流、Key 失效）直接抛错，由上层决定是否降级到规则解析。
 */
async function extractWithAi({ source, groupId, signal, retries = 1 }) {
  const built = buildMessages({ source, groupId });
  const result = await client.chatWithRetry(
    { messages: built, maxTokens: 3200, temperature: 0.05, signal },
    { retries }
  );
  const raw = client.parseJson(result.content);
  return {
    raw,
    model: result.model,
    usage: {
      promptTokens: result.usage?.promptTokens ?? null,
      completionTokens: result.usage?.completionTokens ?? null,
      totalTokens: result.usage?.totalTokens ?? null
    }
  };
}

function sanitizeKeywords(list, title) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const word = text(item, 12);
    if (!word || word.length < 2) continue;
    if (isGenericKeyword(word)) continue;
    if (out.includes(word)) continue;
    out.push(word);
    if (out.length >= 4) break;
  }
  if (!out.length) {
    const short = String(title || '').trim();
    if (short && short.length <= 10 && !isGenericKeyword(short)) out.push(short);
  }
  return out;
}

/**
 * 落地前核验：模型给的每条事实都回原文找一遍。
 * 参数找不到就丢（数字错了比没有更糟）；卖点找不到保留但标待复核（措辞允许概括）；
 * 售后口径找不到也丢（政策类说错会直接引发纠纷）。
 */
function verifyExtraction(raw, { source, groupId }) {
  const warnings = [];
  const full = compact(source);
  const group = groupById(groupId);
  const found = value => {
    const needle = compact(value);
    return needle.length >= 2 && full.includes(needle);
  };

  let model = cleanModel(raw?.model || '');
  const guessed = guessModel(source, groupId);
  const sameModel = (a, b) => compact(a).toUpperCase() === compact(b).toUpperCase();
  if (!model) {
    model = guessed;
    if (model) warnings.push(`模型没给型号，已按原文识别为 ${model}`);
  } else if (!found(model)) {
    if (guessed && sameModel(guessed, model)) {
      /* 只是大小写不同：用详情页上的写法，别在台账里显示成全大写 */
      model = guessed;
    } else if (guessed) {
      warnings.push(`模型给的型号「${model}」原文里找不到，已改用 ${guessed}`);
      model = guessed;
    } else {
      warnings.push(`型号「${model}」在原文里找不到，请人工确认`);
    }
  }

  const features = [];
  let droppedFeatures = 0;
  for (const item of Array.isArray(raw?.features) ? raw.features : []) {
    const title = text(item?.title, 18);
    const detail = text(item?.detail, 80);
    const evidence = text(item?.evidence, 90);
    if (!title) continue;
    if (!evidence && !found(detail)) {
      droppedFeatures += 1;
      continue;
    }
    const verified = evidence ? found(evidence) : found(detail);
    if (!verified) droppedFeatures += 1;
    features.push({
      title,
      detail: detail || evidence,
      keywords: sanitizeKeywords(item?.keywords, title),
      stage: ['pre_sale', 'after_sale', 'both'].includes(item?.stage) ? item.stage : 'pre_sale',
      evidence: verified ? evidence : '',
      needsReview: !verified
    });
    if (features.length >= MAX_FEATURES) break;
  }
  if (droppedFeatures) warnings.push(`${droppedFeatures} 条卖点在原文里找不到对应文字，已丢弃`);

  const params = [];
  let droppedParams = 0;
  for (const item of Array.isArray(raw?.params) ? raw.params : []) {
    const name = text(item?.name, 16);
    const value = text(item?.value, 40);
    const evidence = text(item?.evidence, 90);
    if (!name || !value) continue;
    if (isParamNoise(name)) continue;
    const verified = (evidence && found(evidence)) || found(value);
    if (!verified) {
      droppedParams += 1;
      continue;
    }
    params.push({ name, value, unit: text(item?.unit, 8), evidence: evidence || '', needsReview: false });
    if (params.length >= MAX_PARAMS) break;
  }
  if (droppedParams) warnings.push(`${droppedParams} 条参数在原文里找不到，已丢弃（数字写错比不写更危险）`);

  const appearance = (Array.isArray(raw?.appearance) ? raw.appearance : [])
    .map(item => ({ label: text(item?.label, 14), value: text(item?.value, 60) }))
    .filter(item => item.label && item.value && found(item.value))
    .slice(0, MAX_APPEARANCE);

  const service = [];
  let droppedService = 0;
  for (const item of Array.isArray(raw?.service) ? raw.service : []) {
    const name = text(item?.name, 16);
    const value = text(item?.value, 60);
    const evidence = text(item?.evidence, 90);
    if (!name || !value) continue;
    const verified = (evidence && found(evidence)) || found(value);
    if (!verified) {
      droppedService += 1;
      continue;
    }
    service.push({ name, value, evidence: evidence || '' });
    if (service.length >= MAX_SERVICE) break;
  }
  if (droppedService) warnings.push(`${droppedService} 条售后口径在原文里找不到，已丢弃（政策说错会直接引发纠纷）`);

  const name = text(raw?.name, 80) || guessName(source, groupId);
  const brand = text(raw?.brand, 12) || (group ? group.brand : '');
  const category = text(raw?.category, 12) || (group ? group.category : '');

  if (!features.length) warnings.push('没有提取到卖点，可能是详情页正文太短或只有图片');
  if (!params.length) warnings.push('没有提取到参数，建议手动补上匹数、能效等级、噪音这几项');

  return {
    product: {
      group: groupId,
      model,
      name,
      brand,
      category,
      appearance,
      features,
      params,
      service,
      summary: text(raw?.summary, 60),
      source: { type: 'text', name: '', chars: String(source || '').length, aiUsed: true }
    },
    warnings
  };
}

/** 没有任何提取结果时的空壳，供手动填写 */
function emptyProduct(groupId) {
  const group = groupById(groupId);
  return {
    group: GROUP_IDS.has(groupId) ? groupId : 'gree-ac',
    model: '',
    name: '',
    brand: group ? group.brand : '',
    category: group ? group.category : '',
    appearance: [],
    features: [],
    params: [],
    service: [],
    summary: '',
    source: { type: 'manual', name: '', chars: 0, aiUsed: false }
  };
}

const KEY_EQ = value =>
  normalizeModel(value)
    .replace(/[|｜、,，;；\s]/g, '')
    .toLowerCase();

/**
 * 同型号再次导入时的合并规则：
 *  - 参数按名字对齐，新值覆盖旧值（详情页是更新的）；
 *  - 卖点按标题对齐，新的补进来，旧的保留（人可能手动改过，不轻易删）；
 *  - 手工改过的条目（manual=true）任何情况下都不被覆盖。
 */
function mergeProduct(existing, incoming) {
  const base = normalizeForSave(existing || {});
  const next = normalizeForSave(incoming || {});
  const added = { features: 0, params: 0, appearance: 0, service: 0 };

  const mergeList = (a, b, keyOf, label) => {
    const out = a.map(item => ({ ...item }));
    const index = new Map(out.map((item, position) => [keyOf(item), position]));
    for (const item of b) {
      const key = keyOf(item);
      const position = index.get(key);
      if (position == null) {
        out.push({ ...item });
        added[label] += 1;
        continue;
      }
      if (out[position].manual) continue;
      out[position] = { ...out[position], ...item, manual: false };
    }
    return out;
  };

  const features = mergeList(base.features, next.features, item => KEY_EQ(item.title), 'features').slice(0, MAX_FEATURES);
  const params = mergeList(base.params, next.params, item => KEY_EQ(item.name), 'params').slice(0, MAX_PARAMS);
  const appearance = mergeList(base.appearance, next.appearance, item => KEY_EQ(item.label), 'appearance').slice(0, MAX_APPEARANCE);
  const service = mergeList(base.service, next.service, item => KEY_EQ(item.name), 'service').slice(0, MAX_SERVICE);

  return {
    data: {
      ...base,
      ...next,
      /* 这三个字段允许新的覆盖旧的：它们是「这次导入识别出来的」，不是人工判断 */
      group: next.group || base.group,
      model: next.model || base.model,
      name: next.name || base.name,
      /* 标量字段：本次没带（空字符串）就保留旧值 —— 导入脚本只回填部分字段，
         不能把分销清单/在售明细写过的档位、分销标记、系列名洗掉（2026-10-28 修复） */
      brand: next.brand || base.brand || '',
      category: next.category || base.category || '',
      materialCode: next.materialCode || base.materialCode || '',
      masterCode: next.masterCode || base.masterCode || '',
      tier: next.tier || base.tier || '',
      shopSeries: next.shopSeries || base.shopSeries || '',
      series: next.series || base.series || '',
      distribution: next.distribution || base.distribution || '',
      features,
      params,
      appearance,
      service,
      source: next.source && next.source.type !== 'manual' ? { ...base.source, ...next.source } : base.source,
      updatedFrom: next.source?.name || base.source?.name || ''
    },
    added,
    counts: {
      features: features.length,
      params: params.length,
      appearance: appearance.length,
      service: service.length
    }
  };
}

/** 存库前的清洗：限长、去重、丢掉空条目，保证前端拿到的永远是规整结构 */
function normalizeForSave(input) {
  const group = GROUP_IDS.has(input?.group) ? input.group : 'gree-ac';
  const cleanList = (list, max) => (Array.isArray(list) ? list : []).slice(0, max);
  const features = [];
  const featureKeys = new Set();
  for (const item of cleanList(input?.features, MAX_FEATURES)) {
    /* 标题里的「外 机」是表里敲出来的空格：夹在汉字中间的空格直接去掉 */
    const rawTitle = String(item?.title || '').replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '');
    const title = text(rawTitle, 40);
    if (!title) continue;
    /* 推荐理由是内部评价，混进卖点表也不进对客口径 */
    if (/^推荐理由/.test(title)) continue;
    const key = KEY_EQ(title);
    if (key && featureKeys.has(key)) continue;
    featureKeys.add(key);
    features.push({
      title,
      detail: text(item?.detail, 150),
      cat: featureCat(title),
      keywords: sanitizeKeywords(item?.keywords, title),
      stage: ['pre_sale', 'after_sale', 'both'].includes(item?.stage) ? item.stage : 'pre_sale',
      evidence: text(item?.evidence, 120),
      needsReview: Boolean(item?.needsReview),
      manual: Boolean(item?.manual)
    });
  }

  const params = [];
  const paramKeys = new Set();
  for (const item of cleanList(input?.params, MAX_PARAMS)) {
    const name = text(item?.name, 16);
    const value = text(item?.value, 40);
    if (!name || !value) continue;
    const key = KEY_EQ(name);
    if (paramKeys.has(key)) continue;
    paramKeys.add(key);
    params.push({
      name,
      value,
      unit: text(item?.unit, 8),
      evidence: text(item?.evidence, 120),
      needsReview: Boolean(item?.needsReview),
      manual: Boolean(item?.manual)
    });
  }

  const pairs = (list, keyField, max) => {
    const out = [];
    const keys = new Set();
    for (const item of cleanList(list, max)) {
      const label = text(item?.[keyField], 16);
      const value = text(item?.value, 80);
      if (!label || !value) continue;
      const key = KEY_EQ(label);
      if (keys.has(key)) continue;
      keys.add(key);
      out.push({ [keyField]: label, value, evidence: text(item?.evidence, 120), manual: Boolean(item?.manual) });
    }
    return out;
  };

  const source = input?.source && typeof input.source === 'object' ? input.source : {};
  return {
    group,
    model: cleanModel(input?.model || '').slice(0, 40),
    name: text(input?.name, 80),
    brand: text(input?.brand, 12),
    category: text(input?.category, 12),
    /* 物料编码 / 机型档位 / 在售系列 / 系列名称 / 分销标记：来自官方主数据表、在售明细和分销机型清单，跟着数据走 */
    materialCode: text(input?.materialCode, 24),
    masterCode: text(input?.masterCode, 16),
    tier: text(input?.tier, 12),
    shopSeries: text(input?.shopSeries, 40),
    series: text(input?.series, 24),
    distribution: text(input?.distribution, 12),
    appearance: pairs(input?.appearance, 'label', MAX_APPEARANCE),
    features,
    params,
    service: pairs(input?.service, 'name', MAX_SERVICE),
    summary: text(input?.summary, 80),
    source: {
      type: text(source.type, 12) || 'manual',
      name: text(source.name, 120),
      chars: Number(source.chars) || 0,
      aiUsed: Boolean(source.aiUsed),
      importedAt: text(source.importedAt, 40) || new Date().toISOString()
    }
  };
}

/**
 * 把条目标题拆成「顾客可能会用到的说法」。
 * 顾客很少说「整机保修」，一般说「保修几年」；「室内噪音」也常说成「噪音」。
 * 去掉前缀只用于匹配，不改展示名。
 */
function labelKeywords(label) {
  const full = String(label || '').trim();
  if (!full) return [];
  const out = [full];
  const short = full.replace(/^(整机|室内|室外|产品|机身|额定|最大)/, '').trim();
  if (short && short !== full && short.length >= 2) out.push(short);
  return [...new Set(out)];
}

/** 把知识库拍平成一条条可核对的事实，供「顾客问到没答到」的判断使用 */
function productFacts(product) {
  const facts = [];
  for (const item of product?.params || []) {
    facts.push({
      kind: 'param',
      label: item.name,
      value: item.unit ? `${item.value}${item.unit}` : item.value,
      keywords: labelKeywords(item.name),
      stage: 'both'
    });
  }
  for (const item of product?.features || []) {
    facts.push({
      kind: 'feature',
      label: item.title,
      value: item.detail || item.title,
      keywords: [item.title, ...(item.keywords || [])],
      stage: item.stage || 'pre_sale'
    });
  }
  for (const item of product?.service || []) {
    facts.push({
      kind: 'service',
      label: item.name,
      value: item.value,
      keywords: labelKeywords(item.name),
      stage: 'after_sale'
    });
  }
  for (const item of product?.appearance || []) {
    facts.push({
      kind: 'appearance',
      label: item.label,
      value: item.value,
      keywords: labelKeywords(item.label),
      stage: 'pre_sale'
    });
  }
  return facts;
}

/** 给模型看的知识摘要（要短：会话本身已经占了大半上下文） */
function compactForPrompt(product, { maxFacts = 40 } = {}) {
  const lines = [`商品：${product.name || ''}（型号 ${product.model || '未知'}）`];
  const facts = productFacts(product).slice(0, maxFacts);
  for (const item of facts) {
    const tag = { param: '参数', feature: '卖点', service: '售后', appearance: '外观' }[item.kind] || '资料';
    lines.push(`- [${tag}] ${item.label}：${item.value}`);
  }
  return lines.join('\n');
}

module.exports = {
  cleanSource,
  guessModel,
  parseParams,
  parseFallback,
  verifyExtraction,
  extractWithAi,
  emptyProduct,
  mergeProduct,
  normalizeForSave,
  productFacts,
  compactForPrompt,
  featureKeywords,
  labelKeywords,
  MAX_SOURCE
};
