# 用户认证系统数据库设计

## 数据库选择

**MVP阶段：** JSON文件存储
**成长期：** Vercel Postgres / Supabase

---

## 数据表设计

### 1. users（用户表）

```json
{
  "user_id": "user_xxxxxxxxxxxxx",
  "phone": "13800138000",
  "wechat_openid": "wx_xxxxxxxxxxxxx",
  "nickname": "空调经销商小王",
  "avatar": "https://avatar.url",
  "user_type": "phone",  // phone | wechat | both
  "status": "active",    // active | suspended | deleted
  "created_at": "2026-05-12T10:00:00Z",
  "updated_at": "2026-05-12T10:00:00Z",
  "last_login": "2026-05-12T10:00:00Z"
}
```

**字段说明：**
- `user_id`: 唯一标识符
- `phone`: 手机号（可选，微信登录时可为空）
- `wechat_openid`: 微信OpenID（可选，手机登录时可为空）
- `user_type`: 注册方式
- `status`: 用户状态

---

### 2. subscriptions（订阅表）

```json
{
  "subscription_id": "sub_xxxxxxxxxxxxx",
  "user_id": "user_xxxxxxxxxxxxx",
  "plan_type": "forecast_7d",  // forecast_7d | professional | enterprise
  "status": "active",          // active | expired | cancelled | pending
  "start_date": "2026-05-12T00:00:00Z",
  "end_date": "2026-06-12T00:00:00Z",
  "auto_renew": true,
  "created_at": "2026-05-12T10:00:00Z",
  "updated_at": "2026-05-12T10:00:00Z"
}
```

**字段说明：**
- `plan_type`: 订阅计划类型
  - `forecast_7d`: 7天预测功能（19.9元/月）
  - `professional`: 专业版（49元/月）
  - `enterprise`: 企业版（199元/月）
- `status`: 订阅状态
- `auto_renew`: 是否自动续费

---

### 3. orders（订单表）

```json
{
  "order_id": "order_xxxxxxxxxxxxx",
  "user_id": "user_xxxxxxxxxxxxx",
  "order_type": "subscription",     // subscription | onetime
  "product_id": "forecast_7d",      // 产品ID
  "product_name": "7天预测月度订阅",
  "amount": 19.90,
  "currency": "CNY",
  "payment_method": "wechat",       // wechat | alipay
  "payment_status": "paid",         // pending | paid | failed | refunded
  "transaction_id": "wx_xxxxxxxxxxxxx",
  "created_at": "2026-05-12T10:00:00Z",
  "paid_at": "2026-05-12T10:05:00Z"
}
```

**字段说明：**
- `order_type`: 订单类型
  - `subscription`: 订阅制
  - `onetime`: 单次购买（29.9元）
- `payment_status`: 支付状态

---

### 4. permissions（权限表）

```json
{
  "permission_id": "perm_xxxxxxxxxxxxx",
  "user_id": "user_xxxxxxxxxxxxx",
  "feature": "hot_analysis",        // 功能标识
  "access_type": "onetime",         // onetime | subscription
  "order_id": "order_xxxxxxxxxxxxx", // 关联订单
  "start_time": "2026-05-12T10:00:00Z",
  "end_time": "2026-05-13T10:00:00Z",  // 单次购买24小时有效
  "is_active": true,
  "created_at": "2026-05-12T10:00:00Z"
}
```

**功能标识（feature）：**
- `hot_analysis`: 热销分析功能
- `forecast_7d`: 7天预测功能
- `data_export`: 数据导出功能
- `api_access`: API访问权限

---

### 5. sessions（会话表）

```json
{
  "session_id": "sess_xxxxxxxxxxxxx",
  "user_id": "user_xxxxxxxxxxxxx",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "ip_address": "123.45.67.89",
  "user_agent": "Mozilla/5.0...",
  "created_at": "2026-05-12T10:00:00Z",
  "expires_at": "2026-05-13T10:00:00Z",
  "last_activity": "2026-05-12T15:00:00Z"
}
```

---

### 6. verification_codes（验证码表）

```json
{
  "code_id": "code_xxxxxxxxxxxxx",
  "phone": "13800138000",
  "code": "123456",
  "purpose": "login",              // login | register | reset
  "created_at": "2026-05-12T10:00:00Z",
  "expires_at": "2026-05-12T10:05:00Z",  // 5分钟有效
  "used": false,
  "attempts": 0
}
```

---

### 7. ads（广告表）

```json
{
  "ad_id": "ad_xxxxxxxxxxxxx",
  "title": "夏季空调大促",
  "image_url": "https://cdn.example.com/ad.jpg",
  "link_url": "https://example.com/promo",
  "position": "top_banner",        // top_banner | right_card
  "status": "active",              // active | paused | deleted
  "start_date": "2026-05-12T00:00:00Z",
  "end_date": "2026-06-12T00:00:00Z",
  "priority": 1,
  "click_count": 0,
  "view_count": 0,
  "created_at": "2026-05-12T10:00:00Z"
}
```

---

## 关系图

```
users (1) ----< (N) subscriptions
  |
  |----< (N) orders
  |         |
  |         |----< (1) permissions
  |
  |----< (N) sessions
  |
  |----< (N) verification_codes

ads (独立表)
```

---

## 权限检查逻辑

```javascript
// 检查用户是否有访问某个功能的权限
async function checkPermission(userId, feature) {
  // 1. 检查功能是否需要付费
  if (isFreeFeature(feature)) {
    return true;
  }

  // 2. 检查用户是否有有效的订阅
  const subscription = await getActiveSubscription(userId);
  if (subscription && hasFeatureAccess(subscription, feature)) {
    return true;
  }

  // 3. 检查用户是否有单次购买权限
  const permission = await getOneTimePermission(userId, feature);
  if (permission && permission.is_active && !isExpired(permission)) {
    return true;
  }

  return false;
}
```

---

## MVP阶段实现

### 文件结构
```
/data
  ├── users.json
  ├── subscriptions.json
  ├── orders.json
  ├── permissions.json
  ├── sessions.json
  ├── verification_codes.json
  └── ads.json
```

### 基础CRUD操作
```javascript
// 读取用户
function getUser(userId) {
  const users = readJSON('data/users.json');
  return users.find(u => u.user_id === userId);
}

// 创建用户
function createUser(userData) {
  const users = readJSON('data/users.json');
  const newUser = {
    user_id: generateId(),
    ...userData,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  users.push(newUser);
  writeJSON('data/users.json', users);
  return newUser;
}

// 更新用户
function updateUser(userId, updates) {
  const users = readJSON('data/users.json');
  const index = users.findIndex(u => u.user_id === userId);
  if (index !== -1) {
    users[index] = {
      ...users[index],
      ...updates,
      updated_at: new Date().toISOString()
    };
    writeJSON('data/users.json', users);
    return users[index];
  }
  return null;
}
```

---

## 安全考虑

1. **密码加密：** 使用bcrypt加密密码
2. **Token安全：** 使用JWT，设置合理过期时间
3. **验证码限流：** 同一手机号1分钟内只能发送1次
4. **SQL注入防护：** 使用参数化查询
5. **XSS防护：** 对用户输入进行转义
6. **HTTPS：** 强制使用HTTPS连接

---

**文档版本：** v1.0
**最后更新：** 2026-05-12
