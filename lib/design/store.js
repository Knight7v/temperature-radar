'use strict';

// 生成结果的落盘管理。
//
// 图片存到 assets/design/generated/（在 dev-server 的静态白名单内，可直接用 <img> 访问）。
// 之所以要落盘而不是每次传 base64：一张 1024 图约 1.5 MB，base64 再涨 33%，
// 传过去再进 canvas 会让页面明显卡顿；落盘后浏览器还能缓存，同一张背景可反复复用。
//
// 部署到只读文件系统（Vercel）时会写失败，此时返回 null，由上层降级成 base64 内联。

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../assets/design/generated');
const URL_PREFIX = '/assets/design/generated';
const MAX_KEEP = 200;

function stamp(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

// 用提示词 + 时间做指纹：同样的提示词在同一秒内重复提交会命中同一个文件名，
// 相当于顺手做了去重，避免连点按钮产生一堆一模一样的图。
function fingerprint(prompt, extra) {
  return crypto
    .createHash('sha1')
    .update(`${prompt}|${extra || ''}`)
    .digest('hex')
    .slice(0, 10);
}

function ensureDir() {
  fs.mkdirSync(ROOT, { recursive: true });
}

function prune(keep = MAX_KEEP) {
  let names;
  try {
    names = fs.readdirSync(ROOT).filter(name => /\.(jpe?g|png|webp)$/i.test(name));
  } catch {
    return 0;
  }
  if (names.length <= keep) return 0;
  const stats = names
    .map(name => {
      const full = path.join(ROOT, name);
      try {
        return { name, full, time: fs.statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.time - b.time);
  let removed = 0;
  for (const item of stats.slice(0, stats.length - keep)) {
    try {
      fs.rmSync(item.full, { force: true });
      fs.rmSync(item.full.replace(/\.[^.]+$/, '.json'), { force: true });
      removed += 1;
    } catch {
      // 清理失败不影响主流程
    }
  }
  return removed;
}

// 返回 { url, file, bytes } 或 null（写不进去时）
function save(buffer, { prompt, model, scene, meta } = {}) {
  if (!buffer || !buffer.length) return null;
  try {
    ensureDir();
    const name = `${stamp()}-${fingerprint(prompt, model)}.jpg`;
    const full = path.join(ROOT, name);
    fs.writeFileSync(full, buffer);
    fs.writeFileSync(
      full.replace(/\.jpg$/, '.json'),
      JSON.stringify(
        {
          prompt: String(prompt || ''),
          model: String(model || ''),
          scene: String(scene || ''),
          createdAt: new Date().toISOString(),
          bytes: buffer.length,
          ...(meta || {})
        },
        null,
        2
      )
    );
    prune();
    return { url: `${URL_PREFIX}/${name}`, file: name, bytes: buffer.length };
  } catch {
    return null;
  }
}

function toDataUrl(buffer, mime = 'image/jpeg') {
  if (!buffer || !buffer.length) return '';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

module.exports = { save, toDataUrl, ROOT, URL_PREFIX, prune };
