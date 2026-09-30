// Local development only. Public files are explicitly scoped; secrets/source are never served.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),port=Number(process.argv[process.argv.indexOf('--port')+1])||4173;
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  try{
   if(!/^\/api\/[a-z0-9/-]+$/.test(url.pathname))throw Error('Not found');
   const file=path.join(root,url.pathname+'.js');if(!fs.existsSync(file)){res.writeHead(404);return res.end();}
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>3*1024*1024+1024){res.writeHead(413);return res.end();}chunks.push(chunk);}
   const bytes=Buffer.concat(chunks);req.body=(req.headers['content-type']||'').includes('application/json')?(bytes.length?JSON.parse(bytes):{}):bytes;
   req.query=Object.fromEntries(url.searchParams);res.status=c=>(res.statusCode=c,res);res.json=b=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));};res.send=b=>res.end(b);
   return await require(file)(req,res);
  }catch(e){res.writeHead(500,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'本地API执行失败，请查看服务端日志'}));}
 }
 const name=url.pathname==='/'?'/workbench.html':decodeURIComponent(url.pathname);
 if(!/^\/(?:[a-z0-9-]+\.html|(?:js|css|assets)\/[a-zA-Z0-9_./-]+)$/.test(name)||name.includes('..')){res.writeHead(404);return res.end();}
 const file=path.join(root,name);try{const data=await fs.promises.readFile(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log('Workbench development server listening on '+port));
