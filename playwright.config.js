const {defineConfig}=require('@playwright/test');
// reuseExistingServer：本地开发时服务常驻在 41873，不复用就会因为「端口已占用」直接失败；
// dev-server 每次请求都会比文件 mtime 自动重载 api/handlers/lib，所以复用常驻服务跑的是最新代码。
module.exports=defineConfig({testDir:'./tests/browser',use:{baseURL:'http://127.0.0.1:41873',headless:true,channel:"chrome"},webServer:{command:'node scripts/dev-server.js --port 41873',url:'http://127.0.0.1:41873/login.html',reuseExistingServer:true},reporter:'list'});
