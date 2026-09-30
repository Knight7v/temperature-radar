const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({testDir:'./tests/browser',use:{baseURL:'http://127.0.0.1:41873',headless:true,channel:"chrome"},webServer:{command:'node scripts/dev-server.js --port 41873',url:'http://127.0.0.1:41873/login.html',reuseExistingServer:false},reporter:'list'});
