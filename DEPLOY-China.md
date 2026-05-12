# 空调热销区域雷达 - 国内部署指南

## 🇨🇳 国内平台部署方案

### 方案一：Gitee Pages + Coding（推荐）

#### 步骤 1：注册 Gitee 账号
1. 访问：https://gitee.com
2. 注册账号（免费）
3. 验证邮箱

#### 步骤 2：创建仓库
1. 点击右上角 "+" → "新建仓库"
2. 仓库名：`temperature-radar`
3. 设为**公开**
4. 点击"创建"

#### 步骤 3：上传项目
**方式 A：网页上传（最简单）**
1. 在仓库页面点击"上传文件"
2. 将以下文件/文件夹拖入：
   - `index-v2.html`
   - `css/` 文件夹
   - `js/` 文件夹
   - `assets/` 文件夹
3. 点击"提交"

**方式 B：Git 命令**
```bash
cd /Users/knight/Desktop/temperature-monitor-prototype
git init
git add .
git commit -m "Initial commit"
git remote add origin https://gitee.com/YOUR_USERNAME/temperature-radar.git
git push -u origin main
```

#### 步骤 4：启用 Gitee Pages
1. 在仓库页面点击"服务" → "Gitee Pages"
2. 点击"启动"
3. 选择"master"分支
4. 等待部署完成
5. 获得访问地址：`https://YOUR_USERNAME.gitee.io/temperature-radar`

---

### 方案二：Vercel + 国内 CDN（保留当前部署）

如果您想继续使用 Vercel，可以让其他人：

1. **使用 VPN 访问**（如果公司允许）
2. **修改本地 hosts 文件**（不推荐，复杂）
3. **等待 Vercel CDN 在国内节点更新**（可能需要几小时到几天）

---

### 方案三：公司内部服务器（最稳定）

如果公司有服务器：

1. **使用 Nginx 部署**
2. **配置内网访问**
3. **北京秦皇岛两地利同时访问**

---

## 💡 推荐方案

**强烈建议使用 Gitee Pages**：
- ✅ 国内访问速度快
- ✅ 完全免费
- ✅ 部署简单
- ✅ 自动 HTTPS
- ✅ 支持自定义域名

---

## 🚀 快速决定

请选择：
1. **Gitee Pages** - 我帮您准备上传
2. **等待 Vercel** - 让其他人等 10 分钟后再试
3. **公司服务器** - 需要服务器配置信息
