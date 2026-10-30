/**
 * 系列名称统一格式（2026-10-28 用户拍板）：
 *   {产品系列名}{三级?}{xx机}({颜色)?}
 *
 * 规则：
 *  1. 只留产品系列名（凉之静、睡梦宝、月亮女神…），剥掉「格力·」前缀；
 *  2. 删除 变频/定频/冷暖/挂机/柜机/空调 和型号串（KFR-35GW/(35553)FNhCc-B1(WIFI)）；
 *  3. 1级能效删除；3级能效保留改写为「三级」（2级同理记「二级」）；插在系列名和 xx机 之间；
 *  4. 取型号「KFR-」后两位数字命名「xx机」（35机 / 26机 / 72机）；
 *  5. 保留颜色（型号或名称末尾的括号，如 (珊瑚玉)；定频老款的「顶 白色」也认）。
 *
 * 例：月亮女神变频冷暖正1.5匹1级能效挂机空调 KFR-35GW/(35579)FNhCc-B1(WIFI)(珊瑚玉)
 *  → 月亮女神35机(珊瑚玉)
 */

const COLOR_BLOCK = /款|管|年|高端|低端|标准|冷酷|线下|线上|顶|新|旧|WIFI|wifi|机|器|型|版|注塑|装饰|京东|天猫|渠道|套机/;

/** 从一堆括号内容里挑最后一个像颜色的：纯汉字、不含「款/管/年」等修饰词 */
function pickColor(candidates) {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const c = String(candidates[i] || '').trim();
    if (/^[一-龥]{1,6}$/.test(c) && !COLOR_BLOCK.test(c)) return c;
  }
  return '';
}

/** 能效等级：1级删、3级→三级、2级→二级；返回 (清洗后的占位文本) */
function efficiencyOf(text) {
  const raw = String(text || '');
  if (/新?[13三1]级/.test(raw)) {
    const three = /新?[3三]级/.test(raw);
    return three ? '三级' : '';
  }
  if (/新?[2二]级/.test(raw)) return '二级';
  return '';
}

/**
 * 由 商品标题 + 型号 生成统一系列名。
 * @returns {{series:string, matched:boolean}} matched=false 表示没能提取出系列名（原样保留，人工看）
 */
function formatSeries(name, model) {
  const raw = String(name || '').trim();
  if (!raw) return { series: '', matched: false };
  let s = raw.replace(/[\uF900-\uFA6D]/g, ch => ch.normalize('NFKC')); // 兼容汉字归一（凉→凉），不动罗马数字 Ⅱ

  /* 颜色：先从全文括号里挑（名称和型号串里的都算），定频老款再看「顶 白色」，
     最后看型号后面裸写的颜色词（如「…FNCa-A3 奢华金」） */
  const parens = [...s.matchAll(/[（(]([^（）()]{1,12})[）)]/g)].map(m => m[1]);
  let color = pickColor(parens);
  if (!color) {
    const ding = s.match(/顶\s*([一-龥]{1,6})/);
    if (ding && !COLOR_BLOCK.test(ding[1])) color = ding[1];
  }
  if (!color) color = pickColor([...String(model || '').matchAll(/[（(]([^（）()]{1,12})[）)]/g)].map(m => m[1]));
  if (!color) {
    const tail = raw.split(/KFR/i).slice(1).join(' ');
    const tokens = tail.replace(/[^一-龥]+/g, ' ').split(/\s+/).filter(Boolean);
    for (let i = tokens.length - 1; i >= 0; i--) {
      const t = tokens[i];
      if (/^[一-龥]{2,6}$/.test(t) && /[白金灰玉银黑红蓝]$/.test(t) && !COLOR_BLOCK.test(t)) { color = t; break; }
    }
  }

  /* 型号「KFR-」后两位数字 */
  const digits = (String(model || '').match(/KFR[DA]?[-‑]\s*(\d{2})/i) || [])[1] || '';

  /* 正式清洗 */
  s = s.replace(/\s+/g, ' ');
  if (/空调/.test(s)) s = s.split('空调')[0];          // 营销语都在「空调」后面，整段不要
  s = s.replace(/KFR\S*/gi, ' ');                       // 型号串连颜色括号一起没了（颜色已提走）
  s = s.replace(/变频|定频|冷暖|挂机|柜机|柜式|挂式|立柜|空调/g, ' ');
  s = s.replace(/[正大小]?[0-9.]+\s*匹/g, ' ');          // 匹数（大1匹 / 正1.5匹 / 2匹）
  const tier = efficiencyOf(s);
  s = s.replace(/新?[123一二三]级(?:能效)?/g, ' ');
  s = s.replace(/“[^”]*”/g, ' ');                        // 「能效“领跑者”」这类项目名整段去掉
  s = s.replace(/除甲醛|能效|领跑者|机型|防爆/g, ' ');     // 功能词 / 项目名残留（不带引号的「领跑者机型」）
  s = s.replace(/式/g, ' ');                              // 「立柜式」被拆剩的「式」
  s = s.replace(/[（(][^（）()]*[）)]/g, ' ');            // 剩下的括号都是「（高端）」这类修饰
  s = s.replace(/^格力[·•・]?/, '');                     // 格力•汉白玉 → 汉白玉
  s = s.replace(/‖/g, 'Ⅱ');                              // 型号里把 Ⅱ 抄成 ‖ 的统一回来
  s = s.replace(/[\w/()（）.·•\-]*\d[\w/()（）.·•\-]*/g, ' '); // 残留的带数字碎片（35553 之类）
  s = s.replace(/[\s·•、，,。_【】\[\]#]+/g, ' ').trim();
  s = s.replace(/(?<=[一-龥])\s+(?=[一-龥])/g, '');       // 「臻 净爽」汉字间空格合并
  s = s.replace(/^[-\s]+|[-\s]+$/g, '');                // 连字符要留（云锦-III），只掐首尾

  if (!s) return { series: '', matched: false };
  const series = `${s}${tier}${digits ? digits + '机' : ''}${color ? `(${color})` : ''}`;
  return { series, matched: true };
}

module.exports = { formatSeries, pickColor, efficiencyOf };
