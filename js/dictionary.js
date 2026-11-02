/* 数据字典（前端同款）——与 lib/dictionary.js 是同一份内容，改要改两处。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WorkbenchDictionary = api;
})(globalThis, function () {
  return {
    userRoles: { admin: '管理员', operator: '运营', supply_chain: '供应链', viewer: '查看用户' },
    shopStatus: ['运营中', '闭店中', '已闭店'],
    shopPlatforms: ['京东', '天猫', '拼多多', '苏宁'],
    quality: {
      resolved: { yes: '已解决', no: '未解决', ignored: ['-'] },
      satisfaction: { good: ['非常满意', '满意'], mid: ['一般'], bad: ['不满意'] }
    },
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
});
