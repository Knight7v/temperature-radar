// Vercel cron / 本机轮询专用入口（北京 08:30 推昨日日报）。强制走 action=cron，复用日报接口的幂等逻辑。
module.exports = function cronDailyReport(req, res) {
  req.query = req.query || {};
  req.query.action = 'cron';
  return require('./daily-report')(req, res);
};
