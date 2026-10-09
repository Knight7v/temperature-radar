// Custom-format PostgreSQL backup; credentials are never included in command arguments.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
function main(){
 const url=new URL(process.env.DATABASE_URL||'');
 const dir=path.resolve(process.env.BACKUP_DIR||'backups');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const name='workbench-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump';
 const file=path.join(dir,name),partial=file+'.partial';
 const container=process.env.DB_BACKUP_CONTAINER;
 const args=['--format=custom','--no-owner','--no-acl','--username',decodeURIComponent(url.username),'--dbname',decodeURIComponent(url.pathname.slice(1))];
 const env={...process.env,PGPASSWORD:decodeURIComponent(url.password),PGHOST:url.hostname,PGPORT:url.port||'5432'};
 const fd=fs.openSync(partial,'wx',0o600);
 let result;
 try {result=container?spawnSync('docker',['exec',container,'pg_dump',...args],{stdio:['ignore',fd,'pipe']}):spawnSync('pg_dump',args,{env,stdio:['ignore',fd,'pipe']});}
 finally{fs.closeSync(fd);}
 if(result.error||result.status!==0){fs.unlinkSync(partial);throw Error('数据库备份失败，请检查数据库连接及 pg_dump / Docker 是否可用');}
 const check=container?spawnSync('docker',['exec','-i',container,'pg_restore','--list'],{input:fs.readFileSync(partial)}):spawnSync('pg_restore',['--list',partial]);
 if(check.error||check.status!==0){fs.unlinkSync(partial);throw Error('备份归档校验失败');}
 fs.renameSync(partial,file);
 const digest=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 fs.writeFileSync(file+'.sha256',digest+'  '+name+'\n',{mode:0o600});
 console.log('备份完成并通过归档检查：'+file);
}
try{main();}catch(e){console.error(e.message);process.exitCode=1;}
