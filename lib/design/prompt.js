'use strict';

// 背景提示词工程。
//
// 一条铁律：AI 只负责「背景」，不负责商品，也不负责文字。
//   - 商品用真实照片合成，型号外观必须和实物一致（电商合规，避免货不对版）
//   - 中文文案由 canvas 排版，AI 画中文必然乱码（京东主图带错别字是硬伤）
// 所以这里所有提示词都会强制追加「无文字 / 无标志 / 无商品」的负面约束。

const NEGATIVE_BASE = [
  'text', 'letters', 'words', 'watermark', 'logo', 'signature', 'brand mark',
  'product', 'appliance', 'air conditioner', 'person', 'people', 'hand',
  'cluttered', 'messy', 'low quality', 'blurry', 'distorted', 'oversaturated'
];

// 品类相关的场景倾向：让背景「像这个品类该出现的地方」。
const CATEGORY_HINTS = {
  aircon: 'a residential living room or bedroom where a wall-mounted air conditioner would be installed, clean empty wall area at upper center for mounting',
  'aircon-floor': 'a spacious living room corner where a floor-standing cabinet air conditioner would be placed, clean floor area at lower center',
  fridge: 'a modern kitchen with clean empty space beside cabinetry',
  washer: 'a clean laundry area with empty wall space',
  tv: 'a modern living room with empty wall space above a media console',
  generic: 'a clean modern interior with large empty area for product placement'
};

const PLATFORM_RULES = {
  jd: 'commercial ecommerce photography, clean composition, generous negative space in the center, soft even lighting, background must stay simple so the product reads clearly',
  tmall: 'commercial ecommerce photography, premium lifestyle feel, clean composition, soft lighting',
  pdd: 'commercial ecommerce photography, bright and clear, high key lighting, simple background',
  generic: 'commercial ecommerce photography, clean composition, soft lighting, generous negative space'
};

// 画面比例 -> 生成尺寸。硅基流动按 image_size 传，必须是 "宽x高"。
const SIZES = Object.freeze({
  square: { imageSize: '1024x1024', label: '1:1 主图', width: 1024, height: 1024 },
  portrait: { imageSize: '1024x1536', label: '2:3 竖版', width: 1024, height: 1536 },
  wide: { imageSize: '1536x1024', label: '3:2 横版', width: 1536, height: 1024 }
});

function pickSize(key) {
  return SIZES[String(key || 'square')] ? String(key || 'square') : 'square';
}

function sizeOf(key) {
  return SIZES[pickSize(key)];
}

function normalizeText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

// 把用户的一句话（中文），拼成模型能听懂的结构化英文描述。
// 用户写中文时保留中文描述也能出图，但补上英文的构图约束效果更稳。
function build({ scene, category, platform, direction, hasText, ratio }) {
  const parts = [];
  const base = CATEGORY_HINTS[String(category || '')] || CATEGORY_HINTS.generic;
  parts.push(`Empty interior background for ecommerce product photo, ${base}.`);

  const userDirection = normalizeText(direction, 200);
  if (userDirection) parts.push(`Scene and mood: ${userDirection}.`);
  if (scene && scene.prompt) parts.push(`Reference style: ${scene.prompt}.`);

  parts.push(PLATFORM_RULES[String(platform || '')] || PLATFORM_RULES.generic);

  // 需要叠文案时，明确要求留白，否则字压在家具上非常难看。
  parts.push(
    hasText
      ? 'Leave a large clean low-detail area for text overlay, keep that area free of pattern and clutter.'
      : 'Keep the center composition clean and uncluttered.'
  );

  const { width, height } = sizeOf(ratio);
  parts.push(`Aspect ratio ${width}:${height}.`);
  parts.push('Absolutely no text, no letters, no logo, no watermark, no people, no appliance or product in the image.');

  return {
    prompt: parts.join(' '),
    negativePrompt: NEGATIVE_BASE.join(', ')
  };
}

// DeepSeek 扩写用：给它一个能被校验的输出结构，避免自由发挥写出违规内容。
function instruction() {
  return [
    '你是电商视觉摄影指导。把商家的一句话需求，扩写成一段可直接给文生图模型使用的英文背景描述。',
    '硬性要求：',
    '1) 只描述空场景（背景板），绝对不能描述任何商品、品牌、文字、人物；',
    '2) 必须写清光线方向与质感、色调、材质（墙面/地面）、构图留白位置；',
    '3) 长度 60-120 个英文单词，用逗号分隔短语，不要写成句子段落；',
    '4) 不要出现「best quality」「8k」这类无意义堆砌词。',
    '只输出 JSON：{"prompt":"英文描述","negative":"需要避免的元素，英文逗号分隔","note":"一句中文说明这个场景适合什么卖点"}'
  ].join('\n');
}

module.exports = { build, instruction, sizeOf, pickSize, SIZES, CATEGORY_HINTS, NEGATIVE_BASE };
