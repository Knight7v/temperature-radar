# 公司工作台

运行 `npm install`、`npm run dev` 后访问 http://127.0.0.1:41873/workbench.html 。

使用既有公司 slug、账号和密码登录；数据库与 JWT_SECRET 按 P0-SETUP.md 配置。未配置数据库时不会使用模拟身份。当前标签通过 sessionStorage 保存会话，关闭标签后重新登录。

气温旧入口 index-v2.html 保留。库存模块按独立计划实施；客服质检与视觉设计仅显示规划中。

运行 `npm run test:browser` 做浏览器检查；数据库测试使用隔离测试库，不能连接生产库。
