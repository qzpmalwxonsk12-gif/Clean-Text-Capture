(async()=>{
  const errors=[];
  try {
    // This fixture runs first in an isolated browser profile. Simulate the old
    // installed extension's v1 database and ensure its chapters survive v2.
    await new Promise((resolve,reject)=>{
      const request=indexedDB.open("clean-chapter-archive",1);
      request.onupgradeneeded=()=>{
        request.result.createObjectStore("jobs",{keyPath:"sessionId"});
        request.result.createObjectStore("chapters",{keyPath:["sessionId","chapterNumber"]}).createIndex("sessionId","sessionId");
      };
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result,tx=db.transaction(["jobs","chapters"],"readwrite");
        tx.objectStore("jobs").put({sessionId:"previous-version",title:"Preserved novel",startedAt:1});
        tx.objectStore("chapters").put({sessionId:"previous-version",chapterNumber:1,cleanText:"Preserve this chapter."});
        tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
      };
    });
    if((await ChapterArchive.chapters("previous-version"))[0]?.cleanText!=="Preserve this chapter.")throw Error("Upgrade lost chapter text.");
    await ChapterArchive.addTiming({sessionId:"new-version",chapterNumber:2,at:50,type:"copy-success",details:{actualMs:12}});
    if((await ChapterArchive.timings("new-version"))[0]?.details.actualMs!==12)throw Error("Timing write failed.");
    if((await ChapterArchive.timings("previous-version")).length)throw Error("Timing history crossed sessions.");
  }catch(error){errors.push(error.stack);}
  document.documentElement.dataset.testStatus=errors.length?"failed":"passed";
  const pre=document.createElement("pre");pre.id="test-results";pre.textContent=errors.join("\n")||"Archive migration and timing history passed.";document.body.append(pre);
  await fetch("/__fixture_done",{method:"POST",body:JSON.stringify({errors})});
})();
