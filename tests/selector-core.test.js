"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const selector = require("../selector-core.js");

test("ad and page-clutter tokens are detected without short substring false positives", () => {
  for (const value of [
    "advertisement",
    "top-ad-slot",
    "sponsored_banner",
    "newsletter-popup",
    "related-content",
    "site-navigation",
    "dropdown-menu"
  ]) {
    assert.equal(selector.isNoiseSignal(value), true, value);
  }

  for (const value of [
    "header",
    "reading",
    "shadow",
    "advice",
    "article-header",
    "main-content",
    "menu-target"
  ]) {
    assert.equal(selector.isNoiseSignal(value), false, value);
  }
});

test("specific article-body signals outrank generic content signals", () => {
  assert.equal(selector.isStrongBodySignal("article-body content-area"), true);
  assert.equal(selector.isStrongBodySignal("entry_content"), true);
  assert.equal(selector.isStrongBodySignal("chapter-body menu-target"), true);
  assert.equal(selector.hasBodySignal("main content"), true);
  assert.equal(selector.hasBodySignal("site-shell"), false);
});

test("a focused article body scores above a large page shell", () => {
  const articleBody = selector.scoreContentMetrics({
    tagName: "DIV",
    textLength: 2400,
    paragraphCount: 9,
    headingCount: 1,
    linkDensity: 0.04,
    distance: 2,
    strongBodySignal: true,
    bodySignal: true,
    noiseSignal: false,
    roleMain: false
  });
  const pageBody = selector.scoreContentMetrics({
    tagName: "BODY",
    textLength: 9000,
    paragraphCount: 12,
    headingCount: 3,
    linkDensity: 0.3,
    distance: 6,
    strongBodySignal: false,
    bodySignal: false,
    noiseSignal: false,
    roleMain: false
  });

  assert.ok(articleBody > pageBody, { articleBody, pageBody });
});

test("noise candidates receive a strong scoring penalty", () => {
  const base = {
    tagName: "DIV",
    textLength: 1200,
    paragraphCount: 4,
    headingCount: 1,
    linkDensity: 0.1,
    distance: 1,
    strongBodySignal: false,
    bodySignal: false,
    roleMain: false
  };

  const cleanScore = selector.scoreContentMetrics({ ...base, noiseSignal: false });
  const noiseScore = selector.scoreContentMetrics({ ...base, noiseSignal: true });
  assert.ok(cleanScore - noiseScore >= 1400);
});
