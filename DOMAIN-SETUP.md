# Vercel 自定义域名配置指南

本文档记录了如何将自定义域名（kongtiaoredian.cn）配置到 Vercel 项目，以及常见问题的解决方案。

## 🎯 项目信息

- **GitHub 仓库**: https://github.com/Knight7v/temperature-radar
- **主项目**: project-cobu3
- **项目 ID**: prj_AFjWVuzjcUMyMUTeIv9ZjSppj0nn
- **自定义域名**: kongtiaoredian.cn
- **Git 邮箱**: qiwei627@gmail.com（必须与 GitHub 账户关联的邮箱一致）
- **组织**: knight7-v-s-projects
- **团队 ID**: team_yMscgvunU3EywfUj3AEbZfRf

---

## 📋 域名基础配置

### 域名信息
- **域名：** kongtiaoredian.cn
- **注册平台：** 腾讯云
- **当前Vercel项目：** project-cobu3

### 获取Vercel DNS记录

**方法A：通过Vercel CLI（推荐）**
```bash
# 登录Vercel
vercel login

# 查看项目信息
vercel ls

# 获取项目的DNS配置
vercel domains inspect
```

**方法B：通过Vercel控制台**

1. 访问 https://vercel.com/knight7-v-s-projects/project-cobu3
2. 点击 "Settings" → "Domains"
3. 查看域名的DNS配置

### 腾讯云DNS配置

1. **登录腾讯云控制台**
   - 访问：https://console.cloud.tencent.com/cns
   - 找到域名 `kongtiaoredian.cn`

2. **添加DNS记录**

   **记录1：根域名指向**
   ```
   类型: A
   主机记录: @
   记录值: 76.76.21.21 (Vercel的IP，以实际为准)
   TTL: 600
   ```

   **记录2：www子域名**
   ```
   类型: CNAME
   主机记录: www
   记录值: cname.vercel-dns.com
   TTL: 600
   ```

3. **验证DNS配置**
   ```bash
   # 检查DNS是否生效
   dig kongtiaoredian.cn
   dig www.kongtiaoredian.cn
   ```

---

## 🚀 部署配置

### Git 配置

确保本地 Git 配置使用正确的邮箱：

```bash
# 设置全局 Git 邮箱
git config --global user.email "qiwei627@gmail.com"

# 验证配置
git config user.email
```

**重要**: Vercel 需要识别提交作者，邮箱必须与 GitHub 账户关联。

### Vercel CLI 链接项目

**确定主项目**:
- 访问 https://vercel.com/knight7-v-s-projects
- 查看哪个项目配置了自定义域名（如 kongtiaoredian.cn）

**链接本地项目**:

```bash
# 删除现有的项目链接
rm -rf .vercel

# 手动创建项目配置
cat > .vercel/project.json << 'EOF'
{"projectId":"prj_AFjWVuzjcUMyMUTeIv9ZjSppj0nn","orgId":"team_yMscgvunU3EywfUj3AEbZfRf","projectName":"project-cobu3"}
EOF
```

### 配置 GitHub 集成（可选，用于自动部署）

在 Vercel 控制台中：

1. 访问 https://vercel.com/knight7-v-s-projects/project-cobu3
2. 进入 **Settings** → **Git**
3. 点击 **Connect GitHub**
4. 选择仓库：`Knight7v/temperature-radar`
5. 选择分支：`main`
6. 点击 **Connect**

### 部署到生产环境

使用 Vercel CLI 部署：

```bash
# 完整的部署流程
git add .
git commit -m "your commit message"
git push
vercel --prod --yes
```

部署成功后，自定义域名会自动更新到 https://kongtiaoredian.cn

---

## ⚠️ 常见问题与解决方案

### 问题 1: Git 提交者邮箱无效

**错误信息**:
```
提交作者邮箱地址（knight7v@gitee.com）无效。
这会导致 Vercel 无法识别提交作者，从而无法进行部署。
```

**解决方案**:
```bash
# 更新 Git 邮箱配置
git config --global user.email "qiwei627@gmail.com"

# 验证配置
git config user.email

# 创建新提交触发部署
git commit --allow-empty -m "fix: update git email"
git push
```

### 问题 2: 域名已被其他项目使用

**错误信息**:
```
无法添加 kongtiaoredian.cn，因为它已被您的某个项目使用。
```

**解决方案**:
1. 在 Vercel 项目列表中找到已配置域名的项目
2. 使用该项目作为主项目（推荐）
3. 或者从旧项目中删除域名，再添加到新项目

**推荐做法**: 直接使用已配置域名的项目（project-cobu3）作为主项目。

### 问题 3: 页面显示异常（黑色遮罩，无法点击）

**可能原因**:
- CSS 文件被浏览器缓存
- `.loading-screen.hidden` 样式缺少 `pointer-events: none`

**解决方案**:

1. **修复 CSS 样式**:
```css
.loading-screen.hidden {
    opacity: 0;
    visibility: hidden;
    pointer-events: none;  /* 添加此行 */
}
```

2. **添加缓存破坏参数**:
```html
<link rel="stylesheet" href="css/styles-v2.css?v=2">
```

3. **强制刷新浏览器**:
   - Mac: `Cmd + Shift + R`
   - Windows: `Ctrl + Shift + F5`

### 问题 4: GitHub 集成未自动触发部署

**可能原因**:
- Vercel 的 GitHub webhook 配置问题
- vercel.json 中 GitHub 集成被禁用

**解决方案**:
使用 Vercel CLI 手动部署：
```bash
vercel --prod --yes
```

### 问题 5: DNS验证失败

**解决方案**:
- 检查DNS记录是否正确添加
- 等待TTL过期（最长10分钟）
- 使用 `dig` 命令检查DNS解析

### 问题 6: SSL证书生成失败

**解决方案**:
- 确保DNS记录已正确配置
- 等待DNS完全生效（最多48小时）
- 检查域名是否在Vercel项目中正确添加

---

## ✅ 配置完成后的检查清单

### 基础配置
- [ ] DNS记录已添加到腾讯云
- [ ] Vercel控制台显示域名已验证
- [ ] SSL证书已生成
- [ ] https://kongtiaoredian.cn 可访问
- [ ] https://www.kongtiaoredian.cn 可访问

### 功能验证
- [ ] 页面正常显示，无错误
- [ ] 所有静态资源加载正常
- [ ] 页面可以正常滚动和点击
- [ ] 导航菜单功能正常
- [ ] 🌧️ 降水监控功能正常显示

### 部署验证
- [ ] Git 邮箱配置正确（qiwei627@gmail.com）
- [ ] Vercel CLI 链接到正确的项目（project-cobu3）
- [ ] 推送代码后能自动部署或可通过 CLI 手动部署
- [ ] 部署完成后域名自动更新

---

## 📞 相关链接

### Vercel
- Vercel 控制台: https://vercel.com/knight7-v-s-projects
- project-cobu3: https://vercel.com/knight7-v-s-projects/project-cobu3
- Vercel 域名文档: https://vercel.com/docs/concepts/projects/domains

### GitHub
- 仓库地址: https://github.com/Knight7v/temperature-radar
- Git 配置: qiwei627@gmail.com

### 生产环境
- 主域名: https://kongtiaoredian.cn
- v2 页面: https://kongtiaoredian.cn/index-v2.html

### 其他
- 腾讯云DNS: https://console.cloud.tencent.com/cns
- Vercel CLI 文档: https://vercel.com/docs/cli

---

## 📝 更新日志

- **2026-05-27**: 添加 Git 邮箱配置说明
- **2026-05-27**: 添加 CSS 缓存问题解决方案
- **2026-05-27**: 添加项目 ID 和团队信息
- **2026-05-27**: 添加 GitHub 集成配置步骤
- **2026-05-27**: 整合完整的域名配置和部署流程
- **2026-05-12**: 初始版本，基础域名配置

---

**最后更新：** 2026-05-27
**状态：** 已完成并验证
