const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../lib/service/agents');

const shops=[
 {id:'s-gr',name:'格力旗舰店',brand:'格力'},
 {id:'s-new',name:'格力空调换新旗舰店',brand:'格力'},
 {id:'s-hr',name:'海尔星河专卖店',brand:'海尔'}
];

test('从昵称认店铺：取最长匹配，别让「格力旗舰店」抢走「格力空调换新旗舰店」的人',()=>{
 const a=A.inferProfile('格力旗舰店售前-阿伟',shops);
 assert.equal(a.shop,'格力旗舰店');
 assert.equal(a.shopId,'s-gr');
 assert.equal(a.brandGroup,'格力');
 assert.equal(a.role,'售前');

 const b=A.inferProfile('格力空调换新旗舰店售前-小星',shops);
 assert.equal(b.shop,'格力空调换新旗舰店');
 assert.equal(b.shopId,'s-new');

 const c=A.inferProfile('海尔星河专卖店售后-小刘',shops);
 assert.equal(c.shop,'海尔星河专卖店');
 assert.equal(c.brandGroup,'海尔');
 assert.equal(c.role,'售后');
});

test('认不出店铺时留空，不瞎猜',()=>{
 const r=A.inferProfile('临时支援-田七',shops);
 assert.equal(r.shop,'');
 assert.equal(r.shopId,'');
 assert.equal(r.brandGroup,'');
 assert.equal(r.role,'');
});

test('机器人不算人：京小智与 jimi 账号都排除',()=>{
 assert.equal(A.isRobot('京小智'),true);
 assert.equal(A.isRobot('京小智 '),true);
 assert.equal(A.isRobot('jimi_vender_22950829'),true);
 assert.equal(A.isRobot('格力旗舰店售前-阿伟'),false);
 assert.equal(A.isRobot('小智障'),false);
});

test('必填与枚举校验',()=>{
 assert.throws(()=>A.validate(A.normalize({agentName:'  '})),/客服名称必填/);
 assert.throws(()=>A.validate(A.normalize({agentName:'京小智'})),/机器人/);
 assert.throws(()=>A.validate(A.normalize({agentName:'阿伟',status:'休假'})),/状态只能是/);
 assert.throws(()=>A.validate(A.normalize({agentName:'阿伟',role:'打杂'})),/岗位只能是/);
 assert.throws(()=>A.validate(A.normalize({agentName:'阿伟',brandGroup:'夏普'})),/品牌组别只能是/);
 assert.throws(()=>A.validate(A.normalize({agentName:'阿伟',joinDate:'2026-13-40'})),/入职日期/);
 assert.throws(()=>A.validate(A.normalize({agentName:'阿伟'.repeat(30)})),/超过/);
});

test('规范化：去空格、清控制符、状态默认在职',()=>{
 const d=A.normalize({agentName:'  格力旗舰店售前-阿伟  ',employeeName:'\t张伟\n',status:''});
 assert.equal(d.agentName,'格力旗舰店售前-阿伟');
 assert.equal(d.employeeName,'张伟');
 assert.equal(d.status,'在职');
 assert.equal(A.validate(d).agentName,'格力旗舰店售前-阿伟');
});

test('质检统计贴到档案上：昵称大小写与空格视为同一个人',()=>{
 const agents=[
  {id:'1',data:{agentName:'格力旗舰店售前-阿伟',status:'在职'}},
  {id:'2',data:{agentName:'格力旗舰店售前-婷婷',status:'在职'}},
  {id:'3',data:{agentName:'没人跑的昵称',status:'在职'}}
 ];
 const stats=[
  {agent:' 格力旗舰店售前-阿伟 ',sessions:266,analyzed:40,avg_score:'77.94',last_at:'2026-03-25 17:53:23'},
  {agent:'格力旗舰店售前-婷婷',sessions:201,analyzed:0,avg_score:null,last_at:'2026-03-25 16:16:00'},
  {agent:'没建档的昵称',sessions:5,analyzed:5,avg_score:'60.00',last_at:null},
  {agent:'京小智',sessions:25,analyzed:0,avg_score:null,last_at:null}
 ];
 const {rows,orphans}=A.mergeStats(agents,stats);
 assert.equal(rows[0].stat.sessions,266);
 assert.equal(rows[0].stat.avgScore,77.9);
 assert.equal(rows[1].stat.avgScore,null);
 assert.equal(rows[2].stat,null);
 /* 未建档的只留真人，机器人不进「待补」名单 */
 assert.deepEqual(orphans.map(item=>item.agent),['没建档的昵称']);
});

test('概览口径：在册 / 离职 / 资料待补',()=>{
 const rows=[
  {data:{agentName:'a',employeeName:'张伟',shop:'格力旗舰店',brandGroup:'格力',status:'在职'}},
  {data:{agentName:'b',employeeName:'',shop:'格力旗舰店',brandGroup:'格力',status:'在职'}},
  {data:{agentName:'c',employeeName:'李四',shop:'',brandGroup:'',status:'离职'}}
 ];
 const s=A.summarize(rows);
 assert.equal(s.total,3);
 assert.equal(s.active,2);
 assert.equal(s.left,1);
 assert.equal(s.withEmployee,2);
 /* b 缺姓名、c 缺店铺和品牌 → 都算资料待补 */
 assert.equal(s.missing,2);
});
