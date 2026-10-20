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
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  try{
   if(!/^\/api\/[a-z0-9/-]+$/.test(url.pathname))throw Error('Not found');
   const file=path.join(root,'api/index.js');
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>MAX_UPLOAD){res.writeHead(413,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'文件超过 '+(MAX_UPLOAD/1024/1024)+'MB 上限，请拆分后再导入'}));}chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);req.body=(req.headers['content-type']||'').includes('application/json')?(bytes.length?JSON.parse(bytes):{}):bytes;
   req.query=Object.fromEntries(url.searchParams);res.status=c=>(res.statusCode=c,res);res.json=b=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));};res.send=b=>res.end(b);
   return await require(file)(req,res);
  }catch(e){res.writeHead(500,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'本地API执行失败，请查看服务端日志'}));}
 }
 const name=url.pathname==='/'?'/workbench.html':decodeURIComponent(url.pathname);
 if(!/^\/(?:[a-z0-9-]+\.html|(?:js|css|assets)\/[a-zA-Z0-9_./-]+)$/.test(name)||name.includes('..')){res.writeHead(404);return res.end();}
 const file=path.join(root,name);try{const data=await fs.promises.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Workbench development server listening on '+port+(envLoaded.length?'  [已载入 .env.local: '+envLoaded.join(', ')+']':'  [未载入 .env.local，环境变量需由 shell 提供]')));
