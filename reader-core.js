(function (global) {
  "use strict";
  const core = global.CleanChapterCapture;
  const normalize = value => String(value || "").replace(/\s+/g, " ").trim();
  function visible(element) {
    if (!element) return false;
    for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
      if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
    }
    return true; // Off-viewport content is still usable in an inactive tab.
  }
  function navigation(document, chapter) {
    const rows = [...document.querySelectorAll(".chapter-status")].filter(visible).map(status => {
      // WTR places its percentage in a sibling <small>. textContent joins
      // "166" and "0.6%" into "1660.6%", which would invent a 1660-chapter novel.
      const counter = status.querySelector("small:not(.percent)") || status;
      const match = normalize(counter.textContent).match(/Ch(?:apter)?\.?\s*(\d+)\s*\/\s*(\d+)/i);
      if (!match || Number(match[1]) !== chapter.chapterNumber) return null;
      const row = status.parentElement;
      const element = [...row.querySelectorAll('button, a, [role="button"]')].find(e =>
        /^(next|next chapter)\s*[›»→]?$/i.test(normalize(e.getAttribute("aria-label") || e.textContent)) && visible(e));
      return { element, total: Number(match[2]) };
    }).filter(Boolean);
    if (!rows.length) return { kind: "missing", reason: "Waiting for chapter navigation." };
    const totals = new Set(rows.map(r => r.total));
    if (totals.size !== 1) return { kind: "missing", reason: "Chapter counters disagree." };
    const total = rows[0].total;
    const enabled = rows.filter(({element}) => element && !element.disabled &&
      element.getAttribute("aria-disabled") !== "true" && !element.hasAttribute("data-disabled"));
    if (chapter.chapterNumber === total && !enabled.length) return { kind: "end", total };
    if (chapter.chapterNumber >= total || !enabled.length) return { kind: "missing", total, reason: "Next is not ready yet." };
    const choices = enabled.map(({element}) => {
      const raw = element.getAttribute("href");
      if (!raw) {
        const destination = new URL(`${chapter.novelKey}/chapter-${chapter.chapterNumber + 1}`);
        const service = mode(document, null);
        if (service === "Web") destination.searchParams.set("service", "web");
        if (service === "Web+") destination.searchParams.set("service", "webplus");
        return { kind: "button", total, nextNumber: chapter.chapterNumber + 1, fallbackUrl:destination.href, element };
      }
      const url = new URL(raw, chapter.href).href;
      const next = core.parseWtrChapterUrl(url);
      if (!next || next.novelKey !== chapter.novelKey || next.chapterNumber !== chapter.chapterNumber + 1) return null;
      return { kind: "link", total, nextNumber: next.chapterNumber, url, element };
    });
    if (choices.some(c => !c)) return { kind: "missing", total, reason: "Next destination does not match this novel's next chapter." };
    return choices[0];
  }
  function mode(document, root) {
    const selected = [...document.querySelectorAll('[aria-pressed="true"], [aria-checked="true"], [aria-selected="true"], [data-state="on"], input:checked')]
      .filter(visible).map(e => normalize(e.getAttribute("aria-label") || e.textContent || e.parentElement.textContent))
      .filter(s => /^(Web\+?|AI)$/i.test(s));
    const container = root && root.closest(".chapter-container");
    const model = container && [...container.querySelectorAll('button, [role="button"]')]
      .filter(e => !e.closest(".chapter-body"))
      .map(e => normalize(e.textContent)).find(s => /gemini|gpt-|claude|deepseek/i.test(s));
    return [...new Set(selected)].sort().join("|") || (model ? `model:${model}` : "");
  }
  function inspect(document, selector, expectedNumber, hrefOverride) {
    const metadata = core.parseWtrChapterUrl(hrefOverride || document.location.href);
    if (!metadata) return { status: "wrong-page", reason: "The collection tab is no longer on a WTR chapter." };
    let root = expectedNumber
      ? document.getElementById(`chapter-${expectedNumber}`)?.querySelector(".chapter-body")
      : core.findWtrChapterBody(document, null, metadata);
    if (root && !visible(root)) root = null;
    // The requested root can appear before the URL changes in WTR's SPA reader.
    const chapterNumber = root ? core.chapterNumberFromBody(root) : metadata.chapterNumber;
    const chapter = { ...metadata, chapterNumber, chapterKey: `${metadata.novelKey}/chapter-${chapterNumber}`, href: `${metadata.novelKey}/chapter-${chapterNumber}` };
    const container = root?.closest(".chapter-container");
    const challengeScopes = [container, document.querySelector('.chapter-tracker.active .chapter-container'),
      ...document.querySelectorAll('[role="dialog"], [role="alert"], .cf-challenge, #challenge-running')].filter(e => e && visible(e));
    if (challengeScopes.some(e => core.isSecurityCheckText(e.innerText || e.textContent)) ||
      (!root && core.isSecurityCheckText(document.body?.innerText || ""))) {
      return { status: "security", chapter, reason: "Security check detected. Nothing copied; waiting for you to clear it." };
    }
    if (!root || (expectedNumber && chapterNumber !== expectedNumber)) return { status: "loading", chapter, reason: "Waiting for the expected chapter." };
    if (container.querySelector('[aria-busy="true"], [role="progressbar"], [data-loading="true"]') ||
      /^(loading|translating|generating)(?:\s|\.|…)/i.test(normalize(root.textContent))) {
      return { status: "loading", chapter, reason: "Chapter text is still loading." };
    }
    const cleanText = selector.extractCleanText(root);
    if (core.isSecurityCheckText(cleanText)) return { status: "security", chapter, reason: "Security check detected. Nothing copied." };
    if (cleanText.length < core.MIN_CHAPTER_CHARACTERS) return { status: "loading", chapter, reason: "Waiting for readable chapter text." };
    const nav = navigation(document, chapter);
    const { element, ...next } = nav;
    const breadcrumb = [...document.querySelectorAll('a[href]')].find(a => a.href.replace(/\/$/, "") === chapter.novelKey);
    return {
      status: "ready", chapter,
      candidate: { ...chapter, cleanText, contentHash: core.hashText(cleanText) },
      next, mode: mode(document, root),
      title: normalize(breadcrumb?.textContent) || chapter.slug.replace(/-/g, " ")
    };
  }
  global.CleanReader = { visible, navigation, mode, inspect };
  if (typeof module !== "undefined" && module.exports) module.exports = global.CleanReader;
})(globalThis);
