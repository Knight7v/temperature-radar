'use strict';
/* 数据字典（P2，借鉴 JeecgBoot）：全站枚举的唯一真相。
 * ⚠️ 改这里 = 改口径，必须先确认 SQL/页面没有依赖旧值：
 *   · quality.resolved / quality.satisfaction 直接拼进质检统计 SQL；
 *   · userRoles 的 key 是 users 表 role 字段的合法值；
 *   · shopStatus 是店铺档案「状态」字段的合法值。
 * 前端同款在 js/dictionary.js（同一份内容，改要改两处）。
 */
const DICTIONARY = {
  userRoles: { admin: '管理员', operator: '运营', supply_chain: '供应链', viewer: '查看用户' },
  shopStatus: ['运营中', '闭店中', '已闭店'],
  shopPlatforms: ['京东', '天猫', '拼多多', '苏宁'],
  quality: {
    /* 京麦「是否解决」结论；'-' 是平台未给出结论，统计时跳过 */
    resolved: { yes: '已解决', no: '未解决', ignored: ['-'] },
    /* 京麦满意度评价；good 计入「满意率」分子 */
    satisfaction: { good: ['非常满意', '满意'], mid: ['一般'], bad: ['不满意'] }
  },
  /* 操作日志的动作 → 大白话（audit_logs.action 的合法值与展示名） */
  auditActions: {
    'auth.login': '登录成功',
    'shop.create': '新增店铺档案',
    'shop.update': '修改店铺档案',
    'shop.delete': '删除店铺',
    'target.update': '修改销售目标',
    'target.year': '设置年度/月度目标',
    'sales.import': '导入销售数据',
    'quality.review': '质检复核',
    'user.create': '创建账号',
    'user.update': '修改账号',
    'user.delete': '删除账号',
    'agent.create': '新建客服档案',
    'agent.update': '修改客服档案',
    'agent.delete': '删除客服档案',
    'agent.import': '从质检带入建档'
  }
};

/* 拼 SQL 用：把枚举值转成 SQL 字符串字面量（当前值都不含引号，这里兜底防一手） */
function sqlList(values) {
  return values.map(v => "'" + String(v).replace(/'/g, "''") + "'").join(',');
}

module.exports = { DICTIONARY, sqlList };
