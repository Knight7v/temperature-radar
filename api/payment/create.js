// 创建支付订单API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { product_id, payment_method = 'wechat' } = req.body;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const token = authHeader.substring(7);

  try {
    // 验证用户身份
    const decoded = verifyJWT(token);
    const user = await getUser(decoded.user_id);

    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: '用户不存在或已被禁用' });
    }

    // 获取产品信息
    const products = await getProducts();
    const product = products.find(p => p.product_id === product_id);

    if (!product) {
      return res.status(404).json({ error: '产品不存在' });
    }

    // 检查是否已有有效订阅
    if (product.order_type === 'subscription') {
      const existing = await getActiveSubscription(user.user_id, product_id);
      if (existing) {
        return res.status(400).json({ error: '您已订阅此功能，无需重复购买' });
      }
    }

    // 创建订单
    const order = await createOrder({
      user_id: user.user_id,
      order_type: product.order_type,
      product_id: product.product_id,
      product_name: product.product_name,
      amount: product.price,
      payment_method
    });

    // TODO: 调用支付平台API创建支付订单
    // 这里使用模拟数据
    const paymentData = {
      order_id: order.order_id,
      amount: order.amount,
      // 开发环境使用模拟支付链接
      payment_url: `${process.env.VERCEL_URL || 'http://localhost:3000'}/payment/demo/${order.order_id}`,
      qr_code: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${order.order_id}`
    };

    return res.status(200).json({
      success: true,
      data: paymentData
    });

  } catch (error) {
    console.error('创建订单失败:', error);
    return res.status(500).json({ error: '创建订单失败，请重试' });
  }
}

// 辅助函数
async function getProducts() {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile('data/products.json', 'utf8');
    const json = JSON.parse(data);
    return json.products || [];
  } catch (error) {
    return [];
  }
}

async function getActiveSubscription(userId, productId) {
  const subscriptions = await getSubscriptions();
  return subscriptions.find(s =>
    s.user_id === userId &&
    s.plan_type === productId &&
    s.status === 'active' &&
    new Date(s.end_date) > new Date()
  );
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

async function createOrder(orderData) {
  const orders = await getOrders();

  const newOrder = {
    order_id: generateId('order'),
    ...orderData,
    order_type: orderData.order_type || 'onetime',
    product_name: orderData.product_name || '未知产品',
    amount: orderData.amount || 0,
    currency: 'CNY',
    payment_method: orderData.payment_method || 'wechat',
    payment_status: 'pending',
    created_at: new Date().toISOString()
  };

  orders.push(newOrder);
  await saveOrders(orders);

  return newOrder;
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

function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `${prefix}_${timestamp}_${random}`;
}

function verifyJWT(token) {
  try {
    const [, body] = token.split('.');
    return JSON.parse(Buffer.from(body, 'base64').toString());
  } catch (error) {
    return null;
  }
}

async function getUser(userId) {
  const users = await getUsers();
  return users.find(u => u.user_id === userId);
}

async function getUsers() {
  const fs = require('fs').promises;
  try {
    const data = await fs.readFile('data/users.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    return [];
  }
}
