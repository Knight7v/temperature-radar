// 登出API
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }

  const token = authHeader.substring(7);

  try {
    const decoded = verifyJWT(token);

    // 删除会话
    await deleteSession(decoded.session_id);

    return res.status(200).json({
      success: true,
      message: '登出成功'
    });

  } catch (error) {
    console.error('登出错误:', error);
    return res.status(500).json({ error: '登出失败' });
  }
}
