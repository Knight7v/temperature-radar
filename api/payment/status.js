// 查询支付状态API
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { order_id } = req.query;

  if (!order_id) {
    return res.status(400).json({ error: '缺少订单ID' });
  }

  try {
    const orders = await getOrders();
    const order = orders.find(o => o.order_id === order_id);

    if (!order) {
      return res.status(404).json({ error: '订单不存在' });
    }

    return res.status(200).json({
      success: true,
      data: {
        order_id: order.order_id,
        status: order.payment_status,
        amount: order.amount,
        created_at: order.created_at,
        paid_at: order.paid_at
      }
    });

  } catch (error) {
    console.error('查询订单失败:', error);
    return res.status(500).json({ error: '查询订单失败' });
  }
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
