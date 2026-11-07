(function (global) {
  "use strict";

  const MIN_CHAPTER_CHARACTERS = 120;
  const WTR_HOST_PATTERN = /(^|\.)wtr-lab\.com$/i;
  const WTR_CHAPTER_PATH = /^\/([^/]+)\/novel\/(\d+)\/([^/]+)\/chapter-(\d+)\/?$/i;
  const SECURITY_CHECK_REQUIRED = /\bsecurity\s+check\s+required\b/i;
  const SECURITY_CHECK_MARKERS = [
    /\bplease\s+complete\s+the\s+security\s+check\b/i,
    /\bdetected\s+unusual\s+reading\s+activity\b/i,
    /\bcomplete\s+the\s+challenge\s+below\s+to\s+continue\s+reading\b/i,
    /\bhaving\s+trouble\s+with\s+the\s+challenge\b/i,
    /\bopen\s+challenge\s+in\s+new\s+page\b/i
  ];

  function parseWtrChapterUrl(value) {
    let url;
    try {
      url = new URL(value);
    } catch (_error) {
      return null;
    }

    if (!WTR_HOST_PATTERN.test(url.hostname)) {
      return null;
    }

    const match = url.pathname.match(WTR_CHAPTER_PATH);
    if (!match) {
      return null;
    }

    const locale = match[1];
    const novelId = match[2];
    const slug = match[3];
    const chapterNumber = Number(match[4]);
    const novelKey = `${url.origin}/${locale}/novel/${novelId}/${slug}`;

    return {
      href: `${novelKey}/chapter-${chapterNumber}`,
      origin: url.origin,
      locale,
      novelId,
      slug,
      novelKey,
      chapterNumber,
      chapterKey: `${novelKey}/chapter-${chapterNumber}`
    };
  }

  function hashText(value) {
    let hash = 0x811c9dc5;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function isSecurityCheckText(value) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) {
      return false;
    }
    if (SECURITY_CHECK_REQUIRED.test(text)) {
      return true;
    }

    let markerCount = 0;
    for (const marker of SECURITY_CHECK_MARKERS) {
      if (marker.test(text)) {
        markerCount += 1;
      }
    }
    return markerCount >= 2;
  }

  function chapterNumberFromBody(element) {
    if (!element || typeof element.closest !== "function") {
      return null;
    }
    const container = element.closest(".chapter-container");
    const match = container && String(container.id || "").match(/^chapter-(\d+)$/i);
    return match ? Number(match[1]) : null;
  }

  function findWtrChapterBody(document, target, metadata) {
    if (!document || !metadata) {
      return null;
    }

    if (target && typeof target.closest === "function") {
      const targetedBody = target.closest(".chapter-body");
      if (targetedBody && chapterNumberFromBody(targetedBody) !== null) {
        return targetedBody;
      }
    }

    const activeBody = document.querySelector(".chapter-tracker.active .chapter-body");
    if (activeBody && chapterNumberFromBody(activeBody) !== null) {
      return activeBody;
    }

    const exactContainer = document.getElementById(`chapter-${metadata.chapterNumber}`);
    const exactBody = exactContainer && exactContainer.querySelector(".chapter-body");
    if (exactBody) {
      return exactBody;
    }

    return null;
  }

  function buildChapterCandidate(document, target, selectorCore, hrefOverride) {
    const href = hrefOverride || (document && document.location && document.location.href);
    const metadata = parseWtrChapterUrl(href);
    if (!metadata) {
      return { ok: false, reason: "Open a WTR Lab chapter before starting capture." };
    }

    const root = findWtrChapterBody(document, target, metadata);
    if (!root) {
      return { ok: false, reason: `Chapter ${metadata.chapterNumber} is not ready yet.` };
    }

    const detectedChapterNumber = chapterNumberFromBody(root);
    const chapterNumber = detectedChapterNumber === null
      ? metadata.chapterNumber
      : detectedChapterNumber;
    const cleanText = selectorCore.extractCleanText(root);
    const chapter = {
      href: `${metadata.novelKey}/chapter-${chapterNumber}`,
      novelKey: metadata.novelKey,
      novelId: metadata.novelId,
      slug: metadata.slug,
      chapterNumber,
      chapterKey: `${metadata.novelKey}/chapter-${chapterNumber}`
    };
    if (isSecurityCheckText(cleanText)) {
      return {
        ok: false,
        securityCheck: true,
        root,
        chapter,
        reason: `Security check detected for Chapter ${chapterNumber}. Nothing was copied.`
      };
    }
    if (cleanText.length < MIN_CHAPTER_CHARACTERS) {
      return {
        ok: false,
        reason: `Chapter ${chapterNumber} does not contain enough readable text.`
      };
    }

    return {
      ok: true,
      root,
      candidate: {
        ...chapter,
        contentHash: hashText(cleanText),
        cleanText
      }
    };
  }

  function evaluateCaptureCandidate(state, candidate, senderTabId, senderFrameId) {
    if (!state || !state.active) {
      return { capture: false, reason: "inactive" };
    }
    if (state.tabId !== senderTabId) {
      return { capture: false, reason: "different-tab" };
    }
    if (senderFrameId !== 0) {
      return { capture: false, reason: "not-top-frame" };
    }
    if (!candidate || candidate.novelKey !== state.novelKey) {
      return { capture: false, reason: "different-novel" };
    }
    if (isSecurityCheckText(candidate.cleanText)) {
      return { capture: false, reason: "security-check" };
    }
    if (!candidate.cleanText || candidate.cleanText.length < MIN_CHAPTER_CHARACTERS) {
      return { capture: false, reason: "too-short" };
    }

    const capturedChapterKeys = Array.isArray(state.capturedChapterKeys)
      ? state.capturedChapterKeys
      : [];
    if (capturedChapterKeys.includes(candidate.chapterKey)) {
      return { capture: false, reason: "already-captured" };
    }

    return { capture: true, reason: "new-chapter" };
  }

  const api = {
    MIN_CHAPTER_CHARACTERS,
    parseWtrChapterUrl,
    hashText,
    isSecurityCheckText,
    chapterNumberFromBody,
    findWtrChapterBody,
    buildChapterCandidate,
    evaluateCaptureCandidate
  };

  global.CleanChapterCapture = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
