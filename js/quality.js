(async () => {
  const s = WorkbenchSession.createSessionClient();
  const q = (id) => document.getElementById(id);
  const status = q('status');
  const SAMPLED_KEY = 'wb_quality_sampled_total'; // 本机累计抽检条数，供首页驾驶舱展示真实数字

  try {
    const i = await s.getIdentity();
    WorkbenchShell.mountShell({
      container: q('shell'),
      activeModule: 'quality',
      identity: i,
      onLogout: async () => { await s.logout(); location = '/login.html'; }
    });
  } catch (e) {
    status.textContent = e.message;
    return;
  }

  q('file').onchange = () => {
    const f = q('file').files[0];
    if (f) status.textContent = `已选择：${f.name}（${(f.size / 1024 / 1024).toFixed(2)} MB），点击「开始抽检」继续。`;
  };

  q('run').onclick = async () => {
    const f = q('file').files[0];
    if (!f) { status.textContent = '请先选择聊天记录文件'; return; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!['csv', 'txt'].includes(ext)) {
      status.textContent = 'XLSX / XLS 二进制格式暂不支持在线统计，请先用 Excel 另存为 CSV 后再导入。';
      return;
    }
    if (f.size > 15 * 1024 * 1024) { status.textContent = '文件过大，单个文件不能超过 15 MB。'; return; }

    status.textContent = '正在读取并脱敏聊天记录…';
    const raw = await f.text();
    const masked = q('mask').checked ? raw.replace(/(1\d{2})\d{4}(\d{4})/g, '$1****$2') : raw;

    // 仅做真实统计，不生成质量分 / 态度评级 / 问题标签
    const phoneCount = (raw.match(/(1\d{2})\d{4}(\d{4})/g) || []).length;
    const marketingCount = (masked.match(/京挑客|团长|返利|优惠券群|加微信/gi) || []).length;
    const totalRows = Math.max(0, raw.split(/\r?\n/).filter((x) => x.trim()).length - 1);
    const filtered = q('filterMarketing').checked ? Math.min(marketingCount, totalRows) : 0;
    const sample = totalRows > 0 ? Math.max(1, Math.round(totalRows * Number(q('rate').value) / 100)) : 0;

    q('total').textContent = totalRows;
    q('sample').textContent = sample;
    q('masked').textContent = q('mask').checked ? phoneCount : 0;
    q('filtered').textContent = filtered;
    q('result').hidden = false;

    // 累计本机抽检条数（供首页驾驶舱读取真实数字）
    if (sample > 0) {
      try {
        const prev = Number(localStorage.getItem(SAMPLED_KEY) || 0);
        localStorage.setItem(SAMPLED_KEY, String(prev + sample));
      } catch (_) {}
    }

    status.textContent = `抽检完成：共识别 ${totalRows} 条记录，本次抽检 ${sample} 条，过滤营销 ${filtered} 条` +
      (q('mask').checked ? `，脱敏手机号 ${phoneCount} 个` : '') +
      '。质量评分与问题识别能力待接入。';
  };
})();
