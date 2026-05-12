# 空调热销区域雷达 - Vercel 部署指南

## 🚀 快速部署到 Vercel

### 步骤 1：注册 Vercel 账号

1. 访问 [vercel.com](https://vercel.com)
2. 点击 "Sign Up"
3. 使用以下方式之一注册：
   - GitHub 账号（推荐）
   - GitLab 账号
   - Bitbucket 账号
   - 邮箱注册

### 步骤 2：准备项目文件

确保项目包含以下文件：
```
temperature-monitor-prototype/
├── index.html          （自动重定向到 index-v2.html）
├── index-v2.html       （主应用页面）
├── vercel.json         （Vercel 配置）
├── css/
│   └── styles-v2.css   （样式文件）
├── js/
│   ├── app.js
│   ├── china-geo.js
│   ├── core.js
│   ├── map.js
│   └── ui.js
└── assets/
    ├── echarts.min.js  （图表库）
    └── china.json      （地图数据）
```

### 步骤 3：部署项目

**方法 A：使用 Vercel CLI（推荐）**

```bash
# 安装 Vercel CLI
npm install -g vercel

# 进入项目目录
cd /path/to/temperature-monitor-prototype

# 登录 Vercel
vercel login

# 部署到生产环境
vercel --prod
```

**方法 B：使用 Vercel 网页界面**

1. 登录 [vercel.com/dashboard](https://vercel.com/dashboard)
2. 点击 "Add New Project"
3. 导入 Git 仓库或上传项目文件夹
4. 配置项目：
   - **Project Name**: temperature-radar（可自定义）
   - **Framework Preset**: Other
   - **Root Directory**: ./
   - **Build Command**:（留空）
   - **Output Directory**: ./
5. 点击 "Deploy"

### 步骤 4：获取访问地址

部署完成后，Vercel 会提供一个 URL，例如：
- `https://temperature-radar.vercel.app`
- `https://temperature-radar-xxx.vercel.app`

**将这个 URL 分享给团队即可！**

---

## 🔧 自定义域名（可选）

如果需要自定义域名：

1. 在 Vercel 项目中，点击 "Settings" → "Domains"
2. 添加您的域名，如 `radar.yourcompany.com`
3. 按提示配置 DNS 记录

---

## 💰 费用说明

**Vercel 免费版包含：**
- ✅ 无限带宽
- ✅ 全球 CDN
- ✅ 自动 HTTPS
- ✅ 100GB 每月流量
- ✅ 自动部署
- ✅ 完全够用！

---

## 📱 团队使用方式

1. **打开浏览器**，访问部署好的 URL
2. **添加到收藏夹**，方便日常访问
3. **数据自动同步**：
   - 每6小时自动刷新天气数据
   - 所有团队成员看到的是同一份数据

---

## 🔄 更新系统

### 方法 1：通过 Git 自动部署（推荐）

```bash
# 提交更改到 Git 仓库
git add .
git commit -m "更新功能"
git push

# Vercel 会自动检测到更改并重新部署
```

### 方法 2：通过 CLI 手动部署

```bash
vercel --prod
```

---

## 📊 部署配置说明

### vercel.json 配置

项目包含优化的 Vercel 配置：

- **自动重定向**：访问根路径自动重定向到主应用
- **缓存策略**：
  - 静态资源（JS/CSS）：7天缓存
  - 资源文件（assets）：1年不可变缓存
  - 主页面：5分钟缓存
- **安全头**：包含基本的安全 HTTP 头

---

## ⚠️ 常见问题

### Q1: 页面显示 404
**A**: 确认 `index.html` 和 `index-v2.html` 都已上传

### Q2: 地图不显示
**A**:
- 检查 `assets/china.json` 是否已上传
- 按 F12 查看控制台错误信息

### Q3: 数据不更新
**A**:
- 系统每 6 小时自动刷新
- 手动刷新：按 Ctrl+F5 或 Cmd+Shift+R
- 清除浏览器缓存

### Q4: 部署后页面空白
**A**:
- 检查浏览器控制台是否有错误
- 确认所有 JS 文件路径正确
- 检查 `vercel.json` 配置

---

## 🚀 部署检查清单

部署前检查：
- [ ] 所有必要的文件都已上传
- [ ] `vercel.json` 配置正确
- [ ] `.gitignore` 已配置（排除敏感文件）
- [ ] 测试本地访问正常

部署后验证：
- [ ] 访问 Vercel 提供的 URL
- [ ] 检查页面是否正常显示
- [ ] 验证地图功能是否正常
- [ ] 测试数据更新功能
- [ ] 分享 URL 给团队成员

---

## 📞 技术支持

如遇问题，请：
1. 检查 Vercel 部署日志
2. 查看浏览器控制台错误
3. 参考本文档常见问题部分
4. 联系开发团队

---

## 🎉 完成！

部署完成后，团队成员可以通过同一个地址访问系统，看到完全相同的数据。

**预计完成时间：5-10 分钟**
