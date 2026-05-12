// 验证Token和检查权限API
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const token = authHeader.substring(7);

  try {
    // 验证JWT Token
    const decoded = verifyJWT(token);

    // 检查会话是否有效
    const session = await getSession(decoded.session_id);
    if (!session || new Date(session.expires_at) < new Date()) {
      return res.status(401).json({ error: '会话已过期，请重新登录' });
    }

    // 获取用户信息
    const user = await getUser(decoded.user_id);
    if (!user || user.status !== 'active') {
      return res.status(401).json({ error: '用户不存在或已被禁用' });
    }

    // 更新会话最后活动时间
    await updateSessionActivity(decoded.session_id);

    return res.status(200).json({
      success: true,
      data: {
        user: {
          user_id: user.user_id,
          phone: user.phone,
          nickname: user.nickname,
          avatar: user.avatar
        }
      }
    });

  } catch (error) {
    console.error('Token验证错误:', error);
    return res.status(401).json({ error: '无效的Token' });
  }
}
