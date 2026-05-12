// 手机号验证码登录API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { phone, code } = req.body;

  // 验证手机号和验证码
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ error: '无效的手机号' });
  }

  if (!code || code.length !== 6) {
    return res.status(400).json({ error: '无效的验证码' });
  }

  // 查找验证码
  const codes = await getVerificationCodes();
  const validCode = codes.find(c =>
    c.phone === phone &&
    c.code === code &&
    !c.used &&
    new Date(c.expires_at) > new Date()
  );

  if (!validCode) {
    // 更新尝试次数
    const codeIndex = codes.findIndex(c => c.phone === phone && c.code === code);
    if (codeIndex !== -1) {
      codes[codeIndex].attempts = (codes[codeIndex].attempts || 0) + 1;
      await saveVerificationCodes(codes);
    }
    return res.status(401).json({ error: '验证码错误或已过期' });
  }

  // 标记验证码已使用
  validCode.used = true;
  await saveVerificationCodes(codes);

  // 查找或创建用户
  let user = await getUserByPhone(phone);
  if (!user) {
    // 创建新用户
    user = await createUser({
      phone,
      user_type: 'phone',
      status: 'active',
      nickname: `用户${phone.slice(-4)}`,
      last_login: new Date().toISOString()
    });
  } else {
    // 更新最后登录时间
    await updateUser(user.user_id, {
      last_login: new Date().toISOString()
    });
  }

  // 创建会话
  const session = await createSession(user.user_id);

  // 生成JWT Token
  const token = generateJWT({
    user_id: user.user_id,
    session_id: session.session_id
  });

  return res.status(200).json({
    success: true,
    message: '登录成功',
    data: {
      user: {
        user_id: user.user_id,
        phone: user.phone,
        nickname: user.nickname,
        avatar: user.avatar
      },
      token
    }
  });
}
