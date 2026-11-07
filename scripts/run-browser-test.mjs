import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidates = [process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].filter(Boolean);
const browserPath = candidates.find(p => fs.existsSync(p));
assert.ok(browserPath, "Chrome or Edge was not found");
const temporaryRoot = fs.realpathSync(os.tmpdir());
const profileDirectory = fs.mkdtempSync(path.join(temporaryRoot, "clean-body-selector-"));
let holdResponse, fixtureResult;
const server = http.createServer((req,res) => {
  if (req.url === "/__hold") { holdResponse = res; return; }
  if (req.url === "/__fixture_done" && req.method === "POST") {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      try { fixtureResult = JSON.parse(body); } catch { fixtureResult = {errors:["Invalid fixture response"]}; }
      res.end("ok"); holdResponse?.writeHead(204); holdResponse?.end();
    });
    return;
  }
  const file = path.resolve(projectRoot, "." + decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(projectRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404);res.end();return;}
  let body = fs.readFileSync(file, file.endsWith(".ttf") ? undefined : "utf8");
  if (file.endsWith("collector-fixture.html") || file.endsWith("archive-fixture.html")) body = body.replace("<body>", '<body><img src="/__hold" alt="" hidden>');
  res.setHeader("Content-Type", file.endsWith(".ttf") ? "font/ttf" : file.endsWith(".js") ? "text/javascript" : "text/html"); res.end(body);
});
await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
try {
  for (const fixture of ["archive-fixture.html","browser-fixture.html","collector-fixture.html","collector-fixture.html?fast=1"]) {
    fixtureResult = null;
    const url = `http://127.0.0.1:${server.address().port}/tests/${fixture}`;
    const output = await new Promise((resolve,reject) => {
      const child = spawn(browserPath,["--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check",`--user-data-dir=${profileDirectory}`,"--dump-dom",url],{windowsHide:true});
      let stdout="",stderr="";
      child.stdout.on("data",chunk=>{stdout+=chunk;}); child.stderr.on("data",chunk=>{stderr+=chunk;});
      const timeout=setTimeout(()=>{child.kill();reject(Error(`${fixture} timed out`));},55000);
      child.on("error",error=>{clearTimeout(timeout);reject(error);});
      child.on("exit",code=>{clearTimeout(timeout);code===0?resolve(stdout):reject(Error(stderr));});
    });
    const details=output.match(/<pre id="test-results">([\s\S]*?)<\/pre>/)?.[1];
    assert.match(output,/data-test-status="passed"/,details || JSON.stringify(fixtureResult) || "Fixture did not finish");
    console.log(`${fixture} passed in ${path.basename(browserPath)}.`);
  }
} finally {
  holdResponse?.end(); server.closeAllConnections(); server.close();
  const resolvedProfile=path.resolve(profileDirectory);
  assert.ok(resolvedProfile.startsWith(temporaryRoot + path.sep) && path.basename(resolvedProfile).startsWith("clean-body-selector-"));
  fs.rmSync(resolvedProfile,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
