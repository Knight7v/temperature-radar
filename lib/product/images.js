'use strict';

// 产品详情图片：格力系统导出的「详情图 / 详情头图」压缩包。
//
// 命名：主数据编码(序号).jpg，例 5538984(01).jpg —— 序号即图片顺序。
// 详情头图（白底）= 商品主图，详情图 = 商品详情。
// 图片二进制以 base64 存 product_images 表（0015 迁移），重复导入同位置直接覆盖。

const fs = require('node:fs');
const path = require('node:path');
const yauzl = require('yauzl');
const { getInventoryPool } = require('../db/inventory-client');

let ready;

function ensureProductImagesSchema() {
  if (!ready) {
    ready = getInventoryPool()
      .query(fs.readFileSync(path.join(__dirname, '../db/migrations/0015_product_images.sql'), 'utf8'))
      .catch(error => {
        ready = null;
        throw error;
      });
  }
  return ready;
}

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const NAME_RE = /^(\d{4,12})\s*[(（](\d{1,3})[)）]$/;
const MAX_TOTAL = 30 * 1024 * 1024;   // 留出余量：dev-server 单请求上限 32MB
const MAX_ENTRY = 8 * 1024 * 1024;
const MAX_IMAGES = 400;

/**
 * 解压图片压缩包。
 * @param {Buffer} buffer zip 二进制
 * @returns {Promise<{items:Array, skipped:Array}>}
 *   item: { masterCode, idx, name, mime, bytes, data(base64) }
 *   skipped: { name, reason }
 */
function parseImageZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err) return reject(Object.assign(Error('文件不是有效的 zip 压缩包'), { status: 422 }));
      const items = [];
      const skipped = [];
      let total = 0;
      let done = false;
      const finish = () => {
        items.sort((a, b) => a.masterCode.localeCompare(b.masterCode) || a.idx - b.idx);
        resolve({ items, skipped });
      };
      const fail = message => {
        if (done) return;
        done = true;
        try { zip.close(); } catch { /* 已关 */ }
        reject(Object.assign(Error(message), { status: 422 }));
      };
      zip.on('error', () => fail('压缩包读取失败，可能已损坏'));
      zip.on('entry', entry => {
        if (done) return;
        if (items.length + skipped.length > 2000) return fail('压缩包里文件太多，请按批次拆分');
        if (/\/$/.test(entry.fileName)) return zip.readEntry(); // 目录
        const base = entry.fileName.split('/').pop();           // 兼容压缩包里带一层文件夹
        const ext = path.extname(base).toLowerCase();
        const mime = MIME[ext];
        const stem = base.slice(0, base.length - ext.length);
        const match = !mime ? null : NAME_RE.exec(stem.replace(/\s+/g, ''));
        if (!match) {
          skipped.push({ name: base, reason: mime ? '文件名不是「主数据编码(序号)」格式' : '不是图片（只认 jpg/png/webp/gif）' });
          if (skipped.length > 50) return fail('无法识别的文件太多，请确认选的是格力系统导出的图片压缩包');
          return zip.readEntry();
        }
        if (entry.uncompressedSize > MAX_ENTRY) {
          skipped.push({ name: base, reason: `单图超过 ${MAX_ENTRY / 1024 / 1024}MB` });
          return zip.readEntry();
        }
        total += entry.uncompressedSize;
        if (total > MAX_TOTAL) return fail(`图片总量超过 ${MAX_TOTAL / 1024 / 1024}MB，请分两批导入`);
        if (items.length >= MAX_IMAGES) return fail(`图片超过 ${MAX_IMAGES} 张，请分批导入`);
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || done) return fail('压缩包读取失败');
          const chunks = [];
          stream.on('error', () => fail('压缩包读取失败'));
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            if (done) return;
            items.push({
              masterCode: match[1],
              idx: Number(match[2]),
              name: base,
              mime,
              bytes: entry.uncompressedSize,
              data: Buffer.concat(chunks).toString('base64')
            });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => {
        if (done) return;
        done = true;
        if (!items.length) return reject(Object.assign(Error('压缩包里没有按「主数据编码(序号)」命名的图片'), { status: 422 }));
        finish();
      });
      zip.readEntry();
    });
  });
}

module.exports = { ensureProductImagesSchema, parseImageZip, MIME };
