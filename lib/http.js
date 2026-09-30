// 极小的 HTTP 工具:方法守卫 + 统一错误处理(AuthError 用其 status,其余 500)。
function requireMethod(req, res, method) {
    if (req.method !== method) {
        res.status(405).json({ error: 'Method not allowed' });
        return false;
    }
    return true;
}

function apiHandler(fn) {
    return async function handler(req, res) {
        try {
            await fn(req, res);
        } catch (e) {
            const status = (e && e.status) || 500;
            if (status >= 500) console.error('API error:', e);
            res.status(status).json({ error: (e && e.message) || '服务器错误' });
        }
    };
}

module.exports = { requireMethod, apiHandler };
