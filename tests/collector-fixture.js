/* Real worker/content/archive code with an in-browser Chrome messaging adapter.
 * Clipboard and tab APIs are simulated; DOM clicks and IndexedDB are real. */
"use strict";
const fixture = (() => {
  const backgroundListeners=[], contentListeners=[], store={}, writes=[], clicks=[];
  const blobs=new Map(),downloads=[];
  const fast=new URLSearchParams(location.search).has("fast"),navigations=[];
  let registering="background", number=1, securitySeen=false, checks=0;
  const novel="https://wtr-lab.com/en/novel/7/fixture";
  const saveJob=ChapterArchive.saveJob;
  ChapterArchive.saveJob=async job=>{
    document.documentElement.dataset.archiveStep="saving";
    await saveJob(job);
    document.documentElement.dataset.archiveStep="saved";
  };
  const event=()=>({addListener(){}});
  function dispatch(listeners,message,sender) {
    return new Promise((resolve,reject)=>{
      let handled=false;
      for(const listener of listeners) {
        const result=listener(message,sender,response=>{handled=true;resolve(response);});
        if(result===true) handled=true;
      }
      if(!handled) reject(Error(`No response to ${message.type}`));
    });
  }
  globalThis.importScripts=()=>{};
  globalThis.chrome={
    runtime:{onInstalled:event(),getURL:path=>`chrome-extension://fixture/${path}`,getContexts:async()=>[{}],
      onMessage:{addListener(fn){(registering==="background"?backgroundListeners:contentListeners).push(fn);}},
      sendMessage:async message=>{
        if(message.target==="offscreen") {
          if(message.type==="create-chapter-export") {
            const chapters=await ChapterArchive.chapters(message.sessionId);
            const bytes=await ChapterPdf.create({title:message.title,chapters,copiedNumbers:message.copiedNumbers},async name=>new Uint8Array(await (await fetch(`/fonts/${name}`)).arrayBuffer()));
            const blob=new Blob([bytes],{type:"application/pdf"});
            const url=URL.createObjectURL(blob);blobs.set(url,blob);return {ok:true,url};
          }
          if(message.type==="release-chapter-export") {URL.revokeObjectURL(message.url);return {ok:true};}
          writes.push(message.text);return {ok:true};
        }
        return dispatch(backgroundListeners,message,{tab:{id:7},frameId:0,url:`${novel}/chapter-${number}`});
      }},
    downloads:{onChanged:event(),download:async options=>{
      const id=downloads.length+1;downloads.push({...options,id,bytes:await blobs.get(options.url).arrayBuffer(),state:"complete"});return id;
    },search:async({id})=>downloads.filter(d=>d.id===id)},
    storage:{session:{get:async key=>({[key]:structuredClone(store[key])}),set:async values=>Object.assign(store,structuredClone(values))},
      local:{get:async()=>({securityRetrySeconds:1,chapterDelaySeconds:1,...(fast?ChapterSettings.fastPreset:{})})},onChanged:event()},
    tabs:{get:async()=>({id:7,url:`${novel}/chapter-${number}`,active:false,autoDiscardable:true}),
      update:async(_id,values)=>{
        if(values.url){
          if(values.active)throw Error("Navigation stole focus.");
          const next=CleanChapterCapture.parseWtrChapterUrl(values.url);
          if(next?.novelKey!==novel||next.chapterNumber!==number+1)throw Error("Invalid fast destination.");
          navigations.push(values.url);advance();
        }
        return {windowId:1};
      },sendMessage:async(_id,message)=>dispatch(contentListeners,message,{}),onUpdated:event(),onRemoved:event()},
    action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{},setTitle:async()=>{}},
    alarms:{create:async()=>{},clear:async()=>{},onAlarm:event()},
    contextMenus:{onClicked:event(),removeAll:fn=>fn(),create(){}},windows:{update:async()=>{}}
  };
  const inspect=CleanReader.inspect;
  CleanReader.inspect=(doc,selector,expected)=>inspect(doc,selector,expected,`${novel}/chapter-${number}`);
  function prose() {
    document.querySelector(".chapter-body").innerHTML=`<p>Chapter ${number}: ${("This is complete chapter prose with meaningful words for collection. ").repeat(12)}</p><div class="advertisement">NEVER COPY THIS AD</div>`;
  }
  prose();
  function advance(){
    number+=1;
    document.querySelector(".chapter-container").id=`chapter-${number}`;
    document.querySelector(".chapter-status").textContent=`Ch. ${number} / 3`;
    document.getElementById("next").disabled=number===3;
    if(number===2){
      document.querySelector(".chapter-body").innerHTML="<h2>Security Check Required</h2><p>Please complete the security check.</p>";
      setTimeout(prose,4500);
    }else prose();
  }
  document.getElementById("next").onclick=()=>{clicks.push(number);advance();};
  function finish(errors) {
    document.documentElement.dataset.testStatus=errors.length?"failed":"passed";
    const output=document.createElement("pre");output.id="test-results";
    output.textContent=errors.length?errors.join("\n"):"All browser fixture checks passed.";document.body.append(output);
    if (location.protocol === "http:") void fetch("/__fixture_done", {method:"POST",body:JSON.stringify({errors})});
  }
  window.addEventListener("error", event => finish([event.message]));
  window.addEventListener("unhandledrejection", event => finish([String(event.reason)]));
  return {
    installContentChannel(){registering="content";},
    async run(){
      try {
        document.documentElement.dataset.fixtureStep="starting";
        await CleanBodyBackground.start(7);
        document.documentElement.dataset.fixtureStep="started";
        const poll=setInterval(async()=>{
          try{
            checks+=1;
            const job=await CleanBodyBackground.getJob();
            if(job.status==="security"){
              securitySeen=true;
              if(writes.length!==1||clicks.length+navigations.length!==1)throw Error("Security did not pause copying/navigation.");
            }
            if(job.status==="complete" && job.fileExport?.status==="saved"){
              clearInterval(poll);
              const chapters=await ChapterArchive.chapters(job.sessionId), errors=[];
              if(writes.length!==3||clicks.length+navigations.length!==2)errors.push("Incorrect copy or navigation count.");
              if(fast&&(clicks.length||navigations.length!==2))errors.push("Fast mode did not use direct verified URLs.");
              if(!securitySeen)errors.push("Security pause was not observed.");
              if(chapters.map(c=>c.chapterNumber).join(",")!=="1,2,3")errors.push("IndexedDB backup lost chapter order.");
              if(chapters.some(c=>c.cleanText.includes("NEVER COPY")||c.cleanText.includes("Security Check")))errors.push("Backup contains clutter or challenge text.");
              if(downloads.length!==1)errors.push("Automatic PDF was lost or duplicated.");
              const pdf=await PDFLib.PDFDocument.load(downloads[0].bytes);
              if(pdf.getPageCount()!==3||pdf.getTitle()!==job.title)errors.push("Automatic PDF pages or title are incorrect.");
              if(downloads[0]?.filename!==ChapterExport.filename(job.title))errors.push("PDF filename did not use the novel title.");
              finish(errors);
            }else if(job.status==="attention"||checks>65){clearInterval(poll);finish([`Collection did not finish: ${job.status}: ${job.reason}`]);}
          }catch(error){clearInterval(poll);finish([error.stack]);}
        },500);
      }catch(error){finish([error.stack]);}
    }
  };
})();
