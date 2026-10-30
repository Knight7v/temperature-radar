const test = require('node:test');
const assert = require('node:assert/strict');
const yauzl = require('yauzl');
const assets = require('../lib/design/assets');
const { zipStore, crc32 } = require('../lib/design/zip');
const provider = require('../lib/design/provider');

// 把打好的 zip 用 yauzl（项目里本来就有的解压库）读回来，
// 验证的不是"函数没报错"，而是"别的解压软件真的能打开"。
function readZip(buffer) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      const files = [];
      zip.on('entry', entry => {
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) return reject(streamError);
          const chunks = [];
          stream.on('data', chunk => chunks.push(chunk));
          stream.on('end', () => {
            files.push({ name: entry.fileName, data: Buffer.concat(chunks) });
            zip.readEntry();
          });
        });
      });
      zip.on('end', () => resolve(files));
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

test('ZIP 能被标准解压库读出来，中文文件名不乱码', async () => {
  const entries = [
    { name: 'KFR-35GW-首图-abc123.jpg', data: Buffer.from('fake-jpeg-bytes') },
    { name: '第二张.png', data: Buffer.from('another') }
  ];
  const buffer = zipStore(entries);
  const files = await readZip(buffer);
  assert.equal(files.length, 2);
  assert.equal(files[0].name, entries[0].name);
  assert.equal(files[1].name, '第二张.png');
  assert.equal(files[0].data.toString(), 'fake-jpeg-bytes');
});

test('CRC32 与标准值一致（写错了解压软件会报文件损坏）', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test('空列表也能打出合法的空压缩包', async () => {
  const files = await readZip(zipStore([]));
  assert.deepEqual(files, []);
});

test('素材入库的字段清洗：非法用途/状态回落到默认值', () => {
  const data = assets.normalize({ sku: ' kfr-35gw ', purpose: '乱填', status: '乱填', cost: 0.30000001, width: '1200' });
  assert.equal(data.sku, 'KFR-35GW', '型号统一大写，方便按型号搜');
  assert.equal(data.purpose, 'scene');
  assert.equal(data.status, 'draft');
  assert.equal(data.cost, 0.3);
  assert.equal(data.width, 1200);
  assert.equal(data.source, 'local');
});

test('成本不允许被填成负数或天文数字', () => {
  assert.equal(assets.normalize({ cost: -5 }).cost, 0);
  assert.equal(assets.normalize({ cost: 99999 }).cost, 1000);
  assert.equal(assets.normalize({ cost: 'abc' }).cost, 0);
});

test('长文本会被截断，不会把库表撑爆', () => {
  const data = assets.normalize({ title: 'x'.repeat(200), prompt: 'y'.repeat(3000) });
  assert.equal(data.title.length, 60);
  assert.equal(data.prompt.length, 1500);
});

test('dataUrl 解析：正常图能解开，格式不对要报人话', () => {
  const png = Buffer.from('hello');
  const decoded = assets.decodeDataUrl(`data:image/png;base64,${png.toString('base64')}`);
  assert.equal(decoded.mime, 'image/png');
  assert.equal(decoded.buffer.toString(), 'hello');

  assert.throws(() => assets.decodeDataUrl('data:image/gif;base64,AAAA'), /格式不支持|PNG/);
  assert.throws(() => assets.decodeDataUrl('not-a-data-url'), /格式不支持|PNG/);
  assert.throws(() => assets.decodeDataUrl('data:image/png;base64,'), /解析失败|为空/);
});

test('超过体积上限的图会被拦下，并说明上限是多少 MB', () => {
  const big = Buffer.alloc(2 * 1024 * 1024);
  const dataUrl = `data:image/png;base64,${big.toString('base64')}`;
  assert.throws(() => assets.decodeDataUrl(dataUrl, 1024 * 1024), /1 MB/);
  assert.equal(assets.decodeDataUrl(dataUrl, 4 * 1024 * 1024).buffer.length, big.length);
});

test('素材库枚举与上限对前端可见', () => {
  const meta = assets.meta();
  assert.ok(meta.purposes.some(item => item.id === 'background'));
  assert.ok(meta.statuses.some(item => item.id === 'approved'));
  assert.equal(meta.maxBytes, 12 * 1024 * 1024);
  assert.ok(meta.pageSize > 0);
});

test('生成降级链：先试指定模型，再试默认，最后按便宜到贵兜底', () => {
  const old = process.env.DESIGN_IMAGE_MODEL;
  process.env.DESIGN_IMAGE_MODEL = 'Qwen/Qwen-Image';
  try {
    const chain = provider.fallbackChain('Tongyi-MAI/Z-Image-Turbo');
    assert.equal(chain[0], 'Tongyi-MAI/Z-Image-Turbo', '指定的模型必须第一个试');
    assert.equal(chain[1], 'Qwen/Qwen-Image', '第二个是系统默认模型');
    assert.ok(chain.includes('Kwai-Kolors/Kolors'), '免费模型要在兜底链里');
    assert.equal(new Set(chain).size, chain.length, '链里不能有重复模型');
  } finally {
    if (old === undefined) delete process.env.DESIGN_IMAGE_MODEL;
    else process.env.DESIGN_IMAGE_MODEL = old;
  }
});

test('未知模型名不会进降级链（防止把任意字符串转发给上游）', () => {
  const chain = provider.fallbackChain('随便写的模型');
  assert.ok(chain.length >= 2);
  assert.ok(!chain.includes('随便写的模型'));
});

test('按模型算钱：免费模型为 0，付费模型按单价乘张数', () => {
  assert.equal(provider.costOf('Kwai-Kolors/Kolors', 1), 0);
  assert.equal(provider.costOf('Tongyi-MAI/Z-Image-Turbo', 2), 0.2);
  assert.equal(provider.costOf('Qwen/Qwen-Image', 1), 0.3);
  assert.equal(provider.costOf('未知模型', 1), 0);
});
