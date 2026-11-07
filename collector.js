(function (global) {
  "use strict";
  if (global.top !== global || !global.chrome?.runtime) return;
  const reader = global.CleanReader;
  let job = null, timer = 0, observer = null, interval = 0, intervalMs = 0, lastNotice = "";
  let values = {...global.ChapterSettings.defaults}, config = global.ChapterSettings.runtime(values);
  const executedActions = new Set();
  const pageToken = crypto.randomUUID();
  async function message(value) {
    try { return await chrome.runtime.sendMessage(value); } catch (_error) { stop(); return null; }
  }
  function stop() {
    clearTimeout(timer); clearInterval(interval); timer = interval = intervalMs = 0;
    observer?.disconnect(); observer = null;
  }
  function wake(delay = config.wakeMs) {
    if (!job || !["loading", "stabilizing", "security", "advancing", "copying"].includes(job.status) || timer) return;
    timer = setTimeout(() => {
      timer = 0;
      void message({ type: "collector-wake", sessionId: job.sessionId });
    }, delay);
  }
  function refreshInterval() {
    if (!observer) return;
    const delay = job?.status === "security" ? config.retryMs : config.pollMs;
    if (interval && intervalMs === delay) return;
    clearInterval(interval);
    intervalMs = delay;
    interval = setInterval(() => wake(0), delay);
  }
  function sync(next) {
    const prior = job;
    job = next;
    const active = job && ["loading", "stabilizing", "security", "advancing", "copying"].includes(job.status);
    if (!active) stop();
    else if (!observer && document.documentElement) {
      observer = new MutationObserver(records => {
        if (records.some(r => !r.target.closest?.("#__clean_body_selector_toast__"))) wake(job.status === "security" ? config.retryMs : config.wakeMs);
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "disabled", "aria-busy", "aria-checked", "aria-selected", "aria-pressed"] });
      wake();
    }
    if (active) refreshInterval();
    if (job && `${job.status}:${job.reason}` !== lastNotice) {
      lastNotice = `${job.status}:${job.reason}`;
      if (["security", "paused", "attention", "complete", "stopped"].includes(job.status)) {
        global.CleanBodyContent.toast(job.reason, ["security", "attention"].includes(job.status));
      } else if (job.copiedNumbers.length > (prior?.copiedNumbers.length || 0)) {
        global.CleanBodyContent.toast(`Chapter ${job.copiedNumbers.at(-1)} copied and backed up. ${job.copiedNumbers.length} this session.`);
      } else if (!prior || prior.sessionId !== job.sessionId) {
        global.CleanBodyContent.toast("Background collection started. You can switch tabs now.");
      }
    }
  }
  function inspect(expectedNumber) {
    return { ...reader.inspect(document, global.CleanBodySelector, expectedNumber), pageToken };
  }
  chrome.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request.type === "collector-sync") { sync(request.job); respond({ok:true}); }
    if (request.type === "collector-inspect") respond(inspect(request.expectedNumber));
    if (request.type === "collector-click-next") {
      if (!job || job.sessionId !== request.sessionId || !["advancing", "loading", "stabilizing"].includes(job.status)) {
        respond({ok:false, reason:"Collection is no longer running."}); return;
      }
      const current = inspect(request.fromNumber);
      if (current.status !== "ready" || current.candidate.chapterKey !== request.fromKey || current.pageToken !== request.pageToken ||
        current.candidate.contentHash !== request.contentHash || current.mode !== request.mode) {
        respond({ok:false, reason:"Chapter changed before navigation."}); return;
      }
      if (executedActions.has(request.actionId)) { respond({ok:true, alreadyClicked:true}); return; }
      const next = reader.navigation(document, current.chapter);
      if (next.kind !== "button" || next.nextNumber !== request.nextNumber) {
        respond({ok:false, reason:"Next control changed."}); return;
      }
      executedActions.add(request.actionId);
      next.element.click();
      respond({ok:true});
    }
  });
  document.addEventListener("keydown", event => {
    if ((event.key !== "F6" && event.code !== "F6") || event.repeat || !job || ["complete","stopped"].includes(job.status)) return;
    event.preventDefault(); event.stopPropagation();
    void message({type:"collector-control", action:["paused", "attention"].includes(job.status) ? "resume" : "pause", sessionId:job.sessionId});
  }, true);
  chrome.storage.local.get(global.ChapterSettings.defaults).then(settings => {
    values = global.ChapterSettings.normalize(settings);
    config = global.ChapterSettings.runtime(values);
    refreshInterval();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !Object.keys(global.ChapterSettings.defaults).some(key => changes[key])) return;
    for (const key of Object.keys(global.ChapterSettings.defaults)) if (changes[key]) values[key] = changes[key].newValue;
    config = global.ChapterSettings.runtime(values);
    clearTimeout(timer); timer = 0;
    refreshInterval(); wake(0);
  });
  const restore = () => message({type:"collector-hello"}).then(reply => { if (reply?.job) sync(reply.job); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", restore, {once:true});
  else void restore();
})(globalThis);
