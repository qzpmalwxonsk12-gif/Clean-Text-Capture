"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const capture = require("../capture-core.js");

test("parses WTR Lab chapter URLs into stable novel and chapter keys", () => {
  const result = capture.parseWtrChapterUrl(
    "https://wtr-lab.com/en/novel/95310/example-novel/chapter-27?reader=ai"
  );

  assert.ok(result);
  assert.equal(result.novelId, "95310");
  assert.equal(result.chapterNumber, 27);
  assert.equal(
    result.novelKey,
    "https://wtr-lab.com/en/novel/95310/example-novel"
  );
  assert.equal(
    result.chapterKey,
    "https://wtr-lab.com/en/novel/95310/example-novel/chapter-27"
  );
});

test("rejects non-WTR and non-chapter URLs", () => {
  assert.equal(capture.parseWtrChapterUrl("https://example.com/en/novel/1/x/chapter-1"), null);
  assert.equal(capture.parseWtrChapterUrl("https://wtr-lab.com/en/novel/1/x"), null);
  assert.equal(capture.parseWtrChapterUrl("not a url"), null);
});

test("captures only new chapters from the active novel and top-level tab", () => {
  const novelKey = "https://wtr-lab.com/en/novel/95310/example-novel";
  const candidate = {
    novelKey,
    chapterKey: `${novelKey}/chapter-2`,
    chapterNumber: 2,
    cleanText: "x".repeat(500)
  };
  const state = {
    active: true,
    tabId: 41,
    novelKey,
    capturedChapterKeys: [`${novelKey}/chapter-1`]
  };

  assert.deepEqual(
    capture.evaluateCaptureCandidate(state, candidate, 41, 0),
    { capture: true, reason: "new-chapter" }
  );
  assert.equal(
    capture.evaluateCaptureCandidate(state, candidate, 42, 0).reason,
    "different-tab"
  );
  assert.equal(
    capture.evaluateCaptureCandidate(state, candidate, 41, 3).reason,
    "not-top-frame"
  );
});

test("does not duplicate chapters after refresh or Back navigation", () => {
  const novelKey = "https://wtr-lab.com/en/novel/95310/example-novel";
  const chapterKey = `${novelKey}/chapter-8`;
  const state = {
    active: true,
    tabId: 7,
    novelKey,
    capturedChapterKeys: [chapterKey]
  };
  const candidate = {
    novelKey,
    chapterKey,
    chapterNumber: 8,
    cleanText: "chapter prose ".repeat(30)
  };

  assert.deepEqual(
    capture.evaluateCaptureCandidate(state, candidate, 7, 0),
    { capture: false, reason: "already-captured" }
  );
});

test("text hashes are deterministic and content-sensitive", () => {
  assert.equal(capture.hashText("same chapter"), capture.hashText("same chapter"));
  assert.notEqual(capture.hashText("chapter one"), capture.hashText("chapter two"));
});

test("detects WTR security-check placeholders without treating them as chapter prose", () => {
  const securityText = `
    Security Check Required
    Please complete the security check
    We've detected unusual reading activity from your IP address.
    Please complete the challenge below to continue reading.
    Having trouble with the challenge?
  `;

  assert.equal(capture.isSecurityCheckText(securityText), true);
  assert.equal(
    capture.isSecurityCheckText(
      "The guard completed a routine security check before the chapter continued."
    ),
    false
  );
});

test("defensively refuses a security placeholder before clipboard capture", () => {
  const novelKey = "https://wtr-lab.com/en/novel/95310/example-novel";
  const state = {
    active: true,
    tabId: 41,
    novelKey,
    capturedChapterKeys: []
  };
  const candidate = {
    novelKey,
    chapterKey: `${novelKey}/chapter-92`,
    chapterNumber: 92,
    cleanText: "Security Check Required. Please complete the security check. " +
      "We've detected unusual reading activity. Complete the challenge below to continue reading."
  };

  assert.deepEqual(
    capture.evaluateCaptureCandidate(state, candidate, 41, 0),
    { capture: false, reason: "security-check" }
  );
});
