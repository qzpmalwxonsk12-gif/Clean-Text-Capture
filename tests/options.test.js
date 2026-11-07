"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),vm=require("node:vm"),fs=require("node:fs");
const settings=require("../settings-core.js");
function harness(initial={}){
  const saved=[],elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,{value:"",checked:false,textContent:"",addEventListener(_type,fn){this.click=fn;}});return elements.get(id);}};
  const chrome={runtime:{},storage:{local:{get(defaults,callback){callback({...defaults,...initial});},set(values,callback){saved.push(values);callback();}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve("../options.js"),"utf8"),{ChapterSettings:settings,chrome,document});
  return {saved,get:id=>document.getElementById(id)};
}
test("options preserve existing settings and save fractional or zero timings",()=>{
  const h=harness({chapterDelaySeconds:7});assert.equal(h.get("chapter-delay-seconds").value,"7");
  assert.equal(h.get("text-settle-seconds").value,"1.5");h.get("chapter-delay-seconds").value="0";
  h.get("text-settle-seconds").value="0.3";h.get("next-fallback-seconds").value="1.2";h.get("save").click();
  assert.equal(h.saved[0].chapterDelaySeconds,0);assert.equal(h.saved[0].textSettleSeconds,0.3);assert.equal(h.saved[0].nextFallbackSeconds,1.2);
});
test("Fast and Standard presets save immediately and preserve security timing",()=>{
  const h=harness({securityRetrySeconds:9});h.get("fast-preset").click();
  assert.deepEqual({...h.saved[0]},{...settings.defaults,...settings.fastPreset,securityRetrySeconds:9});
  h.get("standard-preset").click();assert.deepEqual({...h.saved[1]},{...settings.defaults,securityRetrySeconds:9});
  assert.match(h.get("status").textContent,/Saved/);
});
