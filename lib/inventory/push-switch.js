// 库存机器人（补货分析）企业微信推送总开关。
// 2026-10-19 用户要求暂时关闭：补货功能仍在完善，避免向企业微信群发出不成熟的消息。
//
// 默认关闭。需要重新开启时，在 .env.local / 部署环境变量里设置：
//   INVENTORY_PUSH_ENABLED=on
// 关闭状态下的行为：
//   - 补货计划照常保存（业务数据不丢），但不发企业微信消息
//   - 定时任务不再生成每日预警，也不会补发历史积压
//   - 已产生的推送记录标记为 skipped，不会在恢复后集中轰炸

function isInventoryPushEnabled() {
    const raw = String(process.env.INVENTORY_PUSH_ENABLED ?? '').trim().toLowerCase();
    if (raw === 'on' || raw === 'true' || raw === '1' || raw === 'yes') return true;
    if (raw === 'off' || raw === 'false' || raw === '0' || raw === 'no') return false;
    return false;
}

module.exports = { isInventoryPushEnabled };
