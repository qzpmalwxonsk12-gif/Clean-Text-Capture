"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {filename:makeFilename,text} = require("../export-core.js");
const filename=title=>makeFilename(title,"txt");
test("PDF is the default format and filenames cannot inject other extensions",()=>{
  assert.equal(makeFilename("My Novel: Hello?"),"My Novel Hello.pdf");
  assert.throws(()=>makeFilename("Novel","exe"),/Unsupported/);
});
test("TXT filenames use the novel title without special or Windows-invalid characters", () => {
  assert.equal(filename("Post-apocalyptic Shop: Profit-driven Shopkeeper"), "Post-apocalyptic Shop Profit-driven Shopkeeper.txt");
  assert.equal(filename('  A/B\\C:*?"<>|\u0000\nD...  '), "A B C D.txt");
  assert.equal(filename("Don't Stop!"), "Dont Stop.txt");
  assert.equal(filename("修仙传 — Café"), "修仙传 Café.txt");
  for (const title of ["CON", "aux", "LPT9", "COM¹"]) assert.match(filename(title), /^Novel /);
  assert.equal(filename("...<>"), "Novel.txt");
  assert.equal(filename(null), "Novel.txt");
  assert.ok(filename("A".repeat(300)).length <= 164);
  assert.ok(!filename("𠮷".repeat(200)).includes("\ufffd"));
});
test("TXT exports sort chapters and optionally include only confirmed copies", () => {
  const chapters = [{chapterNumber:3,cleanText:"third"},{chapterNumber:1,cleanText:"first"},{chapterNumber:2,cleanText:"second"}];
  assert.equal(text(chapters,[1,2]), "first\n\nsecond\n");
  assert.equal(text(chapters), "first\n\nsecond\n\nthird\n");
  assert.equal(chapters[0].chapterNumber,3);
  assert.throws(()=>text(chapters,[]),/no chapter text/);
  assert.throws(()=>text([]),/no chapter text/);
});
