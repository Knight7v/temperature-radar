'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Audit = require('../lib/audit');
const { DICTIONARY, sqlList } = require('../lib/dictionary');

function fakeDb(handlers = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, args) => {
      calls.push({ sql, args });
      for (const [needle, rows] of Object.entries(handlers)) {
        if (sql.includes(needle)) return { rows: typeof rows === 'function' ? rows(args) : rows, rowCount: Array.isArray(rows) ? rows.length : 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

test('logAudit：写入一条日志，操作人姓名来自 users 表', async () => {
  const db = fakeDb({ 'FROM users WHERE id': [{ display_name: '客服主管', identifier: 'kfzg' }] });
  await Audit.logAudit(db, {
    tenantId: 'T1', user: { userId: 'U1', role: 'operator' },
    action: 'quality.review', targetType: 'session', targetId: 'S1', targetLabel: 'S1',
    detail: { aiScore: 85, finalScore: 92, overrides: 1 }
  });
  assert.equal(db.calls.length, 2);
  const insert = db.calls[1];
  assert.ok(insert.sql.includes('INSERT INTO audit_logs'));
  assert.equal(insert.args[2], '客服主管');
  assert.equal(insert.args[4], 'quality.review');
  assert.deepEqual(JSON.parse(insert.args[8]), { aiScore: 85, finalScore: 92, overrides: 1 });
});

test('logAudit：未知动作必须先在字典登记，否则拒写（吞错不上抛）', async () => {
  const db = fakeDb();
  let threw = false;
  try {
    await Audit.logAudit(db, { tenantId: 'T1', action: 'not.in.dict' });
  } catch { threw = true; }
  assert.equal(threw, false);
  assert.equal(db.calls.length, 0); // 没碰库
});

test('logAudit：db 挂了也只吞错', async () => {
  let threw = false;
  try {
    await Audit.logAudit({ query: async () => { throw Error('db down'); } }, { tenantId: 'T1', action: 'shop.update' });
  } catch { threw = true; }
  assert.equal(threw, false);
});

test('listAuditLogs：按动作 + 关键字 + 日期拼过滤条件，limit 有上限', async () => {
  const db = fakeDb();
  await Audit.listAuditLogs(db, 'T1', { action: 'shop.update', q: '格力', from: '2026-10-01', to: '2026-10-30', limit: 9999 });
  const sql = db.calls[0].sql, args = db.calls[0].args;
  assert.ok(sql.includes('action=$2'), '动作过滤');
  assert.ok(sql.includes('ILIKE'), '关键字模糊查');
  assert.ok(sql.includes('timestamptz'), '日期过滤');
  assert.equal(args[0], 'T1');
  assert.equal(args[1], 'shop.update');
  assert.equal(args[2], '%格力%');
  assert.equal(args[5], 200, 'limit 上限 200');
});

test('listAuditLogs：无条件时最简查询', async () => {
  const db = fakeDb();
  await Audit.listAuditLogs(db, 'T1', {});
  const { sql, args } = db.calls[0];
  assert.equal(args.length, 2, 'tenant + limit');
  assert.ok(sql.includes('ORDER BY created_at DESC'));
});

test('describeDetail：各类动作翻成大白话', () => {
  assert.ok(Audit.describeDetail('sales.import', { added: 12, changed: 3, start: '2026-10-01', end: '2026-10-29' }).includes('新增 12 行'));
  assert.ok(Audit.describeDetail('target.year', { annual: 2130000000, months: 8 }).includes('¥21,300,000'));
  assert.ok(Audit.describeDetail('quality.review', { aiScore: 85, finalScore: 92, overrides: 2, note: '改判' }).includes('改判 2 项'));
  assert.ok(Audit.describeDetail('user.update', { status: 'disabled' }).includes('停用'));
});

test('数据字典：质检 SQL 依赖的枚举值与京麦实际取值一致', () => {
  assert.equal(DICTIONARY.quality.resolved.yes, '已解决');
  assert.equal(DICTIONARY.quality.resolved.no, '未解决');
  assert.deepEqual(DICTIONARY.quality.resolved.ignored, ['-']);
  assert.deepEqual(DICTIONARY.quality.satisfaction.good, ['非常满意', '满意']);
  assert.deepEqual(DICTIONARY.quality.satisfaction.mid, ['一般']);
  assert.deepEqual(DICTIONARY.quality.satisfaction.bad, ['不满意']);
});

test('数据字典：角色 key 与 users 表合法值一致；店铺状态/平台齐全', () => {
  assert.deepEqual(Object.keys(DICTIONARY.userRoles).sort(), ['admin', 'operator', 'supply_chain', 'viewer'].sort());
  assert.deepEqual(DICTIONARY.shopStatus, ['运营中', '闭店中', '已闭店']);
  assert.deepEqual(DICTIONARY.shopPlatforms, ['京东', '天猫', '拼多多', '苏宁']);
});

test('数据字典：所有写接口用到的动作都已登记', () => {
  const used = ['auth.login', 'shop.create', 'shop.update', 'shop.delete', 'target.update', 'target.year',
    'sales.import', 'quality.review', 'user.create', 'user.update', 'user.delete',
    'agent.create', 'agent.update', 'agent.delete', 'agent.import'];
  for (const a of used) assert.ok(DICTIONARY.auditActions[a], '缺动作：' + a);
  assert.equal(Object.keys(DICTIONARY.auditActions).length, used.length);
});

test('sqlList：拼 SQL 安全转义', () => {
  assert.equal(sqlList(['已解决', '-']), "'已解决','-'");
  assert.equal(sqlList(["it's"]), "'it''s'");
});
