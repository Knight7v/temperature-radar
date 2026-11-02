/* 每日经营日报弹窗（P0-A）。数据来自 /api/daily-report：
 *   get  → 生成某天日报（默认昨天）
 *   push → 推送到企业微信群机器人
 * 推送配置在服务端 .env.local 的 WECOM_BOT_WEBHOOK / DAILY_REPORT_WEBHOOK。 */
(function () {
  'use strict';
  const Session = window.WorkbenchSession ? window.WorkbenchSession.createSessionClient() : null;
  if (!Session) return;
  const get = id => document.getElementById(id);
  const modal = get('ghDailyModal'), scrim = get('ghDrScrim');
  if (!modal) return;
  let markdown = '';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const wan = cents => (Number(cents || 0) / 100 / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  const yuan = cents => (Number(cents || 0) / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  const pct = rate => rate == null ? '—' : (Number(rate) * 100).toFixed(1) + '%';

  function yesterday() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function open() {
    if (!get('ghDrDate').value) get('ghDrDate').value = yesterday();
    modal.hidden = false;
    scrim.hidden = false;
    load();
  }
  function close() { modal.hidden = true; scrim.hidden = true; }

  async function load() {
    get('ghDrReport').replaceChildren(Object.assign(document.createElement('p'), { className: 'gh-empty', textContent: '正在生成日报…' }));
    setStatus('');
    try {
      const response = await Session.authorizedFetch('/api/daily-report?action=get&date=' + encodeURIComponent(get('ghDrDate').value));
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '生成失败');
      render(result.data);
    } catch (error) {
      get('ghDrReport').replaceChildren(Object.assign(document.createElement('p'), { className: 'gh-empty', textContent: error.message }));
    }
  }

  function setStatus(text) { get('ghDrStatus').textContent = text || ''; }

  function render(data) {
    markdown = data.markdown || '';
    const r = data.report || {}, sales = r.sales || {}, month = r.month || {};
    const rows = [];
    const push = (label, value) => rows.push('<div class="gh-dr-line"><span>' + label + '</span><b>' + value + '</b></div>');

    push('昨日销售额', '¥' + yuan(sales.totalCents));
    if (sales.prevTotalCents > 0) {
      const diff = (sales.totalCents - sales.prevTotalCents) / sales.prevTotalCents * 100;
      push('前日对比', '¥' + yuan(sales.prevTotalCents) + '（' + (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%）');
    }
    push('本月累计', '¥' + yuan(month.totalCents) + (month.targetCents ? ' / 目标 ¥' + yuan(month.targetCents) + '（' + pct(month.rate) + '）' : '（目标未设置）'));
    if (month.monthDays) push('时间进度', month.elapsedDays + ' / ' + month.monthDays + ' 天');
    if (r.service) push('客服会话', r.service.sessions + ' 通');

    const shopLines = (sales.shops || []).map(s =>
      '<div class="gh-dr-shop"><span>' + esc(s.name) + '</span><b>' + (s.cents ? '¥' + yuan(s.cents) : '—') + '</b></div>').join('');

    const warn = [];
    if ((sales.missing || []).length) warn.push('<p class="gh-dr-warn">⚠️ 缺数据：' + esc(sales.missing.join('、')) + '（未导入）</p>');
    if ((sales.zero || []).length) warn.push('<p class="gh-dr-mute">零销售：' + esc(sales.zero.join('、')) + '</p>');
    if (!sales.shops || !sales.shops.length) warn.push('<p class="gh-dr-mute">该日期没有经营期内的店铺数据。</p>');

    let pushNote = '';
    if (data.pushError) pushNote = '<span class="gh-dr-warn-text">上次推送失败：' + esc(data.pushError) + '</span>';
    else if (data.pushedAt) pushNote = '<span>已于 ' + esc(String(data.pushedAt).slice(0, 16).replace('T', ' ')) + ' 推送过</span>';

    get('ghDrReport').innerHTML =
      '<div class="gh-dr-kpis">' + rows.join('') + '</div>' +
      '<h3>分店明细</h3>' + (shopLines || '<p class="gh-dr-mute">无</p>') +
      warn.join('') +
      '<p class="gh-dr-foot">' + (pushNote || '') + (!data.webhookConfigured ? '<span class="gh-dr-warn-text">未配置企业微信机器人：在 .env.local 填 WECOM_BOT_WEBHOOK 后重启服务才能自动推送；现在可先「复制文本」手工发群。</span>' : '') + '</p>';
  }

  get('ghDrPush').onclick = async () => {
    const button = get('ghDrPush');
    button.disabled = true;
    setStatus('正在推送…');
    try {
      const response = await Session.authorizedFetch('/api/daily-report?action=push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: get('ghDrDate').value })
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || '推送失败');
      setStatus('✅ 已推送到企业微信');
      load();
    } catch (error) {
      setStatus('推送失败：' + error.message);
    } finally {
      button.disabled = false;
    }
  };

  get('ghDrCopy').onclick = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setStatus('✅ 文本已复制，可直接粘贴到微信群');
    } catch {
      setStatus('复制失败，请手动选中文本');
    }
  };

  get('ghDaily').onclick = open;
  get('ghDrClose').onclick = close;
  scrim.onclick = close;
  get('ghDrDate').onchange = load;
})();
