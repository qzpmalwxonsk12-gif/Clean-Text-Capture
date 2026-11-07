"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {report}=require("../timing-core.js");
const job={sessionId:"id",title:"Novel",status:"loading",startedAt:0,startNumber:1,copiedNumbers:[1,2],lastHash:"no-content"};
test("timing summaries preserve retries and resets and distinguish an unused fallback",()=>{
  const events=[
    {chapterNumber:1,type:"settling-reset",at:100,details:{configuredMs:500,actualMs:100}},
    {chapterNumber:1,type:"settled",at:900,details:{configuredMs:500,actualMs:800}},
    {chapterNumber:2,type:"settled",at:1600,details:{configuredMs:500,actualMs:600}},
    {chapterNumber:1,type:"copy-failed",at:910,details:{actualMs:10}},
    {chapterNumber:1,type:"copy-success",at:1000,details:{actualMs:20}},
    {chapterNumber:2,type:"security-start",at:1100,details:{}}
  ];
  const result=report(job,events,2000);
  assert.equal(result.summary.settling.medianMs,700);assert.equal(result.summary.settling.p95Ms,800);
  assert.equal(result.summary.clipboard.count,1);assert.equal(result.chapters[0].clipboardWrites.length,2);
  assert.deepEqual(result.summary.fallback,{count:0});assert.equal(result.chapters[1].securityWaits[0].actualMs,900);
  assert.ok(!("lastHash" in result.session));
});
