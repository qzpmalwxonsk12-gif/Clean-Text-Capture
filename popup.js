"use strict";
const $ = id => document.getElementById(id);
let currentJob, busy = false;
async function request(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.reason || "Extension did not respond.");
  return response;
}
async function refresh() {
  const {job,archives} = await request({type:"collector-status"});
  currentJob = job;
  $("novel").textContent = job?.title || "No active collection";
  $("status").textContent = (job?.reason || "Open a WTR chapter to begin.") + (job?.timingWarning ? ` ${job.timingWarning}` : "");
  $("progress").textContent = job ? `${job.copiedNumbers.length} copied · Chapter ${job.expectedNumber}${job.total ? ` / ${job.total}` : ""}` : "";
  const running = job && ["loading","stabilizing","copying","advancing","security"].includes(job.status);
  $("pause").disabled = !running;
  $("resume").disabled = !job || !["paused","attention"].includes(job.status);
  $("stop").disabled = !job || ["stopped","complete"].includes(job.status);
  $("open").disabled = !job;
  $("start").disabled = Boolean(running);
  const selected = $("archives").value;
  $("archives").replaceChildren();
  for (const saved of archives) {
    const option = document.createElement("option");
    option.value = saved.sessionId;
    option.textContent = `${saved.title} — from Ch. ${saved.startNumber} (${new Date(saved.startedAt).toLocaleDateString()})`;
    $("archives").append(option);
  }
  if ([...$("archives").options].some(o => o.value === selected)) $("archives").value = selected;
  $("export").disabled = !archives.length;
  $("export-txt").disabled = !archives.length;
  $("export-log").disabled = !archives.length;
}
async function act(callback) {
  if (busy) return;
  busy = true; $("error").textContent = "";
  try { await callback(); await refresh(); } catch (error) { $("error").textContent = error.message; }
  finally { busy = false; }
}
$("start").onclick = () => act(async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  await request({type:"collector-start",tabId:tab.id});
});
for (const action of ["pause","resume","stop"]) $(action).onclick = () => act(() => request({type:"collector-control",action,sessionId:currentJob?.sessionId}));
$("open").onclick = () => act(() => request({type:"collector-open"}));
$("settings").onclick = () => chrome.runtime.openOptionsPage();
for (const [id,format] of [["export","pdf"],["export-txt","txt"],["export-log","json"]]) $(id).onclick = () => act(async () => {
  const sessionId = $("archives").value;
  await request({type:"collector-export",sessionId,format});
});
void act(async () => {});
setInterval(() => { if (!busy) void refresh().catch(error => { $("error").textContent = error.message; }); }, 1500);
