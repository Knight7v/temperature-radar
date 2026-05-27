# 城市详情卡片趋势表格视觉优化设计

**日期：** 2026-05-13
**目标：** 优化城市详情卡片中"未来7天ADI趋势"表格的视觉效果
**方案：** 极简紧凑型

---

## 背景

当前城市详情卡片中的"未来7天ADI趋势"表格存在以下视觉问题：
- 表格宽度与上方详情网格不对齐
- 列宽分配不合理，信息密度不够高
- 样式不够简洁，与整体设计风格不统一

用户希望：
- 保持表格形式，不改变数据展示方式
- 提高信息密度，更紧凑
- 与上方详情网格视觉对齐
- 5列等宽分布

---

## 设计方案

### 整体风格：极简紧凑型

**核心原则：**
1. 信息密度优先 - 减少空白，提高数据展示效率
2. 视觉一致性 - 与上方详情网格保持相同的边框、圆角、间距风格
3. 清晰可读 - 通过边框分隔和适度间距保证可读性

---

## 组件规格

### 1. 表格容器 (.forecast-table)

| 属性 | 值 | 说明 |
|------|-----|------|
| width | 100% | 与详情网格宽度一致 |
| border | 1px solid var(--border-color) | 与详情网格卡片边框一致 |
| border-radius | 8px | 与详情网格卡片圆角一致 |
| background | transparent | 简化背景 |
| overflow | hidden | 确保圆角生效 |
| box-sizing | border-box | 包含边框在宽度计算内 |

### 2. 表头 (.forecast-header)

| 属性 | 值 | 说明 |
|------|-----|------|
| display | grid | 网格布局 |
| grid-template-columns | 1fr 1fr 1fr 1fr 1fr | 5列等宽 |
| gap | var(--spacing-sm) | 列间距 12px |
| padding | 8px | 紧凑内边距 |
| background | var(--bg-secondary) | 次要背景色 |
| font-size | 0.7rem | 小字号 |
| font-weight | 500 | 中等字重 |
| color | var(--text-secondary) | 次要文字色 |
| border-bottom | 1px solid var(--border-color) | 与表行分隔 |

### 3. 表行 (.forecast-row)

| 属性 | 值 | 说明 |
|------|-----|------|
| display | grid | 网格布局 |
| grid-template-columns | 1fr 1fr 1fr 1fr 1fr | 5列等宽 |
| gap | var(--spacing-sm) | 列间距 12px |
| padding | 8px | 紧凑内边距 |
| font-size | 0.75rem | 数据字号 |
| border-top | 1px solid var(--border-color) | 行分隔线 |
| box-sizing | border-box | 包含边框 |

### 4. 热夜行样式 (.forecast-row.hot)

| 属性 | 值 | 说明 |
|------|-----|------|
| background | rgba(255, 0, 0, 0.05) | 淡红色背景突出热夜 |

---

## 视觉对齐

### 宽度对齐

```
.modal-body (padding: 32px)
├── .detail-grid (width: 100%, 3列, gap: 16px)
│   ├── [卡片] [卡片] [卡片]
│   └── 与modal-body左右对齐
│
└── .forecast-section
    └── .forecast-table (width: 100%)
        └── 与detail-grid宽度完全一致
```

### 间距对比

| 组件 | 内边距 | 间距 | 圆角 | 边框 |
|------|--------|------|------|------|
| 详情卡片 | 16px | - | 8px | 无 |
| 表头行 | 8px | 12px(列) | 8px(顶部) | 1px |
| 数据行 | 8px | 12px(列) | - | 1px |

---

## 数据结构

### 表格列定义

| 列序 | 列名 | 数据示例 | 说明 |
|------|------|----------|------|
| 1 | 日期 | "5/14 周二 🌙" | 日期+星期+热夜图标 |
| 2 | 最高温 | "40°" | 白天最高温度 |
| 3 | 夜间 | "29°" | 夜间最低温度 |
| 4 | 体感 | "42°" | 体感温度 |
| 5 | ADI | "90 [爆热]" | ADI分数+等级标签 |

---

## 实施要点

### CSS修改位置

文件：`css/styles-v2.css`

需要修改的选择器：
1. `.forecast-table` - 表格容器
2. `.forecast-header` - 表头行
3. `.forecast-row` - 数据行
4. `.forecast-row.hot` - 热夜行

### 关键修改点

1. 列宽从 `0.8fr 0.45fr 0.45fr 0.45fr 0.6fr` 改为 `1fr 1fr 1fr 1fr 1fr`
2. 内边距从 `var(--spacing-md)` (16px) 改为 `8px`
3. 背景简化，避免过度装饰
4. 确保width: 100%和box-sizing: border-box

---

## 成功标准

1. ✓ 表格宽度与上方详情网格完全对齐
2. ✓ 5列等宽分布，视觉平衡
3. ✓ 内边距8px，信息密度提升50%
4. ✓ 边框样式与详情网格一致
5. ✓ 保持数据可读性，不因紧凑而影响阅读
6. ✓ 热夜行仍然清晰可辨

---

## 后续优化建议

1. 考虑添加表头排序功能（按温度/ADI排序）
2. 考虑添加数据趋势图标（↑↓→表示变化）
3. 考虑极端值的高亮显示（如温度>40℃）
4. 响应式适配：小屏幕下可考虑横向滚动
