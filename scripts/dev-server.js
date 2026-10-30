// Local development only. Public files are explicitly scoped; secrets/source are never served.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=Number(process.argv[process.argv.indexOf('--port')+1])||4173;
// 请求体上限：销售订单明细导出常有 4~20MB，太小会返回空 413，前端 r.json() 直接报错。
const MAX_UPLOAD=32*1024*1024;
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
// 本地环境变量：读取 .env.local / .env（手写最小解析，不新增依赖；已被 shell 注入的值不覆盖）。
// 注意：这个文件不会被 HTTP 服务暴露（下面的白名单只允许 .html 与 js/css/assets）。
const envLoaded=[];
for(const envFile of ['.env.local','.env']){
 const envPath=path.join(root,envFile);if(!fs.existsSync(envPath))continue;
 for(const rawLine of fs.readFileSync(envPath,'utf8').split(/\r?\n/)){
  const line=rawLine.trim();if(!line||line.startsWith('#'))continue;
  const eq=line.indexOf('=');if(eq<1)continue;
  const key=line.slice(0,eq).trim();if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))continue;
  let value=line.slice(eq+1).trim();
  if(value.length>=2&&((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))))value=value.slice(1,-1);
  if(value===''||process.env[key]!==undefined)continue;
  process.env[key]=value;envLoaded.push(key);
 }
}
// ===== 接口代码热重载 =====
// Node 会把首次 require 过的模块永久缓存，所以 api/index.js 与 handlers 一旦加载，
// 改了代码也只会继续跑旧的——典型症状：新加的接口返回「接口不存在」，或页面提示加载失败。
// 每次接口请求前比一次代码时间戳（api + handlers + lib 里最新的 .js），变了就清缓存重新加载。
// ⚠️ lib/db 故意不清：清了会重新建连接池，请求一多就把数据库连接耗光。
const apiFile=path.join(root,'api/index.js');
const watchDirs=[path.join(root,'api'),path.join(root,'handlers'),path.join(root,'lib')];
const reloadScopes=watchDirs.map(dir=>dir+path.sep);
const reloadKeeps=[path.join(root,'lib','db')+path.sep];
const apiStamp=()=>{try{return fs.statSync(apiFile).mtimeMs;}catch{return 0;}};
// 只盯 api/index.js 是不够的：改 handler 也会让接口行为变了（曾因此让新动作报「操作不存在」）。
// 递归 stat 一次约 1 毫秒，加 0.8 秒缓存，不必担心每次请求都扫盘。
let codeStampCache={at:0,value:0};
function codeStamp(){
 const now=Date.now();
 if(now-codeStampCache.at<800)return codeStampCache.value;
 let newest=0;
 const visit=dir=>{
  let entries;
  try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const entry of entries){
   const full=path.join(dir,entry.name);
   if(entry.isDirectory()){visit(full);continue;}
   if(!/\.(js|json)$/.test(entry.name))continue;
   try{const info=fs.statSync(full);if(info.mtimeMs>newest)newest=info.mtimeMs;}catch{/* 文件刚被删，忽略 */}
  }
 };
 for(const dir of watchDirs)visit(dir);
 codeStampCache={at:now,value:newest};
 return newest;
}
let apiLoadedStamp=codeStamp(),apiLoadedAt=new Date().toISOString(),reloadCount=0;
function purgeBusinessModules(){
 for(const key of Object.keys(require.cache)){
  if(!reloadScopes.some(scope=>key.startsWith(scope)))continue;
  if(reloadKeeps.some(keep=>key.startsWith(keep)))continue;
  delete require.cache[key];
 }
}
function loadApi(){
 const now=codeStamp();
 if(now!==apiLoadedStamp){
  const prev=apiLoadedStamp;
  purgeBusinessModules();
  try{
   const mod=require(apiFile);
   apiLoadedStamp=now;apiLoadedAt=new Date().toISOString();reloadCount+=1;
   console.log('[dev] 接口代码有改动，已自动重新加载（第 '+reloadCount+' 次）');
   return mod;
  }catch(error){
   // 新代码有语法/加载错误时保留旧状态，下一次请求会再试，服务不至于卡死在坏版本上
   apiLoadedStamp=prev;
   throw error;
  }
 }
 return require(apiFile);
}
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  try{
   // 启动器用这个接口判断「正在跑的服务是不是最新代码」，旧进程没有它会回 404 → 启动器自动换新的
   if(url.pathname==='/api/_status'){
    let reloadError=null;
    try{loadApi();}catch(error){reloadError=String((error&&error.message)||error);}
    const disk=codeStamp();
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({ok:true,pid:process.pid,port,apiLoadedAt,apiMtime:apiLoadedStamp,apiMtimeOnDisk:disk,fresh:disk===apiLoadedStamp,reloads:reloadCount,reloadError}));
   }
   if(!/^\/api\/[a-z0-9/_-]+$/.test(url.pathname))throw Error('Not found');
   const file=apiFile;
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD){res.writeHead(413,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'文件超过 '+(MAX_UPLOAD/1024/1024)+'MB 上限，请拆分后再导入'}));}chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);req.body=(req.headers['content-type']||'').includes('application/json')?(bytes.length?JSON.parse(bytes):{}):bytes;
   req.query=Object.fromEntries(url.searchParams);res.status=c=>(res.statusCode=c,res);res.json=b=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));};res.send=b=>res.end(b);
   return await loadApi()(req,res);
  }catch(e){res.writeHead(500,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'本地API执行失败，请查看服务端日志'}));}
 }
 const name=url.pathname==='/'?'/workbench.html':decodeURIComponent(url.pathname);
 if(!/^\/(?:[a-z0-9-]+\.html|(?:js|css|assets)\/[a-zA-Z0-9_./-]+)$/.test(name)||name.includes('..')){res.writeHead(404);return res.end();}
 const file=path.join(root,name);try{const data=await fs.promises.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Workbench development server listening on '+port+(envLoaded.length?'  [已载入 .env.local: '+envLoaded.join(', ')+']':'  [未载入 .env.local，环境变量需由 shell 提供]')));
