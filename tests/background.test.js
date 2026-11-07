"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const core = require("../capture-core.js");
const exportCore = require("../export-core.js");
const settingsCore = require("../settings-core.js");
const timingCore = require("../timing-core.js");
const event = () => ({listeners:[], addListener(fn) { this.listeners.push(fn); }});
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
function harness(overrides = {}) {
  let now = 100000, id = 0;
  const preferences = {securityRetrySeconds:3,chapterDelaySeconds:1,...overrides};
  const novelKey = "https://wtr-lab.com/en/novel/1/example";
  const data = {}, writes = [], clicks = [], backups = [], navigations = [], timers = new Map();
  const downloads = [], blobs = new Map(), released = [], savedJobs = new Map(),timings=[];
  let downloadFailure = false, downloadState = "complete";
  const archive = {
    addTiming:async event=>timings.push(clone(event)),timings:async sessionId=>timings.filter(event=>event.sessionId===sessionId),
    saveJob:async job=>savedJobs.set(job.sessionId,clone(job)), list:async()=>[...savedJobs.values()].map(clone),
    saveChapter:async(job,candidate)=>{if(archiveFailure)throw Error("Disk full");backups.push({...clone(candidate),sessionId:job.sessionId});},
    chapters:async sessionId=>[...new Map(backups.filter(c=>c.sessionId===sessionId).map(c=>[c.chapterNumber,c])).values()]
  };
  let snapshot, failures = 0, writeHook, archiveFailure = false, loseClickResponse = false, ignoreClicks = false;
  function chapter(number, total = 3) {
    const chapterKey = `${novelKey}/chapter-${number}`;
    const cleanText = `Chapter ${number} prose. `.repeat(40);
    const metadata = core.parseWtrChapterUrl(chapterKey);
    snapshot = {status:"ready",chapter:metadata,candidate:{...metadata,cleanText,contentHash:core.hashText(cleanText)},
      next:number === total ? {kind:"end",total} : {kind:"button",total,nextNumber:number+1},mode:"AI",pageToken:"page1",title:"Example"};
  }
  chapter(1);
  const chrome = {
    runtime:{onInstalled:event(),onMessage:event(),getURL:p=>`chrome-extension://test/${p}`,getContexts:async()=>[{}],
      sendMessage:async message => {
        if(message.type==="create-chapter-export") {
          const url=`blob:test/${blobs.size+1}`;
          const content=message.format==="json" ? JSON.stringify(timingCore.report(savedJobs.get(message.sessionId),await archive.timings(message.sessionId),now)) : exportCore.text(await archive.chapters(message.sessionId),message.copiedNumbers);
          blobs.set(url,content);return {ok:true,url};
        }
        if(message.type==="release-chapter-export") {released.push(message.url);return {ok:true};}
        if (writeHook) await writeHook(); if (failures-- > 0) return {ok:false,reason:"test rejection"}; writes.push(message.text); return {ok:true}; }},
    downloads:{onChanged:event(),download:async options=>{
      if(downloadFailure)throw Error("Download refused");
      const id=downloads.length+1;downloads.push({...options,id,text:blobs.get(options.url),state:downloadState});return id;
    },search:async({id})=>downloads.filter(d=>d.id===id)},
    storage:{session:{get:async key=>({[key]:clone(data[key])}),set:async values=>Object.assign(data,clone(values))},local:{get:async()=>clone(preferences)},onChanged:event()},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    tabs:{get:async()=>({id:7,url:snapshot.chapter?.href || `${novelKey}/chapter-1`,autoDiscardable:true}),update:async(_id,values)=>{if(values.url)navigations.push(values.url);return {windowId:1};},onUpdated:event(),onRemoved:event(),
      sendMessage:async (_tab,message)=> {
        if (message.type === "collector-inspect") return clone(snapshot);
        if (message.type === "collector-click-next") {
          clicks.push(message); if (!ignoreClicks) chapter(message.nextNumber);
          if (loseClickResponse) throw Error("Message port closed after navigation");
        }
        return {ok:true};
      }},
    windows:{update:async()=>{}},contextMenus:{removeAll:fn=>fn(),create:()=>{},onClicked:event()},
    alarms:{create:async()=>{},clear:async()=>{},onAlarm:event()},offscreen:{createDocument:async()=>{}}
  };
  const context = vm.createContext({chrome,CleanChapterCapture:core,ChapterArchive:archive,ChapterExport:exportCore,ChapterSettings:settingsCore,
    importScripts:()=>{},crypto:{randomUUID:()=>`id-${++id}`},Date:class extends Date { static now(){return now;} },
    setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:key=>timers.delete(key),console});
  vm.runInContext(fs.readFileSync(require.resolve("../background.js"),"utf8"),context);
  return {api:context.CleanBodyBackground,data,writes,clicks,backups,navigations,chapter,downloads,released,savedJobs,timings,
    get nextDelay(){return [...timers.values()].at(-1)?.ms;},
    get snapshot(){return snapshot;},set snapshot(value){snapshot=value;},
    failCopies(count){failures=count;},setWriteHook(fn){writeHook=fn;},failArchive(){archiveFailure=true;},
    loseNavigationResponse(){loseClickResponse=true;},ignoreNavigation(){ignoreClicks=true;},
    failDownload(){downloadFailure=true;},delayDownload(){downloadState="in_progress";},
    async downloadChanged(state,error){downloads[0].state=state;downloads[0].error=error;
      chrome.downloads.onChanged.listeners.forEach(fn=>fn({id:1,state:{current:state}}));await context.CleanBodyBackground.pump();},
    async closeTab(){chrome.tabs.onRemoved.listeners.forEach(fn=>fn(7));await Promise.resolve();await context.CleanBodyBackground.pump();},
    async message(message){return new Promise(resolve=>chrome.runtime.onMessage.listeners[0](message,{url:chrome.runtime.getURL("popup.html")},resolve));},
    async changeSettings(values){
      const changes=Object.fromEntries(Object.entries(values).map(([key,newValue])=>[key,{oldValue:preferences[key],newValue}]));
      Object.assign(preferences,values);chrome.storage.onChanged.listeners.forEach(fn=>fn(changes,"local"));
      await context.CleanBodyBackground.pump();
    },
    async step(ms=1600){now+=ms;await context.CleanBodyBackground.pump();},
    async start(){await context.CleanBodyBackground.start(7);},
    async ready(){await this.step();await this.step();}
  };
}
test("background job copies, backs up and advances in order to confirmed completion",async()=>{
  const h=harness();await h.start();
  await h.ready(); assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);
  await h.step();assert.equal(h.clicks.length,1);
  await h.ready();await h.step();await h.ready();
  const job=await h.api.getJob();
  assert.equal(job.status,"complete");assert.deepEqual([...job.copiedNumbers],[1,2,3]);
  assert.equal(h.writes.length,3);assert.equal(h.clicks.length,2);assert.equal(h.backups.length,3);
  assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].filename,"Example.pdf");
  assert.equal(h.downloads[0].text,h.writes.join("\n\n")+"\n");assert.equal(job.fileExport.status,"saved");
});
test("security on the same chapter never writes or advances; real prose recovers",async()=>{
  const h=harness();await h.start();const ready=h.snapshot;
  h.snapshot={status:"security",chapter:ready.chapter};await h.step();await h.step();
  assert.equal((await h.api.getJob()).status,"security");assert.equal(h.writes.length,0);assert.equal(h.clicks.length,0);
  assert.equal(h.downloads.length,0);
  h.snapshot=ready;await h.ready();assert.equal(h.writes.length,1);
});
test("failed clipboard is retried without skipping or consuming its chapter",async()=>{
  const h=harness();await h.start();h.failCopies(1);await h.ready();
  assert.equal(h.writes.length,0);assert.equal((await h.api.getJob()).copiedNumbers.length,0);
  await h.step(3100);assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);
  await h.step();assert.equal(h.clicks.length,1);
});
test("three clipboard failures pause with a recoverable backup",async()=>{
  const h=harness();await h.start();h.failCopies(3);await h.ready();await h.step(3100);await h.step(3100);
  assert.equal((await h.api.getJob()).status,"attention");assert.equal(h.writes.length,0);assert.equal(h.clicks.length,0);assert.ok(h.backups.length);
});
test("pause during a clipboard write records success but cannot navigate",async()=>{
  const h=harness();await h.start();let pause;
  h.setWriteHook(()=>{pause=h.api.control("pause");});await h.ready();await pause;
  assert.equal((await h.api.getJob()).status,"paused");assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);
  assert.equal(h.downloads.length,0);
  h.setWriteHook(null);await h.api.control("resume");await h.ready();
  assert.equal(h.writes.length,1);assert.equal(h.clicks.length,1);
});
test("reload requires text to settle again and restores progression without duplicate copy",async()=>{
  const h=harness();await h.start();await h.ready();h.snapshot.pageToken="new-document";
  await h.step();assert.equal(h.clicks.length,0);await h.step();
  assert.equal(h.writes.length,1);assert.equal(h.clicks.length,1);
});
test("archive failure, mode change and missing Next stop progression",async()=>{
  const a=harness();await a.start();a.failArchive();await a.ready();assert.equal(a.writes.length,0);assert.equal((await a.api.getJob()).status,"attention");
  const b=harness();await b.start();b.snapshot.mode="Web";await b.step();assert.equal((await b.api.getJob()).status,"attention");
  const c=harness();await c.start();c.snapshot.next={kind:"missing",reason:"Next missing"};await c.ready();
  assert.equal(c.writes.length,0);await c.step(91000);assert.equal((await c.api.getJob()).status,"attention");
});
test("uncertain write after worker restart is reported rather than automatically duplicated",async()=>{
  const h=harness();await h.start();h.data.collectorJobV2.status="copying";await h.step();
  assert.equal((await h.api.getJob()).status,"attention");assert.equal(h.writes.length,0);
});

test("a full-page navigation with a lost response waits for the destination without another click",async()=>{
  const h=harness();await h.start();h.loseNavigationResponse();await h.ready();await h.step();
  await h.ready();assert.equal(h.writes.length,2);assert.equal(h.clicks.length,1);
});
test("a click with no chapter transition times out instead of being repeated",async()=>{
  const h=harness();await h.start();h.ignoreNavigation();await h.ready();await h.step();
  await h.step(91000);assert.equal(h.clicks.length,1);assert.equal(h.writes.length,1);
  assert.equal((await h.api.getJob()).status,"attention");
});
test("late-arriving text is backed up and pauses; Resume explicitly recopies the corrected chapter",async()=>{
  const h=harness();await h.start();await h.ready();
  h.snapshot.candidate.cleanText += " A late final paragraph.";
  h.snapshot.candidate.contentHash = core.hashText(h.snapshot.candidate.cleanText);
  await h.ready();assert.equal((await h.api.getJob()).status,"attention");assert.equal(h.clicks.length,0);
  await h.api.control("resume");await h.ready();assert.equal(h.writes.length,2);
  assert.match(h.writes[1],/late final paragraph/);
});
test("a stalled hidden-tab button transition gets only one validated direct-route fallback",async()=>{
  const h=harness();h.snapshot.next.fallbackUrl="https://wtr-lab.com/en/novel/1/example/chapter-2?service=web";
  await h.start();h.ignoreNavigation();await h.ready();await h.step();
  h.snapshot.status="loading";await h.step(16000);await h.step(16000);
  assert.deepEqual(h.navigations,["https://wtr-lab.com/en/novel/1/example/chapter-2?service=web"]);
  assert.equal(h.clicks.length,1);assert.equal(h.writes.length,1);
});
test("Stop exports confirmed chapters only, once, and never overwrites existing files",async()=>{
  const h=harness();await h.start();await h.ready();await h.step();
  h.failCopies(1);await h.ready(); // Chapter 2 is backed up but was not copied.
  const job=await h.api.control("stop");
  assert.equal(job.status,"stopped");assert.equal(h.downloads.length,1);
  assert.equal(h.downloads[0].text,h.writes[0]+"\n");
  assert.equal(h.downloads[0].saveAs,false);assert.equal(h.downloads[0].conflictAction,"uniquify");
  await h.api.control("stop");await h.api.control("pause");await h.closeTab();
  assert.equal(h.downloads.length,1);assert.equal((await h.api.getJob()).status,"stopped");
});
test("Stop before any successful copy does not create an empty PDF",async()=>{
  const h=harness();await h.start();await h.api.control("stop");assert.equal(h.downloads.length,0);
});
test("Stop during clipboard write includes its confirmed text without navigating",async()=>{
  const h=harness();await h.start();let stop;
  h.setWriteHook(()=>{stop=h.api.control("stop");});await h.ready();await stop;
  assert.equal(h.downloads[0].text,h.writes[0]+"\n");assert.equal(h.clicks.length,0);
});
test("completion exports once even if Stop or tab-close arrives afterwards",async()=>{
  const h=harness();h.chapter(1,1);await h.start();await h.ready();
  await h.api.control("stop");await h.closeTab();
  assert.equal((await h.api.getJob()).status,"complete");assert.equal(h.downloads.length,1);
});
test("download rejection preserves stopped state and archive, reports recovery and frees Blob",async()=>{
  const h=harness();await h.start();await h.ready();h.failDownload();
  const job=await h.api.control("stop");
  assert.equal(job.status,"stopped");assert.equal(job.fileExport.status,"failed");
  assert.match(job.reason,/Download PDF/);assert.equal(h.backups.length,1);assert.equal(h.released.length,1);
});
test("a PDF is not reported as saved until Chrome confirms completion",async()=>{
  const h=harness();h.delayDownload();await h.start();await h.ready();await h.api.control("stop");
  assert.equal((await h.api.getJob()).fileExport.status,"downloading");assert.equal(h.released.length,0);
  await h.downloadChanged("complete");
  assert.equal((await h.api.getJob()).fileExport.status,"saved");assert.equal(h.released.length,1);
});
test("an interrupted PDF download reports failure without restarting copying",async()=>{
  const h=harness();h.delayDownload();await h.start();await h.ready();await h.api.control("stop");
  await h.downloadChanged("interrupted","FILE_NO_SPACE");const job=await h.api.getJob();
  assert.equal(job.status,"stopped");assert.equal(job.fileExport.status,"failed");assert.match(job.reason,/FILE_NO_SPACE/);
  assert.equal(h.writes.length,1);assert.equal(h.released.length,1);
});
test("manual backup export uses the same title filename and can include unconfirmed backup text",async()=>{
  const h=harness();h.snapshot.title="A Novel: Part/One?";await h.start();h.failCopies(1);await h.ready();
  const job=await h.api.getJob();const response=await h.message({type:"collector-export",sessionId:job.sessionId});
  assert.equal(response.ok,true);assert.equal(h.downloads[0].filename,"A Novel Part One.pdf");
  assert.equal(h.downloads[0].text,h.backups[0].cleanText+"\n");assert.equal(h.writes.length,0);
});
test("custom fractional settling and post-copy delays are honoured exactly",async()=>{
  const h=harness({textSettleSeconds:2.7,chapterDelaySeconds:0.3});await h.start();await h.step(0);
  assert.equal(h.nextDelay,2700);await h.step(2000);assert.equal(h.nextDelay,700);assert.equal(h.writes.length,0);
  await h.step(699);assert.equal(h.writes.length,0);await h.step(1);
  assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);assert.equal(h.nextDelay,300);
  await h.step(299);assert.equal(h.clicks.length,0);await h.step(1);assert.equal(h.clicks.length,1);
});
test("zero post-copy delay advances in the same tick only after the write succeeds",async()=>{
  const h=harness({textSettleSeconds:0.1,chapterDelaySeconds:0});await h.start();h.failCopies(1);
  await h.step(0);await h.step(100);assert.equal(h.writes.length,0);assert.equal(h.clicks.length,0);
  await h.step(3000);assert.equal(h.writes.length,1);assert.equal(h.clicks.length,1);
});
test("new text resets the entire configured settling window",async()=>{
  const h=harness({textSettleSeconds:0.5});await h.start();await h.step(0);await h.step(400);
  h.snapshot.candidate.cleanText+=" New paragraph.";h.snapshot.candidate.contentHash=core.hashText(h.snapshot.candidate.cleanText);
  await h.step(0);await h.step(499);assert.equal(h.writes.length,0);
  await h.step(1);assert.equal(h.writes.length,1);
});
test("Fast mode opens the verified next URL without a button click or repeated navigation",async()=>{
  const h=harness(settingsCore.fastPreset);
  const destination="https://wtr-lab.com/en/novel/1/example/chapter-2?service=webplus";
  h.snapshot.mode="Web+";h.snapshot.next.fallbackUrl=destination;await h.start();await h.step(0);await h.step(500);
  assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);assert.deepEqual(h.navigations,[destination]);
  assert.equal((await h.api.getJob()).pending.fallbackUsed,true);assert.equal(h.nextDelay,250);
  h.snapshot.status="loading";await h.step(5000);assert.equal(h.navigations.length,1);
});
test("Fast mode rejects cross-novel or skipped-chapter routes",async()=>{
  for(const destination of ["https://example.com/chapter-2","https://wtr-lab.com/en/novel/2/other/chapter-2","https://wtr-lab.com/en/novel/1/example/chapter-3"]){
    const h=harness(settingsCore.fastPreset);h.snapshot.next.fallbackUrl=destination;await h.start();await h.ready();
    assert.equal(h.navigations.length,0);assert.equal(h.clicks.length,0);assert.equal((await h.api.getJob()).status,"attention");
  }
});
test("configured Next fallback waits its deadline, runs once, and stops for security",async()=>{
  const h=harness({nextFallbackSeconds:0.6,chapterDelaySeconds:0});
  h.snapshot.next.fallbackUrl="https://wtr-lab.com/en/novel/1/example/chapter-2";
  await h.start();h.ignoreNavigation();await h.ready();h.snapshot.status="loading";
  await h.step(599);assert.equal(h.navigations.length,0);await h.step(1);assert.equal(h.navigations.length,1);
  await h.step(1000);assert.equal(h.navigations.length,1);
  const a=harness({nextFallbackSeconds:0,chapterDelaySeconds:0});
  a.snapshot.next.fallbackUrl="https://wtr-lab.com/en/novel/1/example/chapter-2";
  await a.start();a.ignoreNavigation();await a.ready();a.snapshot.status="security";await a.step(10000);
  assert.equal(a.navigations.length,0);assert.equal((await a.api.getJob()).status,"security");assert.equal(a.writes.length,1);
});
test("Fast mode respects security before copying and just before navigation",async()=>{
  const h=harness(settingsCore.fastPreset);await h.start();h.snapshot.status="security";await h.step();
  assert.equal(h.nextDelay,3000);assert.equal(h.writes.length,0);assert.equal(h.navigations.length,0);
  const b=harness(settingsCore.fastPreset);b.snapshot.next.fallbackUrl="https://wtr-lab.com/en/novel/1/example/chapter-2";
  await b.start();b.setWriteHook(()=>{b.snapshot.status="security";});await b.ready();
  assert.equal(b.writes.length,1);assert.equal(b.navigations.length,0);assert.equal((await b.api.getJob()).status,"security");
});
test("normal loading checks do not wait for the security retry interval",async()=>{
  for(const [fastMode,delay] of [[false,1000],[true,250]]){
    const h=harness({fastMode,securityRetrySeconds:60});await h.start();h.snapshot.status="loading";await h.step();
    assert.equal(h.nextDelay,delay);
  }
});
test("saved timing changes affect an in-progress settling or post-copy wait",async()=>{
  const h=harness({textSettleSeconds:10,chapterDelaySeconds:15});await h.start();await h.step(0);await h.step(1000);
  await h.changeSettings({textSettleSeconds:0.5});assert.equal(h.writes.length,1);assert.equal(h.clicks.length,0);
  await h.changeSettings({chapterDelaySeconds:0});assert.equal(h.clicks.length,1);
});
test("timing history records actual and configured chapter waits without the chapter text",async()=>{
  const h=harness({textSettleSeconds:0.5,chapterDelaySeconds:0.3});await h.start();await h.step(0);await h.step(700);await h.step(400);
  await h.step(200);await h.step(500);await h.api.control("stop");
  const job=await h.api.getJob();const response=await h.message({type:"collector-export",sessionId:job.sessionId,format:"json"});
  assert.equal(response.ok,true);assert.equal(h.downloads.at(-1).filename,"Example - timing log.json");
  const report=JSON.parse(h.downloads.at(-1).text),first=report.chapters[0];
  assert.deepEqual(first.settlingChecks[0],{configuredMs:500,actualMs:700,reset:false});
  assert.deepEqual(first.afterCopyWaits[0],{configuredMs:300,actualMs:400});
  assert.equal(first.navigation[0].actualMs,200);assert.equal(first.copyCount,1);
  assert.deepEqual(report.session.copiedNumbers,[1,2]);assert.ok(!JSON.stringify(report).includes("prose".repeat(2)));
  for(const text of h.writes)assert.ok(!JSON.stringify(report).includes(text));
  assert.ok(report.events.some(event=>event.type==="run-start"&&event.details.settings.textSettleSeconds===0.5));
});
test("security diagnostics stop counting when the user stops the run",async()=>{
  const h=harness();await h.start();h.snapshot.status="security";await h.step(0);await h.step(2000);await h.api.control("stop");
  const report=timingCore.report(await h.api.getJob(),h.timings,999999);
  assert.deepEqual(report.chapters[0].securityWaits,[{actualMs:2000,stillWaiting:false}]);
});
