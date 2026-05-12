// 微信扫码登录API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: '缺少授权码' });
  }

  try {
    // TODO: 使用code换取openid
    // const wechatResult = await getWechatOpenID(code);

    // 开发环境模拟
    const mockOpenID = `wx_${generateId()}`;

    // 查找或创建用户
    let user = await getUserByWechatOpenID(mockOpenID);

    if (!user) {
      // 创建新用户
      user = await createUser({
        wechat_openid: mockOpenID,
        user_type: 'wechat',
        status: 'active',
        nickname: '微信用户',
        avatar: 'https://default-avatar.url',
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
          nickname: user.nickname,
          avatar: user.avatar
        },
        token
      }
    });

  } catch (error) {
    console.error('微信登录错误:', error);
    return res.status(500).json({ error: '登录失败，请重试' });
  }
}
