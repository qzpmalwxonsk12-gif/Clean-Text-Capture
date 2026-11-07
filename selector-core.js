(function (global) {
  "use strict";

  const EXCLUDED_CLASS = "__clean_body_selector_excluded__";
  const STYLE_ID = "__clean_body_selector_styles__";

  const ROOT_TAGS = new Set([
    "ARTICLE",
    "MAIN",
    "SECTION",
    "DIV",
    "BLOCKQUOTE",
    "TD",
    "BODY"
  ]);

  const BLOCK_TAGS = new Set([
    "ADDRESS",
    "ARTICLE",
    "BLOCKQUOTE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "FIGCAPTION",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "LI",
    "MAIN",
    "P",
    "PRE",
    "SECTION",
    "TABLE",
    "TBODY",
    "TFOOT",
    "THEAD",
    "TR"
  ]);

  const HARD_EXCLUDED_TAGS = new Set([
    "AREA",
    "AUDIO",
    "BUTTON",
    "CANVAS",
    "DATALIST",
    "DIALOG",
    "EMBED",
    "FORM",
    "IFRAME",
    "INPUT",
    "MENU",
    "NAV",
    "NOSCRIPT",
    "OBJECT",
    "OPTION",
    "PICTURE",
    "SCRIPT",
    "SELECT",
    "STYLE",
    "SVG",
    "TEMPLATE",
    "TEXTAREA",
    "VIDEO"
  ]);

  const EXCLUDED_ROLES = new Set([
    "advertisement",
    "banner",
    "complementary",
    "contentinfo",
    "dialog",
    "form",
    "menu",
    "menubar",
    "navigation",
    "search",
    "toolbar"
  ]);

  // Token boundaries matter here. For example, "header" must not be treated
  // as an ad merely because it contains the letters "ad".
  const NOISE_SIGNAL = /(?:^|[\s_:\-])(ad|ads|adslot|advert|advertisement|advertising|banner|sponsor|sponsored|promo|promoted|cookie|consent|popup|modal|newsletter|subscribe|subscription|social|share|sharing|toolbar|breadcrumb|breadcrumbs|sidebar|related|recommended|recommendation|recommendations|comment|comments|disqus|outbrain|taboola|paywall|login|signup|footer|navigation|sitemenu|site-menu|globalmenu|global-menu|dropdownmenu|dropdown-menu|contextmenu|context-menu|mobilemenu|mobile-menu|menubar|menu-bar|menucontainer|menu-container|masthead)(?=$|[\s_:\-])/i;
  const STRONG_BODY_SIGNAL = /(?:^|[\s_:\-])(articlebody|article-body|article_body|postcontent|post-content|post_content|entrycontent|entry-content|entry_content|storybody|story-body|story_body|chapterbody|chapter-body|chapter_body|readercontent|reader-content|reader_content|articlecontent|article-content|article_content|maincontent|main-content|main_content)(?=$|[\s_:\-])/i;
  const BODY_SIGNAL = /(?:^|[\s_:\-])(article|post|story|entry|content|body|main|text)(?=$|[\s_:\-])/i;

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function elementSignals(element) {
    if (!element || typeof element.getAttribute !== "function") {
      return "";
    }

    const values = [
      element.id,
      typeof element.className === "string" ? element.className : "",
      element.getAttribute("role"),
      element.getAttribute("aria-label"),
      element.getAttribute("itemprop"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-component"),
      element.getAttribute("data-ad"),
      element.getAttribute("data-ad-slot"),
      element.getAttribute("data-ad-unit")
    ];

    return values.filter(Boolean).join(" ").toLowerCase();
  }

  function isNoiseSignal(value) {
    return NOISE_SIGNAL.test(String(value || "").toLowerCase());
  }

  function isStrongBodySignal(value) {
    return STRONG_BODY_SIGNAL.test(String(value || "").toLowerCase());
  }

  function hasBodySignal(value) {
    return BODY_SIGNAL.test(String(value || "").toLowerCase());
  }

  function isVisuallyHidden(element) {
    if (!element || element.nodeType !== 1) {
      return false;
    }

    if (
      element.hidden ||
      element.getAttribute("aria-hidden") === "true" ||
      element.getAttribute("inert") !== null
    ) {
      return true;
    }

    const view = element.ownerDocument && element.ownerDocument.defaultView;
    if (!view || typeof view.getComputedStyle !== "function") {
      return false;
    }

    const style = view.getComputedStyle(element);
    return (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      style.contentVisibility === "hidden"
    );
  }

  function isInlineChapterTerm(element) {
    if (!element || element.tagName !== "BUTTON" || typeof element.closest !== "function") {
      return false;
    }

    // WTR Lab renders glossary-linked words as buttons directly inside each
    // prose line. They are chapter text, not controls or page chrome.
    return Boolean(
      element.closest(".chapter-body") &&
      element.closest(".wtr-line") &&
      normalizeText(element.textContent)
    );
  }

  function shouldExcludeElement(element, root) {
    if (!element || element === root || element.nodeType !== 1) {
      return false;
    }

    if (HARD_EXCLUDED_TAGS.has(element.tagName) && !isInlineChapterTerm(element)) {
      return true;
    }

    if (element.tagName === "ASIDE" || element.tagName === "FOOTER") {
      return true;
    }

    const role = normalizeText(element.getAttribute("role")).toLowerCase();
    if (EXCLUDED_ROLES.has(role)) {
      return true;
    }

    if (
      element.hasAttribute("data-ad") ||
      element.hasAttribute("data-ad-slot") ||
      element.hasAttribute("data-ad-unit") ||
      element.getAttribute("rel") === "sponsored" ||
      isNoiseSignal(elementSignals(element)) ||
      isVisuallyHidden(element)
    ) {
      return true;
    }

    const view = element.ownerDocument && element.ownerDocument.defaultView;
    if (view && typeof view.getComputedStyle === "function") {
      const position = view.getComputedStyle(element).position;
      if (position === "fixed") {
        return true;
      }
    }

    return false;
  }

  function collectExcludedElements(root) {
    const excluded = [];

    function visit(element) {
      for (const child of element.children || []) {
        if (shouldExcludeElement(child, root)) {
          excluded.push(child);
        } else {
          visit(child);
        }
      }
    }

    if (root && root.nodeType === 1) {
      visit(root);
    }

    return excluded;
  }

  function appendBreak(state, count) {
    state.value = state.value.replace(/[ \t]+$/g, "");
    const match = state.value.match(/\n+$/);
    const existing = match ? match[0].length : 0;
    if (state.value && existing < count) {
      state.value += "\n".repeat(count - existing);
    }
  }

  function appendInlineText(state, value) {
    const hadLeadingSpace = /^\s/.test(value);
    const hadTrailingSpace = /\s$/.test(value);
    let compact = String(value || "").replace(/\s+/g, " ");
    if (!compact.trim()) {
      if (state.value && !/[\s]$/.test(state.value)) {
        state.value += " ";
      }
      return;
    }

    compact = compact.trim();
    if (
      state.value &&
      !/[\s]$/.test(state.value) &&
      hadLeadingSpace
    ) {
      state.value += " ";
    }
    state.value += compact;
    if (hadTrailingSpace) {
      state.value += " ";
    }
  }

  function extractCleanText(root) {
    if (!root || root.nodeType !== 1) {
      return "";
    }

    const excluded = new Set(collectExcludedElements(root));
    const state = { value: "" };

    function walk(node, preserveWhitespace) {
      if (node.nodeType === 3) {
        if (preserveWhitespace) {
          state.value += node.nodeValue || "";
        } else {
          appendInlineText(state, node.nodeValue || "");
        }
        return;
      }

      if (node.nodeType !== 1 || excluded.has(node)) {
        return;
      }

      const tagName = node.tagName;
      if (tagName === "BR") {
        appendBreak(state, 1);
        return;
      }

      const isBlock = BLOCK_TAGS.has(tagName);
      const isPre = tagName === "PRE";
      if (isBlock) {
        appendBreak(state, tagName === "LI" || tagName === "TR" ? 1 : 2);
      }

      if (tagName === "LI") {
        state.value += "- ";
      }

      const children = Array.from(node.childNodes || []);
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        walk(child, preserveWhitespace || isPre);
        if (
          (tagName === "TR" && child.nodeType === 1 && (child.tagName === "TD" || child.tagName === "TH")) &&
          index < children.length - 1
        ) {
          state.value = state.value.replace(/[ \t]+$/g, "") + "\t";
        }
      }

      if (isBlock) {
        appendBreak(state, tagName === "LI" || tagName === "TR" ? 1 : 2);
      }
    }

    walk(root, false);

    return state.value
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function getParentElementAcrossShadow(element) {
    if (!element) {
      return null;
    }
    if (element.parentElement) {
      return element.parentElement;
    }

    const root = typeof element.getRootNode === "function" ? element.getRootNode() : null;
    return root && root.host ? root.host : null;
  }

  function textLengthOf(element) {
    return normalizeText(element && element.textContent).length;
  }

  function scoreContentMetrics(metrics) {
    let score = Math.min(metrics.textLength, 8000) / 24;
    score += Math.min(metrics.paragraphCount, 24) * 44;
    score += Math.min(metrics.headingCount, 4) * 18;
    score -= Math.min(1, metrics.linkDensity) * 520;
    score -= metrics.distance * 5;

    if (metrics.strongBodySignal) {
      score += 1050;
    } else if (metrics.tagName === "ARTICLE") {
      score += 820;
    } else if (metrics.roleMain) {
      score += 650;
    } else if (metrics.tagName === "MAIN") {
      score += 600;
    } else if (metrics.bodySignal) {
      score += 330;
    }

    if (metrics.noiseSignal) {
      score -= 1400;
    }
    if (metrics.tagName === "BODY") {
      score -= 520;
    }
    if (metrics.textLength < 60) {
      score -= 180;
    }

    return score;
  }

  function metricsForCandidate(element, distance) {
    const textLength = textLengthOf(element);
    const paragraphs = Array.from(element.querySelectorAll("p, li, blockquote"));
    const paragraphCount = paragraphs.filter((item) => textLengthOf(item) >= 35).length;
    const headingCount = element.querySelectorAll("h1, h2, h3").length;
    const linkTextLength = Array.from(element.querySelectorAll("a"))
      .reduce((total, link) => total + textLengthOf(link), 0);
    const signals = elementSignals(element);

    return {
      tagName: element.tagName,
      textLength,
      paragraphCount,
      headingCount,
      linkDensity: textLength ? linkTextLength / textLength : 0,
      distance,
      strongBodySignal:
        isStrongBodySignal(signals) ||
        normalizeText(element.getAttribute("itemprop")).toLowerCase() === "articlebody",
      bodySignal: hasBodySignal(signals),
      noiseSignal: isNoiseSignal(signals),
      roleMain: normalizeText(element.getAttribute("role")).toLowerCase() === "main"
    };
  }

  function findContentRoot(target) {
    let element = target && target.nodeType === 1 ? target : target && target.parentElement;
    if (!element) {
      return null;
    }

    const candidates = [];
    let distance = 0;
    while (element) {
      if (ROOT_TAGS.has(element.tagName) || element.getAttribute("role") === "main") {
        const metrics = metricsForCandidate(element, distance);
        if (metrics.textLength > 0) {
          candidates.push({
            element,
            score: scoreContentMetrics(metrics),
            metrics
          });
        }
      }

      if (element.tagName === "BODY") {
        break;
      }
      element = getParentElementAcrossShadow(element);
      distance += 1;
    }

    if (!candidates.length) {
      return target.ownerDocument ? target.ownerDocument.body : null;
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].element;
  }

  function ensureSelectionStyle(document) {
    if (!document || document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${EXCLUDED_CLASS}, .${EXCLUDED_CLASS} * {
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      .${EXCLUDED_CLASS}::selection, .${EXCLUDED_CLASS} *::selection {
        background: transparent !important;
        color: inherit !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function selectCleanBody(target) {
    const root = findContentRoot(target);
    if (!root) {
      return { ok: false, reason: "No content body was found." };
    }

    const cleanText = extractCleanText(root);
    if (!cleanText) {
      return { ok: false, reason: "No readable text was found in this body." };
    }

    const document = root.ownerDocument;
    const selection = document.defaultView && document.defaultView.getSelection();
    if (!selection) {
      return { ok: false, reason: "This page does not allow text selection." };
    }

    ensureSelectionStyle(document);
    const excludedElements = collectExcludedElements(root);
    for (const element of excludedElements) {
      element.classList.add(EXCLUDED_CLASS);
    }

    const range = document.createRange();
    range.selectNodeContents(root);
    selection.removeAllRanges();
    selection.addRange(range);

    return {
      ok: true,
      root,
      range,
      cleanText,
      excludedElements
    };
  }

  function clearExcludedMarkers(elements) {
    for (const element of elements || []) {
      if (element && element.classList) {
        element.classList.remove(EXCLUDED_CLASS);
      }
    }
  }

  const api = {
    EXCLUDED_CLASS,
    normalizeText,
    elementSignals,
    isNoiseSignal,
    isStrongBodySignal,
    hasBodySignal,
    isInlineChapterTerm,
    shouldExcludeElement,
    collectExcludedElements,
    extractCleanText,
    scoreContentMetrics,
    metricsForCandidate,
    findContentRoot,
    selectCleanBody,
    clearExcludedMarkers
  };

  global.CleanBodySelector = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(globalThis);
