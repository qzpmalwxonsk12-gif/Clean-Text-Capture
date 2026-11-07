(function (global) {
  "use strict";
  const core = global.CleanBodySelector;
  const capture = global.CleanChapterCapture;
  let target, selectionResult, toastTimer;
  function toast(text, error = false) {
    document.getElementById("__clean_body_selector_toast__")?.remove();
    const el = document.createElement("div");
    el.id = "__clean_body_selector_toast__";
    el.setAttribute("role", "status");
    el.textContent = text;
    el.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:2147483647;max-width:440px;padding:14px;border-radius:10px;color:white;background:${error ? "#9f2d2d" : "#202124"};font:14px/1.5 system-ui;pointer-events:none`;
    (document.body || document.documentElement).append(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 6000);
  }
  function clearActiveSelection() {
    if (selectionResult) core.clearExcludedMarkers(selectionResult.excludedElements);
    selectionResult = null;
  }
  function currentSelectionMatches() {
    const selection = global.getSelection();
    if (!selectionResult || selection?.rangeCount !== 1) return false;
    const actual = selection.getRangeAt(0), expected = selectionResult.range;
    return actual.startContainer === expected.startContainer && actual.startOffset === expected.startOffset &&
      actual.endContainer === expected.endContainer && actual.endOffset === expected.endOffset;
  }
  function performSelection(element) {
    clearActiveSelection();
    const result = core.selectCleanBody(element);
    if (!result.ok) { toast(result.reason, true); return result; }
    if (capture.isSecurityCheckText(result.cleanText)) {
      global.getSelection()?.removeAllRanges();
      core.clearExcludedMarkers(result.excludedElements);
      toast("Security check detected. Nothing was selected or copied.", true);
      return { ok: false, securityCheck: true };
    }
    selectionResult = result;
    toast("Clean text selected. Press Ctrl+C to copy.");
    return result;
  }
  document.addEventListener("contextmenu", event => {
    target = event.composedPath().find(e => e?.nodeType === 1);
  }, true);
  document.addEventListener("copy", event => {
    if (!currentSelectionMatches() || !event.clipboardData) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionResult.cleanText);
  }, true);
  document.addEventListener("selectionchange", () => {
    if (selectionResult && !currentSelectionMatches()) clearActiveSelection();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && selectionResult) {
      global.getSelection()?.removeAllRanges(); clearActiveSelection();
    }
  }, true);
  global.chrome?.runtime?.onMessage.addListener((message, _sender, respond) => {
    if (message.type === "select-clean-body-text") {
      const result = performSelection(target?.isConnected ? target : document.activeElement || document.body);
      respond({ ok: result.ok, reason: result.reason });
    }
  });
  global.CleanBodyContent = { performSelection, clearActiveSelection, currentSelectionMatches, toast };
})(globalThis);
