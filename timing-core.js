(function(global){
  "use strict";
  function report(job, events, now=Date.now()) {
    const rows=new Map();
    const row=number=>{
      if(!rows.has(number))rows.set(number,{chapterNumber:number,copied:job.copiedNumbers.includes(number),copyCount:0,
        settlingChecks:[],clipboardWrites:[],afterCopyWaits:[],navigation:[],fallbacks:[],securityWaits:[]});
      return rows.get(number);
    };
    for(const number of job.copiedNumbers)row(number);
    const openSecurity=new Map();
    for(const event of events){
      if(!Number.isFinite(event.chapterNumber))continue;
      const entry=row(event.chapterNumber),d=event.details||{};
      if(event.type==="body-ready")entry.loadingMs=d.loadingMs ?? null;
      if(event.type==="settled"||event.type==="settling-reset")entry.settlingChecks.push({configuredMs:d.configuredMs,actualMs:d.actualMs,reset:event.type==="settling-reset"});
      if(event.type==="copy-success"||event.type==="copy-failed"){
        entry.clipboardWrites.push({at:event.at,actualMs:d.actualMs,success:event.type==="copy-success"});
        if(event.type==="copy-success")entry.copyCount++;
      }
      if(event.type==="navigation-start")entry.afterCopyWaits.push({configuredMs:d.configuredWaitMs,actualMs:d.afterCopyMs});
      if(event.type==="navigation-ready")entry.navigation.push({kind:d.kind,actualMs:d.actualMs,toChapter:d.toChapter});
      if(event.type==="navigation-fallback")entry.fallbacks.push({configuredMs:d.configuredMs,actualMs:d.actualMs});
      if(event.type==="security-start")openSecurity.set(event.chapterNumber,event.at);
      if(event.type==="security-end"){
        entry.securityWaits.push({actualMs:d.actualMs,stillWaiting:false});openSecurity.delete(event.chapterNumber);
      }
    }
    for(const [number,at]of openSecurity)row(number).securityWaits.push({actualMs:Math.max(0,now-at),stillWaiting:true});
    const chapters=[...rows.values()].sort((a,b)=>a.chapterNumber-b.chapterNumber);
    function stats(values){
      values=values.filter(Number.isFinite).sort((a,b)=>a-b);
      if(!values.length)return {count:0};
      return {count:values.length,minMs:values[0],medianMs:(values[Math.floor((values.length-1)/2)]+values[Math.floor(values.length/2)])/2,p95Ms:values[Math.ceil(values.length*0.95)-1],maxMs:values.at(-1)};
    }
    return {schemaVersion:1,generatedAt:new Date(now).toISOString(),session:{id:job.sessionId,title:job.title,status:job.status,
      startedAt:job.startedAt,startChapter:job.startNumber,copiedNumbers:job.copiedNumbers},
      notes:["Wall-clock milliseconds; browser scheduling, storage and inspection overhead can add to configured waits.",
        "Navigation/loading can overlap security waiting; do not sum all columns as independent stages.",
        "A clipboard success does not confirm receipt by CopyAPP. These timings alone cannot prove a shorter setting is safe.",
        "No chapter prose, clipboard content or unrelated browsing history is included. Older runs may have no timing events."],
      summary:{settling:stats(chapters.flatMap(c=>c.settlingChecks.filter(s=>!s.reset).map(s=>s.actualMs))),
        clipboard:stats(chapters.flatMap(c=>c.clipboardWrites.filter(s=>s.success).map(s=>s.actualMs))),
        afterCopy:stats(chapters.flatMap(c=>c.afterCopyWaits.map(s=>s.actualMs))),
        navigation:stats(chapters.flatMap(c=>c.navigation.map(s=>s.actualMs))),
        fallback:stats(chapters.flatMap(c=>c.fallbacks.map(s=>s.actualMs)))},chapters,events};
  }
  global.ChapterTimings={report};
  if(typeof module!=="undefined"&&module.exports)module.exports=global.ChapterTimings;
})(globalThis);
