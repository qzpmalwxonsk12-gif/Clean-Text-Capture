"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const settings=require("../settings-core.js");
test("existing settings keep their timings and new fields use compatible defaults",()=>{
  assert.deepEqual(settings.normalize({}),settings.defaults);
  assert.deepEqual(settings.normalize({chapterDelaySeconds:7,securityRetrySeconds:4}),{...settings.defaults,chapterDelaySeconds:7,securityRetrySeconds:4});
});
test("timings accept zero where allowed, decimals, and enforce finite bounds",()=>{
  const values=settings.normalize({textSettleSeconds:"0.35",chapterDelaySeconds:"0",nextFallbackSeconds:0,securityRetrySeconds:0});
  assert.deepEqual(values,{fastMode:false,textSettleSeconds:0.4,chapterDelaySeconds:0,nextFallbackSeconds:0,securityRetrySeconds:1});
  assert.equal(settings.normalize({textSettleSeconds:0}).textSettleSeconds,0.1);
  for(const key of Object.keys(settings.limits)){
    for(const value of [undefined,null,"", " ", "bad",NaN,Infinity,false,[]]) assert.equal(settings.normalize({[key]:value})[key],settings.defaults[key]);
    assert.equal(settings.normalize({[key]:10000})[key],60);
    assert.equal(settings.normalize({[key]:-100})[key],settings.limits[key][0]);
  }
});
test("Fast preset reduces normal waits without reducing security retry frequency",()=>{
  const config=settings.runtime({...settings.defaults,...settings.fastPreset});
  assert.equal(config.fastMode,true);assert.equal(config.settleMs,500);assert.equal(config.delayMs,0);
  assert.equal(config.fallbackMs,2000);assert.equal(config.pollMs,250);assert.equal(config.retryMs,3000);
  assert.equal(settings.normalize({fastMode:"true"}).fastMode,false);
});
