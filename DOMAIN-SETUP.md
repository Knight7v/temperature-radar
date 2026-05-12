# kongtiaoredian.cn 域名配置指南

## 🎯 域名信息
- **域名：** kongtiaoredian.cn
- **注册平台：** 腾讯云
- **当前Vercel项目：** https://project-cobu3.vercel.app/

---

## 📋 步骤1：获取Vercel DNS记录

### 方法A：通过Vercel CLI（推荐）

```bash
# 登录Vercel
vercel login

# 查看项目信息
vercel ls

# 获取项目的DNS配置
vercel domains inspect
```

### 方法B：通过Vercel控制台

1. 访问 https://vercel.com/dashboard
2. 选择您的项目 `project-cobu3`
3. 点击 "Settings" → "Domains"
4. 点击 "Add Domain"，输入 `kongtiaoredian.cn`
5. Vercel会显示需要配置的DNS记录

---

## 📋 步骤2：在腾讯云配置DNS

### 腾讯云DNS配置步骤

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

## 📋 步骤3：在Vercel中验证域名

1. **在Vercel控制台验证**
   - 返回Vercel项目的Domains页面
   - 点击 "Verify" 验证DNS配置
   - 等待SSL证书自动生成（约10-30分钟）

2. **测试域名访问**
   ```bash
   # 测试根域名
   curl https://kongtiaoredian.cn

   # 测试www子域名
   curl https://www.kongtiaoredian.cn
   ```

---

## ⚠️ 常见问题

### Q1: DNS验证失败
**A**: 检查以下几点：
- DNS记录是否正确添加
- TTL是否已过期（等待最长10分钟）
- 使用 `dig` 命令检查DNS解析是否正确

### Q2: SSL证书生成失败
**A**:
- 确保DNS记录已正确配置
- 等待DNS完全生效（最多48小时）
- 检查域名是否在Vercel项目中正确添加

### Q3: 域名访问404
**A**:
- 检查vercel.json中的重定向规则
- 确认index.html和index-v2.html存在
- 查看Vercel部署日志

---

## ✅ 配置完成后的检查清单

- [ ] DNS记录已添加到腾讯云
- [ ] Vercel控制台显示域名已验证
- [ ] SSL证书已生成
- [ ] https://kongtiaoredian.cn 可访问
- [ ] https://www.kongtiaoredian.cn 可访问
- [ ] 页面正常显示，无错误
- [ ] 所有静态资源加载正常

---

## 🚀 配置完成后

域名配置完成后，可以：
1. 更新项目中的硬编码URL
2. 开始开发用户认证系统
3. 集成支付功能
4. 添加广告位

---

## 📞 技术支持

如遇问题：
1. Vercel文档：https://vercel.com/docs/concepts/projects/domains
2. 腾讯云DNS文档：https://cloud.tencent.com/document/product/302
3. 联系开发团队

---

**最后更新：** 2026-05-12
**状态：** 待执行
