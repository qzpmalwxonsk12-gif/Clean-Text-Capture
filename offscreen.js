(function () {
  "use strict";

  const clipboardBuffer = document.getElementById("clipboard-buffer");
  const exportUrls = new Set();

  function copyText(text) {
    if (!clipboardBuffer) {
      throw new Error("The offscreen clipboard buffer is unavailable.");
    }

    clipboardBuffer.value = String(text || "");
    clipboardBuffer.select();
    clipboardBuffer.setSelectionRange(0, clipboardBuffer.value.length);

    try {
      if (!document.execCommand("copy")) {
        throw new Error("Chrome rejected the offscreen clipboard copy command.");
      }
    } finally {
      clipboardBuffer.value = "";
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.target !== "offscreen") return undefined;
    if (message.type === "create-chapter-export") {
      const heartbeat = setInterval(() => {void chrome.runtime.sendMessage({type:"collector-export-heartbeat"}).catch(()=>{});},10000);
      (async () => {
        if (!["pdf","txt","json"].includes(message.format)) throw new Error("Unsupported export format.");
        let data;
        if(message.format === "json") {
          const job = (await ChapterArchive.list()).find(saved => saved.sessionId === message.sessionId);
          if(!job)throw new Error("This collection's timing history could not be found.");
          data = JSON.stringify(ChapterTimings.report(job,await ChapterArchive.timings(message.sessionId)),null,2);
        } else {
          const chapters = await ChapterArchive.chapters(message.sessionId);
          data = message.format === "pdf" ? await ChapterPdf.create({title:message.title,chapters,copiedNumbers:message.copiedNumbers}) :
            ChapterExport.text(chapters, message.copiedNumbers);
        }
        const mime = {pdf:"application/pdf",txt:"text/plain;charset=utf-8",json:"application/json;charset=utf-8"}[message.format];
        const url = URL.createObjectURL(new Blob([data], {type:mime}));
        exportUrls.add(url);
        sendResponse({ok:true,url});
      })().catch(error => sendResponse({ok:false,reason:error.message})).finally(()=>clearInterval(heartbeat));
      return true;
    }
    if (message.type === "release-chapter-export" || message.type === "release-chapter-txt") {
      if (exportUrls.delete(message.url)) URL.revokeObjectURL(message.url);
      sendResponse({ok:true});
      return undefined;
    }
    if (message.type !== "write-clean-chapter-to-clipboard") return undefined;

    try {
      copyText(message.text);
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
    return undefined;
  });
})();
