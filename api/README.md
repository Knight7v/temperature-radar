# API 文档

## 认证相关 API

### 1. 发送验证码
**POST** `/api/auth/send-code`

请求体：
```json
{
  "phone": "13800138000"
}
```

响应：
```json
{
  "success": true,
  "message": "验证码已发送"
}
```

---

### 2. 手机号登录
**POST** `/api/auth/login`

请求体：
```json
{
  "phone": "13800138000",
  "code": "123456"
}
```

响应：
```json
{
  "success": true,
  "message": "登录成功",
  "data": {
    "user": {
      "user_id": "user_xxx",
      "phone": "13800138000",
      "nickname": "用户8000",
      "avatar": "https://avatar.url"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 3. 微信登录
**POST** `/api/auth/wechat`

请求体：
```json
{
  "code": "wx_auth_code"
}
```

响应：
```json
{
  "success": true,
  "message": "登录成功",
  "data": {
    "user": {
      "user_id": "user_xxx",
      "nickname": "微信用户",
      "avatar": "https://avatar.url"
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

---

### 4. 验证Token
**GET** `/api/auth/verify`

请求头：
```
Authorization: Bearer {token}
```

响应：
```json
{
  "success": true,
  "data": {
    "user": {
      "user_id": "user_xxx",
      "phone": "13800138000",
      "nickname": "用户8000",
      "avatar": "https://avatar.url"
    }
  }
}
```

---

### 5. 登出
**POST** `/api/auth/logout`

请求头：
```
Authorization: Bearer {token}
```

响应：
```json
{
  "success": true,
  "message": "登出成功"
}
```

---

## 权限检查 API

### 检查功能权限
**GET** `/api/permissions/check`

请求头：
```
Authorization: Bearer {token}
```

查询参数：
```
?feature=hot_analysis
```

响应：
```json
{
  "success": true,
  "data": {
    "has_access": true,
    "access_type": "subscription",
    "expires_at": "2026-06-12T00:00:00Z"
  }
}
```

---

## 支付相关 API

### 创建订单
**POST** `/api/payment/create`

请求头：
```
Authorization: Bearer {token}
```

请求体：
```json
{
  "product_id": "forecast_7d",
  "payment_method": "wechat"
}
```

响应：
```json
{
  "success": true,
  "data": {
    "order_id": "order_xxx",
    "amount": 19.90,
    "payment_url": "https://pay.example.com/...",
    "qr_code": "https://pay.example.com/qr/..."
  }
}
```

---

### 支付回调
**POST** `/api/payment/callback`

请求体（来自支付平台）：
```json
{
  "order_id": "order_xxx",
  "transaction_id": "wx_xxx",
  "status": "paid"
}
```

响应：
```json
{
  "success": true,
  "message": "支付成功"
}
```

---

## 广告相关 API

### 获取广告位
**GET** `/api/ads`

查询参数：
```
?position=top_banner
```

响应：
```json
{
  "success": true,
  "data": {
    "ad_id": "ad_xxx",
    "title": "夏季空调大促",
    "image_url": "https://cdn.example.com/ad.jpg",
    "link_url": "https://example.com/promo"
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 400 | 请求参数错误 |
| 401 | 未授权或Token过期 |
| 403 | 无权限访问该功能 |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

---

## 开发环境配置

创建 `.env.local` 文件：
```
NODE_ENV=development
JWT_SECRET=your-secret-key
WECHAT_APP_ID=your-wechat-appid
WECHAT_APP_SECRET=your-wechat-secret
SMS_ACCESS_KEY=your-sms-key
SMS_SECRET_KEY=your-sms-secret
```

---

**最后更新：** 2026-05-12
