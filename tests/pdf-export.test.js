"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
global.PDFLib=require("../vendor/pdf-lib.min.js");
global.fontkit=require("../vendor/fontkit.umd.min.js");
global.ChapterExport=require("../export-core.js");
const pdf=require("../pdf-export.js");
const readFont=async name=>new Uint8Array(fs.readFileSync(path.join(__dirname,"../fonts",name)));
test("PDF exports create selectable Unicode text, multiple pages and ordered chapters",async()=>{
  const title="Example Novel: Scholar’s Return";
  const chapters=[
    {chapterNumber:3,cleanText:"Chapter 3: The Journey\n\n"+"LongUnbrokenWord".repeat(30)+"\n\nTHE FINAL CHAPTER MARKER."},
    {chapterNumber:1,cleanText:"Chapter 1: A Quiet Beginning\n\n"+Array.from({length:16},(_,i)=>`Paragraph ${i+1}. Café, naïve, “quoted words,” office, efficient. `+"The scholar walked beside the river and listened to the wind in the trees. ".repeat(5)).join("\n\n")},
    {chapterNumber:2,cleanText:"Chapter 2: Across the Sea\n\nChinese: 你好，世界。修仙传。\n\nJapanese: こんにちは。\n\nGreek: Καλημέρα. Cyrillic: Привет.\n\nThe chapter ends here."},
    {chapterNumber:4,cleanText:"THIS UNCONFIRMED CHAPTER MUST BE OMITTED."}
  ];
  const bytes=await pdf.create({title,chapters,copiedNumbers:[1,2,3]},readFont);
  assert.equal(Buffer.from(bytes).subarray(0,5).toString(),"%PDF-");
  const parsed=await PDFLib.PDFDocument.load(bytes);
  assert.ok(parsed.getPageCount()>=4);assert.equal(parsed.getTitle(),title);
  const directory=path.join(__dirname,"../tmp/pdfs");fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,"novel-export-sample.pdf"),bytes);
  fs.writeFileSync(path.join(directory,"expected-text.json"),JSON.stringify({title,chapters:ChapterExport.select(chapters,[1,2,3])}));
});
test("PDF refuses empty exports and unsupported glyphs instead of silently losing text",async()=>{
  await assert.rejects(pdf.create({chapters:[]},readFont),/no chapter text/);
  await assert.rejects(pdf.create({chapters:[{chapterNumber:1,cleanText:"Test \u{10ffff}"}]},readFont),/does not support U\+10FFFF/);
});
