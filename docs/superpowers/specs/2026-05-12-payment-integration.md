# 支付平台集成指南

## 推荐支付平台对比

### 1. Payjs（推荐用于微信支付）

**优势：**
- 接入简单，文档清晰
- 费率：2.38%
- 支持微信支付
- 提供支付回调通知
- 适合个人和小微企业

**申请流程：**
1. 注册账号：https://payjs.cn
2. 实名认证
3. 获取商户ID和密钥
4. 配置回调URL

### 2. 虎皮椒（推荐用于双通道）

**优势：**
- 支持微信+支付宝双通道
- 费率：2.5-3%
- 接入简单
- 自动分账功能
- 适合有一定业务量的商家

**申请流程：**
1. 注册账号：https://www.xunhupay.com
2. 提交资料审核
3. 获取商户ID和密钥
4. 配置回调URL

### 3. 官方直接对接（长期考虑）

**微信支付官方API：**
- 费率：0.6%
- 需要企业资质
- 申请周期长
- 功能完整

**支付宝官方API：**
- 费率：0.6%
- 需要企业资质
- 申请周期长
- 功能完整

---

## MVP阶段推荐：Payjs

### 注册步骤

1. **注册Payjs账号**
   - 访问：https://payjs.cn
   - 点击"注册"
   - 使用手机号注册

2. **实名认证**
   - 上传身份证
   - 绑定银行卡
   - 等待审核（1-2个工作日）

3. **获取API密钥**
   - 登录Payjs控制台
   - 进入"商户信息"
   - 记录商户ID（mchid）
   - 设置并记录API密钥

4. **配置回调地址**
   - 进入"开发配置"
   - 添加异步通知URL：`https://kongtiaoredian.cn/api/payment/callback`

---

## 技术集成

### 环境变量配置

在 `.env.local` 文件中添加：

```env
PAYJS_MCHID=your_mchid
PAYJS_KEY=your_key
PAYJS_NOTIFY_URL=https://kongtiaoredian.cn/api/payment/callback
```

### API接口实现

创建 `/api/payment/create.js`：

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { product_id, payment_method = 'wechat' } = req.body;
  const token = req.headers.authorization?.replace('Bearer ', '');

  // 验证用户身份
  const user = await verifyUser(token);
  if (!user) {
    return res.status(401).json({ error: '未授权' });
  }

  // 创建订单
  const order = await createOrder(user.user_id, product_id);

  // 调用Payjs API
  const payjsResult = await createPayjsOrder({
    out_trade_no: order.order_id,
    total_fee: order.amount,
    body: order.product_name,
    notify_url: process.env.PAYJS_NOTIFY_URL
  });

  if (payjsResult.return_code === 1) {
    return res.status(200).json({
      success: true,
      data: {
        order_id: order.order_id,
        amount: order.amount,
        qr_code: payjsResult.qrcode,
        code_url: payjsResult.code_url
      }
    });
  } else {
    return res.status(500).json({ error: '创建支付失败' });
  }
}
```

创建 `/api/payment/callback.js`：

```javascript
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { out_trade_no, transaction_id, total_fee, attach } = req.body;

  // 验证签名
  const sign = generatePayjsSign(req.body);
  if (sign !== req.body.sign) {
    return res.status(400).send('FAIL');
  }

  // 更新订单状态
  await updateOrderStatus(out_trade_no, {
    transaction_id,
    payment_status: 'paid',
    paid_at: new Date().toISOString()
  });

  // 授予用户权限
  await grantUserPermissions(out_trade_no);

  return res.status(200).send('SUCCESS');
}
```

---

## 产品定价配置

创建 `/data/products.json`：

```json
{
  "products": [
    {
      "product_id": "hot_analysis",
      "product_name": "热销分析",
      "description": "查看热销分析功能（24小时有效）",
      "price": 29.90,
      "order_type": "onetime",
      "duration": 86400,
      "features": ["hot_analysis"]
    },
    {
      "product_id": "forecast_7d",
      "product_name": "7天预测",
      "description": "查看7天预测功能（月度订阅）",
      "price": 19.90,
      "order_type": "subscription",
      "duration": 2592000,
      "features": ["forecast_7d", "data_export"]
    }
  ]
}
```

---

## 测试流程

### 1. 创建测试订单
```bash
curl -X POST https://kongtiaoredian.cn/api/payment/create \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"product_id": "hot_analysis"}'
```

### 2. 获取支付二维码
返回的 `qr_code` 字段包含支付二维码地址

### 3. 模拟支付
使用微信扫描测试二维码完成支付

### 4. 验证回调
检查订单状态是否正确更新

---

## 注意事项

1. **安全性**
   - API密钥不要泄露
   - 回调签名验证必须严格
   - 使用HTTPS协议

2. **订单处理**
   - 订单号必须唯一
   - 记录所有交易日志
   - 处理重复回调

3. **用户体验**
   - 提供清晰的支付指引
   - 支付成功后及时反馈
   - 支付失败时给出明确原因

4. **对账机制**
   - 定期与支付平台对账
   - 处理异常订单
   - 退款流程要完善

---

**文档版本：** v1.0
**最后更新：** 2026-05-12
**状态：** 待实施
