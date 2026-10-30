'use strict';

// 极简 ZIP 打包（只存储、不压缩）。
//
// 为什么自己写而不是装依赖：项目里已经有 yauzl 但那是"解压"用的，
// 而 PNG/JPG 本身已经是压缩格式，再套一层 deflate 只会白烧 CPU、体积几乎不变。
// 所以这里只实现 store 模式的写入，约 100 行，无依赖、可单测（用 yauzl 回读验证）。

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

// DOS 时间戳：1980 起算，秒只能存 2 秒精度。ZIP 规范限制，不是笔误。
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

// 文件名统一按 UTF-8 写入，并打上通用标志位 bit 11，
// 否则 Windows 资源管理器会把中文名显示成乱码。
const FLAG_UTF8 = 0x0800;

function zipStore(entries) {
  const files = (entries || []).filter(item => item && item.data && item.data.length >= 0);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of files) {
    const name = Buffer.from(String(entry.name || 'file'), 'utf8');
    const data = entry.data;
    const { time, date } = dosDateTime(entry.date || new Date());
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 需要的解压版本
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // 0 = store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, data);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(FLAG_UTF8, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(time, 12);
    head.writeUInt16LE(date, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt16LE(0, 30); // extra
    head.writeUInt16LE(0, 32); // comment
    head.writeUInt16LE(0, 34); // disk
    head.writeUInt16LE(0, 36); // internal attr
    head.writeUInt32LE(0, 38); // external attr
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

module.exports = { zipStore, crc32, dosDateTime };
