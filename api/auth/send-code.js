// 发送验证码API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone } = req.body;

  // 验证手机号格式
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: '无效的手机号' });
  }

  // 限流检查：同一手机号1分钟内只能发送1次
  const codes = await getVerificationCodes();
  const recentCode = codes.find(c =>
    c.phone === phone &&
    !c.used &&
    new Date(c.expires_at) > new Date()
  );

  if (recentCode) {
    return res.status(429).json({ error: '验证码已发送，请稍后再试' });
  }

  // 生成6位验证码
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // 保存验证码（5分钟有效）
  const newCode = {
    code_id: generateId(),
    phone,
    code,
    purpose: 'login',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    used: false,
    attempts: 0
  };

  codes.push(newCode);
  await saveVerificationCodes(codes);

  // TODO: 实际发送短信（使用阿里云短信服务或其他）
  // await sendSMS(phone, `您的验证码是：${code}，5分钟内有效。`);

  // 开发环境返回验证码（生产环境删除此行）
  if (process.env.NODE_ENV === 'development') {
    return res.status(200).json({
      success: true,
      message: '验证码已发送',
      code // 仅开发环境返回
    });
  }

  return res.status(200).json({
    success: true,
    message: '验证码已发送'
  });
}
