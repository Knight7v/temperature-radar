// 登出:吊销该用户所有 refresh session(access 短期,自然过期)。
const { apiHandler, requireMethod } = require('../../lib/http');
const { requireUser } = require('../../lib/auth');
const { deleteSessionsForUser } = require('../../lib/db/queries');

module.exports = apiHandler(async (req, res) => {
    if (!requireMethod(req, res, 'POST')) return;
    const u = await requireUser(req);   // 校验 access token,失败 401
    await deleteSessionsForUser(u.userId);
    return res.status(200).json({ success: true });
});
