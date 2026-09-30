function suggestPairings(skus){
 const kind=s=>/KFR-\d+(?:GW|LW)/i.test(s.name)?'inner':/外机|KFR-\d+W\//i.test(s.name)?'outer':'unknown';
 const family=s=>(s.name.match(/云佳\s*pro|云锦\s*pro|云锦[二2]代|云之海/i)||[''])[0].replace(/\s/g,'').toLowerCase();
 const capacity=s=>(s.name.match(/KFR-(\d+)/i)||[])[1];const result=[];
 for(const inner of skus.filter(s=>kind(s)==='inner'))for(const outer of skus.filter(s=>kind(s)==='outer')){
  const model=(inner.name.match(/KFR-[\w/-]+/i)||[])[0];
  if(model&&outer.name.includes(model)||family(inner)&&family(inner)===family(outer)&&capacity(inner)===capacity(outer))result.push({id:JSON.stringify([inner.id,outer.id]),innerSku:inner.id,outerSku:outer.id,status:'draft',name:inner.name,reason:model&&outer.name.includes(model)?'外机名称明确标注对应整机型号':'系列名称及匹数型号一致，请人工确认'});
 }return result;
}
module.exports={suggestPairings};
