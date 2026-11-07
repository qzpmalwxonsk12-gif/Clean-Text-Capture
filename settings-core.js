(function (global) {
  "use strict";
  const defaults = Object.freeze({fastMode:false, textSettleSeconds:1.5, chapterDelaySeconds:3, nextFallbackSeconds:15, securityRetrySeconds:3});
  const limits = Object.freeze({textSettleSeconds:[0.1,60], chapterDelaySeconds:[0,60], nextFallbackSeconds:[0,60], securityRetrySeconds:[1,60]});
  const fastPreset = Object.freeze({fastMode:true, textSettleSeconds:0.5, chapterDelaySeconds:0, nextFallbackSeconds:2});
  const standardPreset = Object.freeze({fastMode:false, textSettleSeconds:1.5, chapterDelaySeconds:3, nextFallbackSeconds:15});
  function normalize(values = {}) {
    const settings = {fastMode:values.fastMode === true};
    for (const [key, [min,max]] of Object.entries(limits)) {
      const raw = values[key];
      const numeric = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
      settings[key] = Number.isFinite(numeric) ? Math.round(Math.max(min,Math.min(max,numeric))*10)/10 : defaults[key];
    }
    return settings;
  }
  function runtime(values) {
    const settings = normalize(values);
    return {...settings, settleMs:Math.round(settings.textSettleSeconds*1000), delayMs:Math.round(settings.chapterDelaySeconds*1000),
      fallbackMs:Math.round(settings.nextFallbackSeconds*1000), retryMs:Math.round(settings.securityRetrySeconds*1000),
      pollMs:settings.fastMode ? 250 : 1000, wakeMs:settings.fastMode ? 100 : 900};
  }
  global.ChapterSettings = {defaults, limits, fastPreset, standardPreset, normalize, runtime};
  if (typeof module !== "undefined" && module.exports) module.exports = global.ChapterSettings;
})(globalThis);
