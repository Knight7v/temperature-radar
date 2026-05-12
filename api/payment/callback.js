// 支付回调API（Payjs等第三方平台调用）
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('FAIL');
  }

  try {
    const {
      out_trade_no,      // 商户订单号
      transaction_id,    // 微信支付订单号
      total_fee,        // 金额（分）
      attach,           // 附加数据
      sign              // 签名
    } = req.body;

    // TODO: 验证签名
    // const calculatedSign = generateSign(req.body);
    // if (calculatedSign !== sign) {
    //   return res.status(400).send('FAIL');
    // }

    // 查找订单
    const orders = await getOrders();
    const orderIndex = orders.findIndex(o => o.order_id === out_trade_no);

    if (orderIndex === -1) {
      return res.status(404).send('FAIL');
    }

    const order = orders[orderIndex];

    // 检查是否已处理
    if (order.payment_status === 'paid') {
      return res.status(200).send('SUCCESS');
    }

    // 更新订单状态
    orders[orderIndex] = {
      ...order,
      payment_status: 'paid',
      transaction_id: transaction_id,
      paid_at: new Date().toISOString()
    };

    await saveOrders(orders);

    // 授予用户权限
    await grantPermission(order);

    return res.status(200).send('SUCCESS');

  } catch (error) {
    console.error('支付回调处理失败:', error);
    return res.status(500).send('FAIL');
  }
}

async function grantPermission(order) {
  const permissions = await getPermissions();

  // 根据订单类型创建权限
  const permission = {
    permission_id: generateId('perm'),
    user_id: order.user_id,
    feature: order.product_id,
    access_type: order.order_type,
    order_id: order.order_id,
    start_time: new Date().toISOString(),
    end_time: getEndTime(order),
    is_active: true,
    created_at: new Date().toISOString()
  };

  permissions.push(permission);
  await savePermissions(permissions);

  // 如果是订阅，创建订阅记录
  if (order.order_type === 'subscription') {
    await createSubscription(order, permission);
  }
}

function getEndTime(order) {
  const now = new Date();

  if (order.order_type === 'subscription') {
    // 月度订阅：30天
    now.setDate(now.getDate() + 30);
  } else {
    // 单次购买：24小时
    now.setHours(now.getHours() + 24);
  }

  return now.toISOString();
}

async function createSubscription(order, permission) {
  const subscriptions = await getSubscriptions();

  const subscription = {
    subscription_id: generateId('sub'),
    user_id: order.user_id,
    plan_type: order.product_id,
    status: 'active',
    start_date: permission.start_time,
    end_date: permission.end_time,
    auto_renew: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  subscriptions.push(subscription);
  await saveSubscriptions(subscriptions);
}

async function getOrders() {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile('data/orders.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveOrders(orders) {
  const fs = require('fs').promises;
  await fs.writeFile('data/orders.json', JSON.stringify(orders, null, 2), 'utf8');
}

async function getPermissions() {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile('data/permissions.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function savePermissions(permissions) {
  const fs = require('fs').promises;
  await fs.writeFile('data/permissions.json', JSON.stringify(permissions, null, 2), 'utf8');
}

async function getSubscriptions() {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile('data/subscriptions.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}

async function saveSubscriptions(subscriptions) {
  const fs = require('fs').promises;
  await fs.writeFile('data/subscriptions.json', JSON.stringify(subscriptions, null, 2), 'utf8');
}

function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${prefix}_${timestamp}_${random}`;
}
