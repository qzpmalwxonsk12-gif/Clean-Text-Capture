importScripts("capture-core.js", "archive.js", "export-core.js", "settings-core.js");

(function (global) {
  "use strict";
  const KEY = "collectorJobV2", ALARM = "chapter-collector-recovery", DOWNLOADS = "chapterTxtDownloads";
  const core = global.CleanChapterCapture, archive = global.ChapterArchive;
  const RUNNING = new Set(["loading", "stabilizing", "copying", "advancing", "security"]);
  let queue = Promise.resolve(), pumping = null, epoch = 0, timer = 0, creatingOffscreen;
  const serial = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  };
  async function getJob() { return (await chrome.storage.session.get(KEY))[KEY] || null; }
  async function trace(job,type,details={},chapterNumber=job.expectedNumber) {
    try { await archive.addTiming({sessionId:job.sessionId,chapterNumber,at:Date.now(),type,details}); }
    catch(error) { job.timingWarning="Timing history could not be saved; chapter collection is unaffected."; console.warn(job.timingWarning,error.message); }
  }
  async function send(tabId, message) { return chrome.tabs.sendMessage(tabId, message, {frameId:0}); }
  async function sync(job) { try { await send(job.tabId, {type:"collector-sync", job}); } catch (_error) { /* navigation */ } }
  async function publish(job) {
    job.updatedAt = Date.now();
    await chrome.storage.session.set({[KEY]:job});
    await archive.saveJob(job);
    const badge = {security:"WAIT", paused:"II", attention:"ERR", complete:"DONE", stopped:""}[job.status] ?? String(job.copiedNumbers.length || "ON");
    await chrome.action.setBadgeText({text:badge});
    await chrome.action.setBadgeBackgroundColor({color:["security","attention"].includes(job.status) ? "#a33c24" : "#188038"});
    await chrome.action.setTitle({title:`${job.title}: ${job.reason}`});
    await sync(job);
    return job;
  }
  async function restoreDiscard(job) {
    try { await chrome.tabs.update(job.tabId, {autoDiscardable:job.originalAutoDiscardable !== false}); } catch (_error) { /* closed */ }
  }
  async function finish(job, status, reason) {
    if(job.securitySince) {await trace(job,"security-end",{actualMs:Date.now()-job.securitySince});job.securitySince=null;}
    await trace(job,`run-${status}`,{copiedCount:job.copiedNumbers.length});
    clearTimeout(timer);
    await chrome.alarms.clear(ALARM);
    await restoreDiscard(job);
    job = await publish({...job, status, reason, sample:null});
    if (["complete", "stopped"].includes(status) && job.copiedNumbers.length && !job.fileExport) {
      const filename = global.ChapterExport.filename(job.title);
      job = await publish({...job, fileExport:{status:"starting", filename}, reason:`${reason} Preparing PDF: ${filename}.`});
      try {
        const download = await downloadExport(job, true, reason);
        job = await publish({...job, fileExport:{status:"downloading", ...download}, reason:`${reason} Saving PDF: ${filename}.`});
        await settleDownload(download.id);
        job = await getJob();
      } catch (error) {
        job = await publish({...job, fileExport:{status:"failed", filename, error:error.message},
          reason:`${reason} PDF save failed: ${error.message}. Use Download PDF in the popup to retry; your backup is safe.`});
      }
    }
    return job;
  }
  function later(ms = 1500) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; void pump(); }, ms);
  }
  async function ensureOffscreen() {
    const contexts = await chrome.runtime.getContexts({contextTypes:["OFFSCREEN_DOCUMENT"], documentUrls:[chrome.runtime.getURL("offscreen.html")]});
    if (!contexts.length) {
      if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({url:"offscreen.html", reasons:["CLIPBOARD", "BLOBS"], justification:"Copy chapters for CopyAPP and create local PDF downloads from saved chapter backups."}).finally(() => { creatingOffscreen = null; });
      await creatingOffscreen;
    }
  }
  async function writeClipboardText(text) {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({target:"offscreen", type:"write-clean-chapter-to-clipboard", text});
    if (!response?.ok) throw new Error(response?.reason || "Clipboard write was not confirmed.");
  }
  async function releaseExport(url) {
    try { await chrome.runtime.sendMessage({target:"offscreen",type:"release-chapter-export",url}); } catch (_closed) { /* document already closed */ }
  }
  async function downloadExport(job, confirmedOnly, baseReason = "", format = "pdf") {
    if (!["pdf","txt","json"].includes(format)) throw new Error("Unsupported export format.");
    await ensureOffscreen();
    // The offscreen document reads IndexedDB itself: large novels do not have
    // to travel through Chrome's size-limited runtime message channel.
    const result = await chrome.runtime.sendMessage({target:"offscreen",type:"create-chapter-export",sessionId:job.sessionId,title:job.title,format,
      copiedNumbers:confirmedOnly ? job.copiedNumbers : null});
    if (!result?.ok || !result.url) throw new Error(result?.reason || "Could not prepare the PDF file.");
    const filename = global.ChapterExport.filename(format === "json" ? `${job.title} - timing log` : job.title,format);
    let id;
    try { id = await chrome.downloads.download({url:result.url,filename,saveAs:false,conflictAction:"uniquify"}); }
    catch (error) { await releaseExport(result.url); throw error; }
    const pending = (await chrome.storage.session.get(DOWNLOADS))[DOWNLOADS] || {};
    pending[id] = {url:result.url,sessionId:job.sessionId,automatic:confirmedOnly,filename,baseReason,format};
    await chrome.storage.session.set({[DOWNLOADS]:pending});
    return {id,filename};
  }
  async function settleDownload(id) {
    const pending = (await chrome.storage.session.get(DOWNLOADS))[DOWNLOADS] || {};
    const entry = pending[id];
    if (!entry) return;
    const [download] = await chrome.downloads.search({id:Number(id)});
    if (download?.state === "in_progress") return;
    await releaseExport(entry.url);
    delete pending[id];
    await chrome.storage.session.set({[DOWNLOADS]:pending});
    if (!entry.automatic) return;
    const current = await getJob();
    const job = current?.sessionId === entry.sessionId ? current : (await archive.list()).find(saved => saved.sessionId === entry.sessionId);
    if (!job || job.fileExport?.id !== Number(id)) return;
    const saved = download?.state === "complete";
    const filename = download?.filename?.split(/[\\/]/).pop() || entry.filename;
    job.fileExport = {...job.fileExport, status:saved ? "saved" : "failed", filename,
      error:saved ? null : (download?.error || "Download interrupted or removed")};
    job.reason = saved ? `${entry.baseReason} PDF saved: ${filename}.` :
      `${entry.baseReason} PDF save failed: ${job.fileExport.error}. Use Download PDF in the popup to retry; your backup is safe.`;
    if (current?.sessionId === job.sessionId) await publish(job);
    else await archive.saveJob(job);
  }
  async function settings() {
    return global.ChapterSettings.runtime(await chrome.storage.local.get(global.ChapterSettings.defaults));
  }
  async function waiting(job, snapshot, config) {
    const delay = snapshot.status === "security" ? config.retryMs : config.pollMs;
    if (snapshot.status === "security") {
      if (!job.securitySince) {job.securitySince=Date.now();await trace(job,"security-start");}
      job.sample = null;
      job.waitSince = Date.now(); // A challenge has no timeout and never consumes a chapter.
      await publish({...job, status:"security", retryAt:Date.now()+delay, reason:`Security check at chapter ${job.expectedNumber}. Nothing copied. Open collection tab if it needs your help.`});
    } else if (Date.now() - job.waitSince > 90000) {
      return finish(job, "attention", snapshot.reason || "Chapter did not finish loading. Check the collection tab, then Resume.");
    } else {
      await publish({...job, sample:null, status:job.pending ? "advancing" : "loading", reason:snapshot.reason || "Waiting for chapter text."});
    }
    later(delay);
  }
  async function tick() {
    let job = await getJob();
    if (!job || !RUNNING.has(job.status)) return job;
    const token = epoch, config = await settings();
    const inspectionStarted = Date.now();
    if (job.status === "copying") return finish(job,"attention","The previous clipboard result is uncertain. Text is backed up. Resume may copy that chapter again.");
    if (job.retryAt && Date.now() < job.retryAt) { later(job.retryAt - Date.now()); return job; }
    let tab, snapshot;
    try {
      tab = await chrome.tabs.get(job.tabId);
      const location = tab.url && core.parseWtrChapterUrl(tab.url);
      if (tab.url && (!location || location.novelKey !== job.novelKey)) return finish(job,"attention","The collection tab left this novel. Return to its chapter, then Resume.");
      if (tab.frozen || tab.discarded) return waiting(job, {reason:"Chrome suspended the collection tab. Open it briefly, then Resume if needed."}, config);
      snapshot = await send(job.tabId, {type:"collector-inspect", expectedNumber:job.expectedNumber});
    } catch (_error) {
      return waiting(job, {reason:"Waiting for the collection tab to load or reconnect."}, config);
    }
    if (epoch !== token) return job;
    if (!snapshot?.chapter || snapshot.chapter.novelKey !== job.novelKey) return waiting(job, snapshot || {}, config);
    if(job.securitySince && snapshot.status !== "security") {
      await trace(job,"security-end",{actualMs:Date.now()-job.securitySince});job.securitySince=null;
    }
    // Some reader buttons only scroll a preloaded chapter. In a hidden tab the
    // site's visibility observer may never update its active marker. Recover
    // once via WTR's chapter route, only after the verified Next was clicked.
    if (job.pending?.fallbackUrl && !job.pending.fallbackUsed && snapshot.status !== "security" &&
      tab.status !== "loading" && Date.now() - job.pending.at >= config.fallbackMs &&
      core.parseWtrChapterUrl(tab.url)?.chapterNumber === job.pending.fromNumber &&
      (snapshot.status !== "ready" || snapshot.next?.kind === "missing")) {
      const destination = core.parseWtrChapterUrl(job.pending.fallbackUrl);
      if (destination?.novelKey === job.novelKey && destination.chapterNumber === job.expectedNumber) {
        job.pending.fallbackUsed = true;
        job.pending.kind = "fallback-url";
        await trace(job,"navigation-fallback",{configuredMs:config.fallbackMs,actualMs:Date.now()-job.pending.at},job.pending.fromNumber);
        job.waitSince = Date.now();
        await publish({...job, reason:`Opening chapter ${job.expectedNumber} directly after a stalled reader transition.`});
        if (epoch !== token) return job;
        await chrome.tabs.update(job.tabId,{url:job.pending.fallbackUrl});
        later(config.pollMs); return job;
      }
    }
    if (snapshot.status !== "ready") return waiting(job, snapshot, config);
    const candidate = snapshot.candidate;
    if (candidate.chapterNumber !== job.expectedNumber || candidate.chapterKey !== `${job.novelKey}/chapter-${job.expectedNumber}` ||
      core.isSecurityCheckText(candidate.cleanText)) return waiting(job, {reason:"Waiting for the expected chapter."}, config);
    if (job.mode !== null && snapshot.mode !== job.mode) return finish(job,"attention","Translation mode changed. Restore the original translation, then Resume.");
    if (!snapshot.next || snapshot.next.kind === "missing") return waiting(job, {reason:snapshot.next?.reason || "Waiting for chapter navigation."}, config);
    if (snapshot.next.total < job.expectedNumber) return waiting(job, {reason:"Chapter counter is not ready."}, config);
    job.total = snapshot.next.total;
    const fingerprint = `${snapshot.pageToken}:${candidate.chapterKey}:${candidate.contentHash}:${snapshot.mode}:${JSON.stringify(snapshot.next)}`;
    if (job.sample?.fingerprint !== fingerprint) {
      if(job.sample) await trace(job,"settling-reset",{configuredMs:config.settleMs,actualMs:Date.now()-job.sample.since});
      else {
        await trace(job,"body-ready",{loadingMs:Date.now()-(job.pending?.at||job.loadStartedAt||job.waitSince),inspectionMs:Date.now()-inspectionStarted});
        if(job.pending && !job.pending.readyLogged) {
          await trace(job,"navigation-ready",{kind:job.pending.kind||"button",toChapter:job.expectedNumber,actualMs:Date.now()-job.pending.at},job.pending.fromNumber);
          job.pending.readyLogged=true;
        }
      }
      await trace(job,"settling-start",{configuredMs:config.settleMs});
      await publish({...job, sample:{fingerprint, since:Date.now()}, status:"stabilizing", reason:`Waiting for chapter ${job.expectedNumber} text to settle.`});
      later(config.settleMs); return job;
    }
    const settleRemaining = config.settleMs - (Date.now() - job.sample.since);
    if (settleRemaining > 0) { later(settleRemaining); return job; }
    if(!job.sample.settledAt) {
      job.sample.settledAt=Date.now();
      await trace(job,"settled",{configuredMs:config.settleMs,actualMs:job.sample.settledAt-job.sample.since});
    }
    // This is also the acknowledgement of a prior Next action; no second click is sent while waiting.
    job.pending = null;
    job.title = snapshot.title || job.title;
    if (job.copiedNumbers.includes(candidate.chapterNumber) && job.lastHash !== candidate.contentHash) {
      // A late text change after a copy must not silently advance with an incomplete chapter.
      await archive.saveChapter(job, candidate);
      return finish({...job, needsRecopy:candidate.chapterNumber},"attention","Chapter text changed after it was copied. The latest text is backed up. Resume will copy its corrected text again.");
    }
    if (!job.copiedNumbers.includes(candidate.chapterNumber)) {
      if (job.lastHash && job.lastHash === candidate.contentHash) return finish(job,"attention","The next chapter has the same text as the previous chapter. Check the page before resuming.");
      job.mode = snapshot.mode;
      await archive.saveChapter(job, candidate);
      if (epoch !== token) return job;
      const verify = await send(job.tabId, {type:"collector-inspect", expectedNumber:job.expectedNumber});
      if (epoch !== token) return job;
      if (verify?.status !== "ready" || verify.pageToken !== snapshot.pageToken || verify.candidate?.contentHash !== candidate.contentHash || verify.mode !== job.mode) {
        return waiting(job, verify || {}, config);
      }
      await publish({...job, status:"copying", reason:`Copying chapter ${job.expectedNumber}.`});
      if (epoch !== token) return job;
      await trace(job,"copy-start");
      const copyStarted=Date.now();
      try {
        await writeClipboardText(candidate.cleanText);
      } catch (error) {
        await trace(job,"copy-failed",{actualMs:Date.now()-copyStarted});
        job.copyFailures = (job.copyFailures || 0) + 1;
        if (job.copyFailures >= 3) return finish(job,"attention",`Clipboard failed three times: ${error.message}. Chapter text is backed up.`);
        await publish({...job, status:"loading", retryAt:Date.now()+config.retryMs, reason:`Clipboard failed; retrying chapter ${job.expectedNumber}.`});
        later(config.retryMs); return job;
      }
      const copiedAt=Date.now();
      await trace(job,"copy-success",{actualMs:copiedAt-copyStarted});
      job = {...job, copiedNumbers:[...job.copiedNumbers, candidate.chapterNumber], lastHash:candidate.contentHash,
        lastCopiedAt:copiedAt, copyFailures:0, retryAt:0, status:"loading", reason:`Chapter ${job.expectedNumber} copied and backed up.`};
      await publish(job);
      if (epoch !== token) return job; // A pause arriving during the write still records its successful result.
    }
    if (snapshot.next.kind === "end") return finish(job,"complete",`Finished: ${job.copiedNumbers.length} chapters copied (${job.startNumber}–${job.expectedNumber}).`);
    if (Date.now() - job.lastCopiedAt < config.delayMs) { later(config.delayMs - (Date.now()-job.lastCopiedAt)); return job; }
    // Verify again after the pacing delay, immediately before requesting navigation.
    const fresh = await send(job.tabId, {type:"collector-inspect", expectedNumber:job.expectedNumber});
    if (epoch !== token) return job;
    if (fresh?.status !== "ready" || fresh.candidate?.contentHash !== candidate.contentHash || fresh.mode !== job.mode ||
      fresh.next?.nextNumber !== job.expectedNumber + 1 || fresh.pageToken !== snapshot.pageToken) return waiting(job, fresh || {}, config);
    const next = fresh.next;
    const directUrl = next.kind === "link" ? next.url : config.fastMode && next.kind === "button" ? next.fallbackUrl : null;
    if (directUrl) {
      const destination = core.parseWtrChapterUrl(directUrl);
      if (!destination || destination.novelKey !== job.novelKey || destination.chapterNumber !== job.expectedNumber + 1) return finish(job,"attention","Next link points outside the expected chapter.");
    } else if (next.kind !== "button") return waiting(job, {reason:"Next is not ready."}, config);
    const fromNumber = job.expectedNumber;
    await trace(job,"navigation-start",{kind:directUrl ? "url" : "button",configuredWaitMs:config.delayMs,afterCopyMs:Date.now()-job.lastCopiedAt});
    const pending = {fromNumber, toNumber:next.nextNumber, actionId:crypto.randomUUID(), at:Date.now(),
      fallbackUrl:next.fallbackUrl || null, fallbackUsed:Boolean(directUrl),kind:directUrl ? "url" : "button"};
    job = {...job, pending, expectedNumber:next.nextNumber, sample:null, loadStartedAt:pending.at, waitSince:Date.now(), status:"advancing", reason:`Loading chapter ${next.nextNumber}.`};
    await publish(job); // Persist intent before navigation; recovery waits for destination and cannot double-click.
    if (epoch !== token) return job;
    if (directUrl) await chrome.tabs.update(job.tabId, {url:directUrl});
    else {
      let response;
      try {
        response = await send(job.tabId, {type:"collector-click-next", sessionId:job.sessionId, actionId:pending.actionId,
          fromNumber, fromKey:candidate.chapterKey, contentHash:candidate.contentHash, mode:job.mode,
          nextNumber:next.nextNumber, pageToken:fresh.pageToken});
      } catch (_navigationClosedChannel) {
        // A full navigation can destroy the message channel after a successful click.
        // Keep the saved intent and wait for the destination; never send another click.
      }
      if (response && !response.ok) {
        job = {...job, expectedNumber:fromNumber, pending:null, waitSince:Date.now()};
        return waiting(job, {reason:response.reason || "Chapter changed before Next; checking again."}, config);
      }
    }
    later(config.pollMs);
    return job;
  }
  function pump() {
    if (pumping) return pumping;
    pumping = serial(async () => {
      try { return await tick(); }
      catch (error) {
        const job = await getJob();
        if (job) {
          try { return await finish(job,"attention",`Collection paused: ${error.message}`); }
          catch (_archiveError) {
            await chrome.storage.session.set({[KEY]:{...job,status:"attention",reason:`Storage or collection error: ${error.message}`}});
            await chrome.action.setBadgeText({text:"ERR"});
          }
        }
      }
    }).finally(() => { pumping = null; });
    return pumping;
  }
  async function start(tabId) {
    epoch += 1;
    return serial(async () => {
      const previous = await getJob();
      if (previous && RUNNING.has(previous.status)) await finish(previous,"paused","Paused because a new collection was started.");
      const snapshot = await send(tabId,{type:"collector-inspect"});
      if (!snapshot?.chapter) throw new Error("Open a WTR chapter and refresh the tab after updating the extension.");
      const tab = await chrome.tabs.get(tabId);
      const job = {
        sessionId:crypto.randomUUID(), tabId, title:snapshot.title || snapshot.chapter.slug.replace(/-/g," "),
        novelKey:snapshot.chapter.novelKey, startNumber:snapshot.chapter.chapterNumber, expectedNumber:snapshot.chapter.chapterNumber,
        total:snapshot.next?.total || null, mode:snapshot.status === "ready" ? snapshot.mode : null,
        copiedNumbers:[], status:"loading", reason:"Starting background collection.", startedAt:Date.now(), loadStartedAt:Date.now(), waitSince:Date.now(),
        originalAutoDiscardable:tab.autoDiscardable, pending:null, sample:null
      };
      await chrome.tabs.update(tabId,{autoDiscardable:false});
      await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
      await trace(job,"run-start",{settings:global.ChapterSettings.normalize(await chrome.storage.local.get(global.ChapterSettings.defaults))});
      await publish(job); later(100); return job;
    });
  }
  async function control(action, sessionId) {
    epoch += 1;
    return serial(async () => {
      let job = await getJob();
      if (!job || (sessionId && sessionId !== job.sessionId)) throw new Error("This collection is no longer current.");
      if (["complete", "stopped"].includes(job.status)) return job;
      if (action === "pause") return finish(job,"paused","Collection paused. Resume from the toolbar popup or press F6 in the collection tab.");
      if (action === "stop") return finish(job,"stopped","Collection stopped. Its chapter backup is still available.");
      if (action !== "resume" || !["paused","attention"].includes(job.status)) return job;
      const snapshot = await send(job.tabId,{type:"collector-inspect"});
      if (!snapshot?.chapter || snapshot.chapter.novelKey !== job.novelKey) throw new Error("Return the collection tab to this novel before resuming.");
      // After an uncertain navigation, accept the source or destination only; never skip a chapter.
      if (job.pending && snapshot.chapter.chapterNumber === job.pending.fromNumber) job.expectedNumber = job.pending.fromNumber;
      else if (snapshot.chapter.chapterNumber !== job.expectedNumber) throw new Error(`Open chapter ${job.expectedNumber} before resuming.`);
      if (job.needsRecopy) {
        job.copiedNumbers = job.copiedNumbers.filter(number => number !== job.needsRecopy);
        job.lastHash = null;
        job.needsRecopy = null;
      }
      job = {...job,pending:null,sample:null,status:"loading",loadStartedAt:Date.now(),waitSince:Date.now(),copyFailures:0,retryAt:0,reason:"Resuming collection."};
      await trace(job,"run-resumed");
      await chrome.tabs.update(job.tabId,{autoDiscardable:false});
      await chrome.alarms.create(ALARM,{periodInMinutes:0.5});
      await publish(job); later(100); return job;
    });
  }
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({id:"select-clean-body-text",title:"Select clean text from this body",contexts:["all"]});
      for (const [id,title] of [["start-wtr-chapter-capture","Start background chapter collection"],["stop-wtr-chapter-capture","Stop chapter collection"]]) {
        chrome.contextMenus.create({id,title,contexts:["all"],documentUrlPatterns:["*://wtr-lab.com/*","*://*.wtr-lab.com/*"]});
      }
      chrome.contextMenus.create({id:"open-chapter-capture-settings",title:"Chapter copy settings…",contexts:["all"]});
    });
  });
  chrome.contextMenus.onClicked.addListener((info,tab) => {
    let task;
    if (info.menuItemId === "select-clean-body-text") task = chrome.tabs.sendMessage(tab.id,{type:info.menuItemId},{frameId:info.frameId || 0});
    if (info.menuItemId === "start-wtr-chapter-capture") task = start(tab.id);
    if (info.menuItemId === "stop-wtr-chapter-capture") task = control("stop");
    if (info.menuItemId === "open-chapter-capture-settings") task = chrome.runtime.openOptionsPage();
    task?.catch(error => { void chrome.action.setBadgeText({text:"ERR"}); void chrome.action.setTitle({title:error.message}); });
  });
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (!message?.type?.startsWith("collector-")) return;
    const extensionPage = !sender.tab && sender.url?.startsWith(chrome.runtime.getURL(""));
    const task = (async () => {
      const job = await getJob();
      const collectionTab = sender.tab?.id === job?.tabId && (sender.frameId || 0) === 0;
      if (message.type === "collector-hello") {
        if (collectionTab) { await sync(job); later(100); }
        return {job:collectionTab ? job : null};
      }
      if (message.type === "collector-wake") {
        if (collectionTab && message.sessionId === job.sessionId) void pump();
        return {ok:true};
      }
      if (message.type === "collector-control" && (extensionPage || collectionTab)) return {job:await control(message.action,message.sessionId)};
      if (!extensionPage) throw new Error("This action is only available from the extension popup.");
      if (message.type === "collector-export-heartbeat") return {ok:true};
      if (message.type === "collector-status") return {job, archives:await archive.list()};
      if (message.type === "collector-export") return serial(async () => {
        const saved = (await archive.list()).find(entry => entry.sessionId === message.sessionId);
        if (!saved) throw new Error("This chapter backup could not be found.");
        const download = await downloadExport(saved, false, "", message.format || "pdf");
        await settleDownload(download.id);
        return {download};
      });
      if (message.type === "collector-start") return {job:await start(message.tabId)};
      if (message.type === "collector-open" && job) {
        const tab = await chrome.tabs.update(job.tabId,{active:true});
        await chrome.windows.update(tab.windowId,{focused:true}); return {ok:true};
      }
      return {ok:false};
    })();
    task.then(value => respond({ok:true,...value})).catch(error => respond({ok:false,reason:error.message}));
    return true;
  });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) void pump(); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(global.ChapterSettings.defaults).some(key => changes[key])) return;
    void serial(async () => {
      const job = await getJob();
      if (!job || !RUNNING.has(job.status)) return;
      await trace(job,"settings-changed",{settings:global.ChapterSettings.normalize(await chrome.storage.local.get(global.ChapterSettings.defaults))});
      if (job.status === "security" && changes.securityRetrySeconds) {
        await publish({...job,retryAt:Date.now()+(await settings()).retryMs});
      }
      later(0); // Re-evaluate pending settling/pacing timers with the new values.
    }).catch(console.error);
  });
  chrome.downloads.onChanged.addListener(change => {
    if (change.state || change.error) void serial(() => settleDownload(change.id)).catch(console.error);
  });
  chrome.tabs.onUpdated.addListener((tabId,change) => {
    if (change.status === "complete" || change.url || change.frozen === false) {
      void getJob().then(job => { if (job?.tabId === tabId) void pump(); });
    }
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    void getJob().then(job => { if (job?.tabId === tabId) void control("stop"); });
  });
  // Also re-create a lost recovery alarm when the worker is reloaded.
  void serial(async () => {
    const pending = (await chrome.storage.session.get(DOWNLOADS))[DOWNLOADS] || {};
    for (const id of Object.keys(pending)) await settleDownload(Number(id));
    const job = await getJob();
    if (job?.fileExport?.status === "starting") await publish({...job,
      fileExport:{...job.fileExport,status:"failed"},reason:"PDF download was interrupted or unconfirmed. Use Download PDF in the popup; your backup is safe."});
    if (job && RUNNING.has(job.status)) { await chrome.alarms.create(ALARM,{periodInMinutes:0.5}); later(); }
  }).catch(console.error);
  global.CleanBodyBackground = {getJob,publish,start,control,pump,writeClipboardText};
})(globalThis);
