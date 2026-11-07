"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createHarness({ copySucceeds = true, chapters = [], pdfCreate, jobs=[], timings=[] } = {}) {
  let listener = null;
  const writes = [];
  let selectCalls = 0;
  let selectionRange = null;
  const blobs = new Map(), revoked = [];
  const buffer = {
    value: "",
    select() {
      selectCalls += 1;
    },
    setSelectionRange(start, end) {
      selectionRange = [start, end];
    }
  };
  const context = {
    setInterval:()=>0,clearInterval:()=>{},
    Blob, ChapterExport:require("../export-core.js"), ChapterArchive:{chapters:async()=>chapters,list:async()=>jobs,timings:async()=>timings},
    ChapterPdf:{create:pdfCreate},ChapterTimings:require("../timing-core.js"),
    URL:{createObjectURL(blob){const url=`blob:test/${blobs.size+1}`;blobs.set(url,blob);return url;},revokeObjectURL(url){revoked.push(url);}},
    chrome: {
      runtime: {
        onMessage: {
          addListener(value) {
            listener = value;
          }
        }
      }
    },
    document: {
      getElementById(id) {
        return id === "clipboard-buffer" ? buffer : null;
      },
      execCommand(command) {
        assert.equal(command, "copy");
        writes.push(buffer.value);
        return copySucceeds;
      }
    },
    navigator: {
      clipboard: {
        async writeText() {
          throw new Error("Document is not focused.");
        }
      }
    }
  };
  const source = fs.readFileSync(path.resolve(__dirname, "../offscreen.js"), "utf8");
  vm.runInNewContext(source, context, { filename: "offscreen.js" });

  assert.equal(typeof listener, "function");
  return {
    buffer,
    getSelectCalls: () => selectCalls,
    getSelectionRange: () => selectionRange,
    listener,
    writes, blobs, revoked
  };
}

function sendClipboardMessage(listener, text) {
  let response = null;
  const keepChannelOpen = listener(
    {
      target: "offscreen",
      type: "write-clean-chapter-to-clipboard",
      text
    },
    {},
    (value) => {
      response = value;
    }
  );
  assert.equal(keepChannelOpen, undefined);
  return { ...response };
}

test("offscreen clipboard handler copies through a selected DOM buffer", () => {
  const harness = createHarness();
  const response = sendClipboardMessage(harness.listener, "Clean chapter text");

  assert.deepEqual(harness.writes, ["Clean chapter text"]);
  assert.equal(harness.getSelectCalls(), 1);
  assert.deepEqual(harness.getSelectionRange(), [0, 18]);
  assert.equal(harness.buffer.value, "");
  assert.deepEqual(response, { ok: true });
});

test("offscreen clipboard handler reports a rejected copy command", () => {
  const harness = createHarness({ copySucceeds: false });
  const response = sendClipboardMessage(harness.listener, "Clean chapter text");

  assert.deepEqual(harness.writes, ["Clean chapter text"]);
  assert.equal(harness.buffer.value, "");
  assert.deepEqual(response, {
    ok: false,
    reason: "Chrome rejected the offscreen clipboard copy command."
  });
});
test("offscreen TXT uses its own archive, UTF-8 prose and explicit Blob cleanup", async () => {
  const h=createHarness({chapters:[{chapterNumber:2,cleanText:"世界"},{chapterNumber:1,cleanText:"Café"},{chapterNumber:3,cleanText:"Uncopied"}]});
  const response=await new Promise(resolve=>{
    const channel=h.listener({target:"offscreen",type:"create-chapter-export",format:"txt",sessionId:"session",copiedNumbers:[1,2]}, {}, resolve);
    assert.equal(channel,true);
  });
  assert.equal(response.ok,true);const blob=h.blobs.get(response.url);
  assert.equal(await blob.text(),"Café\n\n世界\n");assert.equal(blob.type,"text/plain;charset=utf-8");
  assert.equal(h.writes.length,0);assert.equal(h.revoked.length,0);
  h.listener({target:"offscreen",type:"release-chapter-txt",url:response.url},{},()=>{});
  h.listener({target:"offscreen",type:"release-chapter-txt",url:response.url},{},()=>{});
  assert.deepEqual(h.revoked,[response.url]);
});
test("offscreen TXT rejects empty collections without creating a Blob", async () => {
  const h=createHarness();
  const response=await new Promise(resolve=>h.listener({target:"offscreen",type:"create-chapter-export",format:"txt",sessionId:"empty"},{},resolve));
  assert.equal(response.ok,false);assert.match(response.reason,/no chapter text/);assert.equal(h.blobs.size,0);
});
test("offscreen PDF forwards the title, chapter filter and PDF bytes with the correct MIME type",async()=>{
  let input;
  const chapters=[{chapterNumber:1,cleanText:"Saved text"}];
  const h=createHarness({chapters,pdfCreate:async value=>{input=value;return new TextEncoder().encode("%PDF-test");}});
  const response=await new Promise(resolve=>h.listener({target:"offscreen",type:"create-chapter-export",format:"pdf",title:"Novel",sessionId:"run",copiedNumbers:[1]},{},resolve));
  assert.equal(input.title,"Novel");assert.equal(input.chapters,chapters);assert.deepEqual(input.copiedNumbers,[1]);
  assert.equal(h.blobs.get(response.url).type,"application/pdf");assert.equal(await h.blobs.get(response.url).text(),"%PDF-test");
});
test("offscreen timing download does not include saved chapter content",async()=>{
  const job={sessionId:"run",title:"Novel",copiedNumbers:[1]};
  const h=createHarness({jobs:[job],chapters:[{chapterNumber:1,cleanText:"SECRET PROSE"}],timings:[{chapterNumber:1,type:"copy-success",at:1,details:{actualMs:5}}]});
  const response=await new Promise(resolve=>h.listener({target:"offscreen",type:"create-chapter-export",format:"json",sessionId:"run"},{},resolve));
  const blob=h.blobs.get(response.url),text=await blob.text();assert.equal(blob.type,"application/json;charset=utf-8");
  assert.equal(JSON.parse(text).chapters[0].copyCount,1);assert.ok(!text.includes("SECRET PROSE"));
});
