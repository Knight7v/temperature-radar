function businessDate(now=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=t=>p.find(x=>x.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`;}
function previousBusinessDate(now=new Date()){const day=businessDate(now);return new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
function validDate(d){return typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;}
module.exports={businessDate,previousBusinessDate,validDate};
