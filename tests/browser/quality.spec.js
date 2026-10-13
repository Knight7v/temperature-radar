const {test,expect}=require('@playwright/test');
const rules=[{id:'response',label:'回应客户时间',kind:'critical',help:'核对响应间隔'},{id:'claims',label:'产品与活动信息',kind:'critical',categories:['product','promotion','after_sales'],help:'核对政策'},{id:'process',label:'业务流程',kind:'critical',categories:['order','after_sales'],help:'核对流程'},{id:'expression',label:'语言表达',kind:'standard',help:'核对表达'}];
async function boot(page){
 await page.addInitScript(()=>sessionStorage.setItem('workbench.session.v1',JSON.stringify({accessToken:'test',refreshToken:'test',expiresAt:Date.now()+900000})));
 await page.route('**/api/auth/me',route=>route.fulfill({json:{data:{user:{id:'u',identifier:'主管',role:'admin'},tenant:{id:'t',name:'测试公司',slug:'test'}}}}));
 let imported=false,review=null,uploadName=null,uploadBody=null,confirmBody=null,draftBody=null;
 await page.route('**/api/quality*',async route=>{
  const request=route.request(),url=new URL(request.url()),action=url.searchParams.get('action'),sampling=url.pathname.includes('/quality-analysis');
  const respond=data=>route.fulfill({json:{data}});
  if(action==='meta')return respond({rules,ruleVersion:'text-chat-v2',role:'admin',categories:[{id:'product',label:'产品选购'},{id:'promotion',label:'价格优惠'},{id:'order',label:'订单物流'},{id:'after_sales',label:'安装售后'},{id:'complaint',label:'投诉争议'}],shops:[{id:'11111111-1111-4111-8111-111111111111',data:{name:'格力旗舰店',brand:'格力'}},{id:'22222222-2222-4222-8222-222222222222',data:{name:'海尔星河专卖店',brand:'海尔'}}]});
  if(action==='preview'&&sampling)return respond({total:1,target:1,selected:1,requestedRate:Number(url.searchParams.get('rate')||15),actualRate:100,agentCount:1,coverageRaisedSample:false});
  if(action==='preview'){uploadName=request.headers()['x-quality-filename'];uploadBody=request.postDataBuffer().toString();return respond({id:'preview-1',filename:decodeURIComponent(uploadName),summary:{conversations:1,messages:2,missingEnd:0,endTimeConflicts:0,withoutAgent:0},speakers:[],examples:[{ordinal:1,agent:'测试客服',startedAt:'2026-10-10 10:00:00',anomalies:[],evidenceCount:1}]});}
  if(action==='confirm'){confirmBody=request.postDataJSON();imported=true;return respond({importId:'import-1',duplicate:false,sampling:{total:1,selected:1,actualRate:100,agentCount:1}});}
  if(action==='list')return respond({total:imported&&url.searchParams.get('brand')!=='海尔'?1:0,page:1,rows:imported&&url.searchParams.get('brand')!=='海尔'?[{id:'session-1',ordinal:1,agent:'测试客服',started_at:'2026-10-10 10:00:00',ended_at:'2026-10-10 10:03:00',status:review?.status||'pending',sampled:'true',score:review?.score??null,message_count:2,evidence_count:1,assignment:{shopId:'11111111-1111-4111-8111-111111111111',shopName:'格力旗舰店',brand:'格力',group:'格力组'},machine:{score:95,deductions:[{code:'slow-reply',points:5,label:'回复间隔 180 秒',messageIds:[0,1]}],warnings:[{code:'slow-reply',severity:'medium',label:'回复较慢',messageIds:[0,1]}]}}]:[]});
  if(action==='detail')return respond({assignment:{shopName:'格力旗舰店',brand:'格力',group:'格力组'},analysis:{categories:[{id:'after_sales',label:'安装售后',messageIds:[0]}],metrics:{messageCount:2,customerTurns:1,agentTurns:1,firstReplySeconds:180},checks:[{ruleId:'process',label:'安装售后流程',mode:'external',guidance:'需核对安装记录。'}],signals:[]},machine:{score:95,deductions:[{code:'slow-reply',points:5,label:'回复间隔 180 秒',messageIds:[0,1]}],warnings:[{code:'slow-reply',severity:'medium',label:'回复较慢',messageIds:[0,1]}]},id:'session-1',ordinal:1,agent:'测试客服',started_at:'2026-10-10 10:00:00',ended_at:'2026-10-10 10:03:00',status:review?.status||'pending',revision:review?1:0,review,data:{anomalies:[],evidence:[{ruleId:'response',title:'人工回复间隔较长',messageIds:[0,1],waitSeconds:180}],messages:[{id:0,role:'customer',speaker:'顾客',at:'2026-10-10 10:00:00',text:'请问安装时间？'},{id:1,role:'agent',speaker:'测试客服',at:'2026-10-10 10:03:00',text:'稍后回复您。'}]}});
  if(action==='review'){const payload=request.postDataJSON();if(!payload.finish){draftBody=payload;return respond({review:{...payload,status:'draft',score:null},revision:1});}review={...payload,status:'reviewed',score:30};return respond({review,revision:1});}
  return route.fulfill({status:404,json:{error:'未知操作'}});
 });
 return{getUpload:()=>({name:uploadName,body:uploadBody}),getConfirm:()=>confirmBody,getDraft:()=>draftBody};
}
test('LOG and TXT transcript uploads show machine pre-score and preserve supervisor final score',async({page})=>{
 const state=await boot(page);await page.goto('/quality.html');
 await expect(page.getByRole('heading',{name:'导入聊天记录'})).toBeVisible();
 await expect(page.locator('#file')).toHaveAttribute('accept',/\.log.*\.txt/);
 await expect(page.locator('#rate')).toHaveValue('15');
 const content='/******以下为一通会话******/\n顾客 2026-10-10 10:00:00\n请问安装时间？';
 await page.locator('#file').setInputFiles({name:'conversation.log',mimeType:'text/plain',buffer:Buffer.from(content)});
 await page.getByRole('button',{name:'校验与预览'}).click();
 await expect(page.getByText('已读取 conversation.log')).toBeVisible();
 await expect(page.locator('#sampleStats')).toContainText('覆盖 1 位客服');
 expect(state.getUpload()).toMatchObject({name:encodeURIComponent('conversation.log'),body:content});
 await page.locator('#importShop').selectOption('11111111-1111-4111-8111-111111111111');await page.getByRole('button',{name:'确认导入会话'}).click();expect(state.getConfirm().shopId).toBe('11111111-1111-4111-8111-111111111111');
 await expect(page.getByText('成功导入 1 通会话')).toBeVisible();
 await expect(page.locator('#filterScope')).toHaveValue('sampled');
 await expect(page.locator('#rows')).toContainText('待复核');
 await expect(page.locator('#rows')).toContainText('95 分');await expect(page.locator('#rows')).not.toContainText('30');
 await expect(page.locator('#filterShop option')).toHaveCount(4);await page.locator('#filterBrand').selectOption('海尔');await page.getByRole('button',{name:'查询'}).click();await expect(page.locator('#rows')).toContainText('暂无匹配会话');await page.locator('#filterBrand').selectOption('格力');await page.locator('#filterShop').selectOption('11111111-1111-4111-8111-111111111111');await page.locator('#filterGroup').selectOption('格力组');await page.getByRole('button',{name:'查询'}).click();await page.locator('#rows button').click();await expect(page.locator('#machinePanel')).toContainText('95 / 100');
 await expect(page.getByText('人工回复间隔较长')).toBeVisible();
 await page.locator('[data-evidence-index="0"]').selectOption('issue');
  await page.locator('[data-rule-id="response"]').selectOption('issue');
  await page.locator('[data-rule-id="claims"]').selectOption('pass');
  await page.locator('[data-rule-id="process"]').selectOption('pass');
 await page.locator('[data-rule-id="expression"]').selectOption('5');
 await page.getByRole('button',{name:'完成复核'}).click();
 await expect(page.getByText('已复核 · 评分 30')).toBeVisible();
 await page.locator('#file').setInputFiles({name:'conversation.txt',mimeType:'text/plain',buffer:Buffer.from(content)});
 await page.getByRole('button',{name:'校验与预览'}).click();
 await expect(page.getByText('已读取 conversation.txt')).toBeVisible();
});

test('supervisor can correct consultation category and see only applicable rules',async({page})=>{
 const state=await boot(page);await page.goto('/quality.html');
 await page.locator('#file').setInputFiles({name:'conversation.log',mimeType:'text/plain',buffer:Buffer.from('顾客 2026-10-10 10:00:00\n请问安装时间？')});
 await page.getByRole('button',{name:'校验与预览'}).click();
 await page.getByRole('button',{name:'确认导入会话'}).click();
 await page.locator('#rows button').click();
 await expect(page.locator('#consultationCategories')).toContainText('安装售后');
 await expect(page.locator('#consultationMetrics')).toContainText('首次回复 180 秒');
 await page.locator('#category-product').check();
 await expect(page.locator('#ratings [data-rule-id="process"]')).toBeVisible();
 await expect(page.locator('#ratings [data-rule-id="claims"]')).toBeVisible();
 await page.locator('#category-after_sales').uncheck();
 await expect(page.locator('#ratings [data-rule-id="process"]')).toHaveCount(0);
 await page.getByRole('button',{name:'保存草稿'}).click();
 await expect.poll(()=>state.getDraft()?.categoryIds).toEqual(['product']);
});
