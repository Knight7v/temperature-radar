# 空调热销区域雷达 - 部署指南

## 🚀 快速部署到 Vercel

### 步骤 1：注册 Vercel 账号

1. 访问 [vercel.com](https://vercel.com)
2. 点击 "Sign Up"
3. 使用以下方式之一注册：
   - GitHub 账号（推荐）
   - GitLab 账号
   - Bitbucket 账号
   - 邮箱注册

### 步骤 2：安装 Vercel CLI（可选）

```bash
npm install -g vercel
```

### 步骤 3：部署项目

**方法 A：使用命令行（推荐）**

```bash
# 进入项目目录
cd /Users/knight/Desktop/temperature-monitor-prototype

# 登录 Vercel
vercel login

# 部署
vercel --prod
```

**方法 B：使用 Vercel 网页界面**

1. 登录 [vercel.com/dashboard](https://vercel.com/dashboard)
2. 点击 "Add New Project"
3. 选择 "Import Git Repository"
4. 或者上传项目文件夹
5. 配置项目：
   - **Project Name**: temperature-radar（可自定义）
   - **Framework Preset**: Other
   - **Root Directory**: ./
   - **Build Command**:（留空）
   - **Output Directory**: ./
6. 点击 "Deploy"

### 步骤 4：获取访问地址

部署完成后，Vercel 会提供一个 URL，例如：
- `https://temperature-radar.vercel.app`
- `https://temperature-radar-xxx.vercel.app`

**将这个 URL 分享给北京和秦皇岛的团队即可！**

---

## 📱 两地员工使用方式

1. **打开浏览器**，访问部署好的 URL
2. **添加到收藏夹**，方便日常访问
3. **数据自动同步**：
   - 每6小时自动刷新天气数据
   - 所有员工看到的是同一份数据

---

## 🔧 自定义域名（可选）

如果公司有域名，可以配置自定义域名：

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
- ✅ 完全够用！

---

## 📞 技术支持

如遇问题，请联系开发团队。
