const test = require('node:test');
const assert = require('node:assert');
const { parseImageZip } = require('../lib/product/images');
const { zipStore } = require('../lib/design/zip');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('解析图片包：按「主数据编码(序号)」命名、跨文件夹、按编码+序号排序', async () => {
  const buffer = zipStore([
    { name: '5538984(02).jpg', data: JPEG },
    { name: '5538984(01).jpg', data: JPEG },
    { name: '文件夹一层/5538984(10).jpg', data: JPEG },
    { name: '1771209(1).png', data: PNG }
  ]);
  const { items, skipped } = await parseImageZip(buffer);
  assert.equal(items.length, 4);
  assert.equal(skipped.length, 0);
  assert.deepEqual(items.map(i => `${i.masterCode}-${i.idx}`), ['1771209-1', '5538984-1', '5538984-2', '5538984-10']);
  assert.equal(items[0].mime, 'image/png');
  assert.equal(items[1].mime, 'image/jpeg');
  assert.equal(items[1].data, JPEG.toString('base64'));
});

test('非图片与命名不符的文件进 skipped，不挡导入', async () => {
  const buffer = zipStore([
    { name: '5538984(01).jpg', data: JPEG },
    { name: '说明.txt', data: Buffer.from('hello') },
    { name: '随手截图.png', data: PNG }
  ]);
  const { items, skipped } = await parseImageZip(buffer);
  assert.equal(items.length, 1);
  assert.equal(skipped.length, 2);
  assert.match(skipped[1].reason, /主数据编码/);
});

test('全空包 / 非 zip 输入直接报错', async () => {
  const empty = zipStore([{ name: 'readme.txt', data: Buffer.from('x') }]);
  await assert.rejects(() => parseImageZip(empty), /没有按/);
  await assert.rejects(() => parseImageZip(Buffer.from('not a zip')), /zip/);
});
