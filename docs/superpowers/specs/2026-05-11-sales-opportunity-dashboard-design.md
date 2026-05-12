# 首页"今日销售机会总览"改造设计文档

**日期**: 2026-05-11
**版本**: v1.0
**范围**: 第一期 - 仅首页改造

---

## 一、项目背景

将空调热销区域雷达从"天气数据监控看板"升级为"销售机会决策看板"。第一期重点改造首页，帮助管理层和运营团队快速判断销售机会。

### 1.1 目标用户
- **老板**: 快速了解全国整体销售机会强度
- **总监**: 了解重点大区分布和城市机会
- **运营店长**: 识别值得重点关注的城市

### 1.2 核心目标
用户进入首页后快速判断：
1. 今天整体销售机会强不强
2. 重点机会集中在哪些大区
3. 哪些城市最值得关注
4. 夜间闷热是否明显
5. 判断依据是什么

---

## 二、改造范围

### 2.1 文件范围
- **修改**: `index-v2.html`
- **备份**: `index-v2.html` → `index-v2-before-sales-overview.html`
- **不变**: 
  - 其他页面（机会分析、7天趋势、历史复盘、规则设置）
  - 测试页面（test.html、standalone-test.html等）

### 2.2 保持不变
- 深色科技风主题
- 整体布局结构（侧边栏+头部+内容区）
- 地图核心交互逻辑
- JS模块结构（core.js、map.js、ui.js、app.js）

---

## 三、详细设计

### 3.1 页面标题和副标题

**位置**: 侧边栏logo区域

```
空调热销区域雷达
基于天气数据判断空调区域销售机会
```

**导航第一项**:
```
今日热销 → 销售总览
```

---

### 3.2 顶部状态栏

**新增字段**: 销售机会强度

**显示顺序**:
1. 销售机会强度（低/中/偏强/强）
2. 监控城市
3. 爆发级城市
4. 行动级城市
5. 热夜城市
6. 更新时间

**销售机会强度判断规则**:

基础统计字段:
- `explosiveCount`: 爆发级城市数
- `actionCount`: 行动级城市数
- `activeRegionCount`: 有行动级及以上城市的大区数
- `explosiveRegionCount`: 有爆发级城市的大区数
- `maxExplosiveInOneRegion`: 单个大区最大爆发级城市数
- `maxActiveInOneRegion`: 单个大区最大行动级及以上城市数

判断规则（从高到低匹配）:

| 强度 | 判断条件 |
|------|----------|
| 强 | explosiveCount ≥ 8 且 explosiveRegionCount ≥ 3<br>OR explosiveCount ≥ 10<br>OR maxExplosiveInOneRegion ≥ 7<br>OR 至少2个大区分别有 ≥3 个爆发级城市 |
| 偏强 | explosiveCount 4-7<br>OR actionCount ≥ 9<br>OR activeRegionCount ≥ 2<br>OR maxExplosiveInOneRegion ≥ 5<br>OR maxActiveInOneRegion ≥ 8 |
| 中 | explosiveCount 1-3<br>OR actionCount 3-8<br>OR activeRegionCount == 1 |
| 低 | explosiveCount == 0 且 actionCount ≤ 2 且 activeRegionCount ≤ 1 |

---

### 3.3 左侧面板

#### 3.3.1 今日判断结论（新增）

```
今日销售机会：偏强
重点区域：华南、华东、华中
核心原因：夜间温度持续偏高，部分城市连续闷热夜。
```

#### 3.3.2 大区机会排行（新增）

每个大区展示字段:
- 大区名称
- 机会等级（强/偏强/中高/中/低）
- 爆发级城市数
- 行动级城市数
- 热夜城市数
- 代表城市
- 简短原因

示例:
```
华南 ｜ 强 ｜ 爆发级5 ｜ 行动级4 ｜ 热夜12 ｜ 代表城市：东莞、佛山、深圳
华东 ｜ 偏强 ｜ 爆发级4 ｜ 行动级5 ｜ 热夜10 ｜ 代表城市：福州、杭州、绍兴
华中 ｜ 中高 ｜ 爆发级2 ｜ 行动级3 ｜ 热夜6 ｜ 代表城市：武汉、长沙
```

**大区等级判断**: 基于该大区内城市的等级分布动态计算，类似全国强度规则。

#### 3.3.3 最长连续闷热夜（保留）

```
最长连续闷热夜：5天
代表城市：东莞
未来3晚：28℃ / 29℃ / 28℃
热夜城市：42个
```

---

### 3.4 中间地图

#### 标题修改
```
全国空调需求热力图 → 全国空调销售机会热力图
```

#### 图例说明（新增）
```
红色 = 爆发级
橙色 = 行动级
黄色 = 机会级
蓝色 = 观察级
灰色 = 普通
```

#### 视图说明（新增，根据当前视图动态显示）
- ADI指数: "颜色越红，空调销售机会越高"
- 夜间温度: "颜色越红，夜间闷热程度越高"
- 体感温度: "颜色越红，人体感知温度越高"
- 白天最高温: "颜色越红，白天温度越高"

#### 保持不变
- 默认展示ADI指数
- 切换按钮：ADI指数、夜间温度、体感温度、白天最高温

---

### 3.5 右侧榜单

#### Tab简化（原4个→3个）
- 预计热销TOP10 → **重点城市**
- 夜间闷热TOP10 → **闷热城市**
- 未来3天升温TOP10 → **升温城市**

#### 各榜字段

**重点城市榜**:
| 字段 | 说明 |
|------|------|
| 城市 | 城市名称 |
| ADI | ADI分数 |
| 等级 | 当前等级 |
| 白天最高温 | 白天最高温度 |
| 夜间最低温 | 夜间最低温度 |
| 热夜天数 | 连续热夜天数 |
| 简短原因 | 判断原因 |

**闷热城市榜**:
| 字段 | 说明 |
|------|------|
| 城市 | 城市名称 |
| 夜间最低温 | 夜间最低温度 |
| 夜间体感 | 夜间体感温度 |
| 湿度 | 相对湿度 |
| 连续热夜 | 连续热夜天数 |

**升温城市榜**:
| 字段 | 说明 |
|------|------|
| 城市 | 城市名称 |
| 今日ADI | 当前ADI |
| 未来3天ADI | 未来3天平均ADI |
| ADI涨幅 | ADI变化值 |
| 最高温变化 | 最高温变化 |
| 夜间温度变化 | 夜间温度变化 |

---

### 3.6 今日简报模态框（新增）

#### 触发方式
点击"生成今日简报"按钮，弹出模态框

#### 模态框结构
```
┌─────────────────────────────────────────┐
│ 今日销售机会简报                    [×] │
├─────────────────────────────────────────┤
│ [管理层短版] [运营详细版]                │
├─────────────────────────────────────────┤
│ 更新时间: 2026-05-11 09:30              │
│                                          │
│ 今日销售机会强度: 偏强                   │
│                                          │
│ 【整体判断】                             │
│ 今日空调销售机会偏强。                   │
│                                          │
│ 【重点大区】                             │
│ 华南（强）、华东（偏强）、华中（中高）    │
│                                          │
│ 【重点城市】                             │
│ 东莞、佛山、深圳、福州、杭州             │
│                                          │
│ 【未来升温城市】                         │
│ 杭州、南京、合肥                         │
│                                          │
│ 【判断依据】                             │
│ 夜间温度持续偏高，部分城市连续闷热夜。   │
│ 未来3天杭州、南京、合肥等城市ADI上升明显。│
├─────────────────────────────────────────┤
│              [复制简报] [关闭]           │
└─────────────────────────────────────────┘
```

#### 简报内容原则
- 只提供销售方向辅助判断
- 不输出：投放金额、库存数量、客服增援等具体执行动作
- 可以输出：建议关注、纳入重点观察、进入销售机会池等

#### 实现方式
- 第一期：模板+占位符
- 后续：基于真实数据动态生成

---

### 3.7 城市详情弹窗

#### 新增板块：管理层摘要

```
该城市当前处于爆发级，主要原因是夜间温度持续偏高、
未来3天高温延续，预计短期空调需求强度较高。
```

#### 实现方式
- 模板替换：`"该城市当前处于[等级]，主要原因是[触发规则1]、[触发规则2]，预计[需求判断]。"`

---

## 四、数据逻辑新增

### 4.1 大区统计函数

**函数**: `Core.calculateRegionStats(cityData)`

**返回结构**:
```javascript
{
  regionName: {
    level: '强', // 机会等级
    explosiveCount: 5,
    actionCount: 4,
    opportunityCount: 3,
    observeCount: 2,
    hotNightCount: 12,
    totalCities: 37,
    representativeCities: ['东莞', '佛山', '深圳'],
    reason: '夜间温度持续偏高'
  }
}
```

### 4.2 强度判断函数

**函数**: `Core.calculateSalesIntensity(cityData)`

**返回**: `'低' | '中' | '偏强' | '强'`

### 4.3 简报生成函数

**函数**: `Core.generateDailyBrief(cityData, version)`

**参数**:
- `cityData`: 城市数据数组
- `version`: `'management' | 'operational'`

**返回**: 简报文本对象

---

## 五、UI模块调整

### 5.1 新增函数

**ui.js新增**:
- `renderTodayConclusion()`: 渲染今日判断结论
- `renderRegionRanking()`: 渲染大区机会排行
- `renderTopCitiesTabs()`: 渲染简化后的右侧榜单Tab
- `renderHotSalesTab()`: 重点城市榜
- `renderNightMuggyTab()`: 闷热城市榜
- `renderHeatRiseTab()`: 升温城市榜
- `openDailyBriefModal()`: 打开今日简报模态框
- `closeDailyBriefModal()`: 关闭模态框
- `copyDailyBrief()`: 复制简报内容

### 5.2 修改函数

- `renderDashboard()`: 调整左侧面板渲染逻辑
- `updateHeaderStats()`: 增加"销售机会强度"字段
- `selectCity()`: 城市详情弹窗增加"管理层摘要"

---

## 六、HTML结构调整

### 6.1 侧边栏
```html
<div class="logo">
    <h1>空调热销区域雷达</h1>
    <p>基于天气数据判断空调区域销售机会</p>
</div>

<nav class="nav-menu">
    <div class="nav-item active" data-page="dashboard">
        <span class="nav-icon">🎯</span>
        <span class="nav-text">销售总览</span>
    </div>
    <!-- 其他导航项保持不变 -->
</nav>
```

### 6.2 顶部状态栏
```html
<div class="header-stats">
    <div class="header-stat">
        <div class="header-stat-label">销售机会强度</div>
        <div class="header-stat-value" id="salesIntensity">--</div>
    </div>
    <!-- 其他统计项 -->
</div>
```

### 6.3 左侧面板
```html
<aside class="left-sidebar">
    <!-- 今日判断结论 -->
    <div class="sidebar-card" id="todayConclusion">
        <div class="card-header">今日判断结论</div>
        <div class="card-body">
            <div class="conclusion-intensity">
                今日销售机会：<span class="intensity-value">--</span>
            </div>
            <div class="conclusion-regions">
                重点区域：<span class="regions-value">--</span>
            </div>
            <div class="conclusion-reason">
                核心原因：<span class="reason-value">--</span>
            </div>
        </div>
    </div>
    
    <!-- 大区机会排行 -->
    <div class="sidebar-card" id="regionRanking">
        <div class="card-header">大区机会排行</div>
        <div class="card-body">
            <!-- 动态渲染 -->
        </div>
    </div>
    
    <!-- 最长连续闷热夜 -->
    <div class="sidebar-card" id="longestHotNight">
        <!-- 保持原有结构 -->
    </div>
</aside>
```

### 6.4 地图区域
```html
<div class="map-section">
    <div class="section-header">
        <span class="section-title">全国空调销售机会热力图</span>
        <div class="view-mode-toggle">
            <!-- 保持不变 -->
        </div>
    </div>
    <div class="map-legend">
        <span class="legend-item"><span class="legend-dot outbreak"></span>爆发级</span>
        <span class="legend-item"><span class="legend-dot action"></span>行动级</span>
        <span class="legend-item"><span class="legend-dot opportunity"></span>机会级</span>
        <span class="legend-item"><span class="legend-dot observe"></span>观察级</span>
        <span class="legend-item"><span class="legend-dot normal"></span>普通</span>
    </div>
    <div class="map-view-desc" id="mapViewDesc">
        颜色越红，空调销售机会越高
    </div>
    <div id="china-map"></div>
</div>
```

### 6.5 右侧榜单
```html
<aside class="right-sidebar">
    <div class="top-cities-section">
        <div class="section-header">
            <div class="top-tabs" id="topTabs">
                <button class="top-tab active" data-tab="hotSales">重点城市</button>
                <button class="top-tab" data-tab="nightMuggy">闷热城市</button>
                <button class="top-tab" data-tab="heatRise">升温城市</button>
            </div>
        </div>
        <div class="top-cities-list" id="topCitiesContainer"></div>
        <button class="btn-generate-brief" id="generateBriefBtn">
            📄 生成今日简报
        </button>
    </div>
</aside>
```

### 6.6 简报模态框（新增）
```html
<div class="daily-brief-modal" id="dailyBriefModal">
    <div class="modal-overlay" onclick="UI.closeDailyBriefModal()"></div>
    <div class="modal-content">
        <div class="modal-header">
            <h3>今日销售机会简报</h3>
            <button class="modal-close" onclick="UI.closeDailyBriefModal()">×</button>
        </div>
        <div class="modal-tabs">
            <button class="modal-tab active" data-version="management">管理层短版</button>
            <button class="modal-tab" data-version="operational">运营详细版</button>
        </div>
        <div class="modal-body" id="briefContent">
            <!-- 动态渲染简报内容 -->
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="UI.copyDailyBrief()">复制简报</button>
            <button class="btn btn-primary" onclick="UI.closeDailyBriefModal()">关闭</button>
        </div>
    </div>
</div>
```

---

## 七、CSS样式新增

### 7.1 顶部状态栏
```css
.header-stat-value.intensity-low { color: #4A90E2; }
.header-stat-value.intensity-medium { color: #F5A623; }
.header-stat-value.intensity-high { color: #F57C00; }
.header-stat-value.intensity-strong { color: #D0021B; }
```

### 7.2 左侧面板
```css
.sidebar-card {
    background: #141b3d;
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
}

.card-header {
    font-size: 14px;
    font-weight: 600;
    color: #8b9dc3;
    margin-bottom: 12px;
}

.conclusion-intensity .intensity-value {
    font-size: 24px;
    font-weight: 700;
}

.region-ranking-item {
    display: flex;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid #2a3558;
}

.region-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
}
```

### 7.3 地图图例
```css
.map-legend {
    display: flex;
    gap: 16px;
    padding: 8px 16px;
    justify-content: center;
}

.legend-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    display: inline-block;
    margin-right: 4px;
}

.legend-dot.outbreak { background: #D0021B; }
.legend-dot.action { background: #F57C00; }
.legend-dot.opportunity { background: #F5A623; }
.legend-dot.observe { background: #4A90E2; }
.legend-dot.normal { background: #555555; }
```

### 7.4 简报模态框
```css
.daily-brief-modal {
    display: none;
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 1000;
}

.daily-brief-modal.active {
    display: flex;
    align-items: center;
    justify-content: center;
}

.modal-content {
    background: #1a2342;
    border-radius: 12px;
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    overflow-y: auto;
}

.brief-section {
    margin-bottom: 16px;
}

.brief-section-title {
    font-weight: 600;
    color: #8b9dc3;
    margin-bottom: 8px;
}
```

### 7.5 生成简报按钮
```css
.btn-generate-brief {
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, #4A90E2, #357ABD);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    margin-top: 16px;
}

.btn-generate-brief:hover {
    background: linear-gradient(135deg, #357ABD, #2a5f8f);
}
```

---

## 八、实施检查清单

### 8.1 文件备份
- [ ] 备份 index-v2.html → index-v2-before-sales-overview.html

### 8.2 HTML修改
- [ ] 修改侧边栏logo和导航
- [ ] 修改顶部状态栏，增加"销售机会强度"
- [ ] 重构左侧面板（今日判断结论、大区机会排行、最长连续闷热夜）
- [ ] 修改地图标题和图例
- [ ] 简化右侧榜单Tab
- [ ] 增加"生成今日简报"按钮
- [ ] 新增简报模态框HTML

### 8.3 CSS修改
- [ ] 增加强度等级颜色样式
- [ ] 增加左侧面板卡片样式
- [ ] 增加地图图例样式
- [ ] 增加简报模态框样式
- [ ] 增加生成简报按钮样式

### 8.4 JavaScript修改
**core.js**:
- [ ] 新增 `calculateRegionStats()` 函数
- [ ] 新增 `calculateSalesIntensity()` 函数
- [ ] 新增 `generateDailyBrief()` 函数

**ui.js**:
- [ ] 新增 `renderTodayConclusion()` 函数
- [ ] 新增 `renderRegionRanking()` 函数
- [ ] 修改 `renderTopCities()` 函数
- [ ] 新增 `renderHotSalesTab()` 函数
- [ ] 新增 `renderNightMuggyTab()` 函数
- [ ] 新增 `renderHeatRiseTab()` 函数
- [ ] 新增 `openDailyBriefModal()` 函数
- [ ] 新增 `closeDailyBriefModal()` 函数
- [ ] 新增 `copyDailyBrief()` 函数
- [ ] 修改 `updateHeaderStats()` 函数
- [ ] 修改 `renderDashboard()` 函数
- [ ] 修改 `selectCity()` 函数（增加管理层摘要）

**map.js**:
- [ ] 增加视图说明切换逻辑

### 8.5 测试验证
- [ ] 验证首页加载正常
- [ ] 验证销售机会强度显示正确
- [ ] 验证左侧三块内容渲染正确
- [ ] 验证地图图例和视图说明
- [ ] 验证右侧榜单切换正常
- [ ] 验证简报模态框打开/关闭
- [ ] 验证复制简报功能
- [ ] 验证城市详情弹窗显示管理层摘要

---

## 九、后续规划（第二期+）

### 第二期：机会分析页面
- 页面标题：热销分析 → 机会分析
- 增加大区机会分析维度
- 调整榜单命名和字段

### 第三期：7天趋势页面
- 页面标题：7天预测 → 7天趋势预测
- 改为逐日矩阵展示
- 增加维度切换

### 第四期：历史复盘页面
- 页面标题：历史记录 → 历史复盘
- 增加复盘概览统计

### 第五期：规则设置页面
- 增加权限提示
- 考虑分级权限

---

## 十、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 数据量较大导致渲染慢 | 用户体验下降 | 限制榜单显示条数，使用虚拟滚动 |
| 强度判断规则复杂 | 边界情况判断错误 | 充分测试边界值，添加单元测试 |
| 简报生成逻辑占位 | 功能不完整 | 明确标注"演示版本"，后续迭代 |

---

**设计文档版本**: v1.0
**状态**: 待审核
