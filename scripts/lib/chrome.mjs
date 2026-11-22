// A small Chrome DevTools Protocol driver with no dependencies: launch headless Chrome, open pages at
// desktop or phone size, run scripts in them, collect console errors and network requests, take
// screenshots and catch downloads. Needs Node 22+ (global WebSocket) and Google Chrome or Chromium.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findChrome() {
  for (const c of CANDIDATES) if (c && fs.existsSync(c)) return c;
  throw new Error("Chrome not found; set CHROME to its path");
}

export async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-e2e-"));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "chrome-dl-"));
  const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--metrics-recording-only",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"];
  if (process.env.CI || process.platform === "linux") args.unshift("--no-sandbox");
  const proc = spawn(findChrome(), args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not start: " + buf.slice(-400))), 30000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited (${code}): ${buf.slice(-400)}`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("could not connect to Chrome")), { once: true });
  });
  let seq = 0;
  const waiting = new Map();
  const listeners = new Set();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject, method } = waiting.get(m.id);
      waiting.delete(m.id);
      if (m.error) reject(new Error(`${method}: ${m.error.message}`)); else resolve(m.result);
    } else for (const l of [...listeners]) l(m);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const completed = [];
  listeners.add((m) => {
    if (m.method === "Browser.downloadWillBegin") completed.push({ guid: m.params.guid, name: m.params.suggestedFilename, done: false });
    if (m.method === "Browser.downloadProgress" && m.params.state === "completed") {
      const d = completed.find((x) => x.guid === m.params.guid);
      if (d) d.done = true;
    }
  });
  await send("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: downloads, eventsEnabled: true });

  async function newPage({ width = 1280, height = 900, mobile = false, dark = false, reducedMotion = false } = {}) {
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const page = { errors: [], requests: [], width, height, mobile };
    const s = (method, params) => send(method, params, sessionId);
    const on = (m) => {
      if (m.sessionId !== sessionId) return;
      const p = m.params;
      if (m.method === "Runtime.exceptionThrown") {
        page.errors.push("exception: " + (p.exceptionDetails.exception?.description || p.exceptionDetails.text));
      } else if (m.method === "Runtime.consoleAPICalled" && p.type === "error") {
        page.errors.push("console.error: " + p.args.map((a) => a.value ?? a.description ?? "").join(" "));
      } else if (m.method === "Log.entryAdded" && p.entry.level === "error") {
        page.errors.push(`browser: ${p.entry.text} ${p.entry.url || ""}`.trim());
      } else if (m.method === "Network.requestWillBeSent") {
        page.requests.push(p.request.url);
      }
    };
    listeners.add(on);
    await s("Page.enable");
    await s("Runtime.enable");
    await s("Log.enable");
    await s("Network.enable");
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
    if (mobile) {
      await s("Emulation.setTouchEmulationEnabled", { enabled: true });
      await s("Emulation.setUserAgentOverride", { userAgent: PHONE_UA });
    }
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" },
      { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }] });

    const waitEvent = (method, timeout = 30000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listeners.delete(l); reject(new Error("timed out waiting for " + method)); }, timeout);
      const l = (m) => {
        if (m.method === method && m.sessionId === sessionId) { clearTimeout(timer); listeners.delete(l); resolve(m.params); }
      };
      listeners.add(l);
    });

    page.eval = async (expression) => {
      const r = await s("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      if (r.exceptionDetails) {
        throw new Error("in page: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text) + "\n  while running: " + expression.slice(0, 200));
      }
      return r.result.value;
    };
    page.waitFor = async (expression, { timeout = 15000, what } = {}) => {
      const t0 = Date.now();
      let last;
      while (Date.now() - t0 < timeout) {
        try { last = await page.eval(expression); if (last) return last; } catch (e) { last = e.message; }
        await sleep(50);
      }
      throw new Error(`timed out waiting for ${what || expression} (last: ${String(last).slice(0, 200)})`);
    };
    page.goto = async (url, { ready = "document.readyState === 'complete'" } = {}) => {
      const loaded = waitEvent("Page.loadEventFired");
      const r = await s("Page.navigate", { url });
      if (r.errorText) throw new Error(`could not open ${url}: ${r.errorText}`);
      await loaded;
      await page.waitFor(ready, { what: `${url} to be ready` });
    };
    page.reload = async ({ ready = "document.readyState === 'complete'" } = {}) => {
      const loaded = waitEvent("Page.loadEventFired");
      await s("Page.reload", { ignoreCache: false });
      await loaded;
      await page.waitFor(ready, { what: "reload to be ready" });
    };
    const q = (sel) => `document.querySelector(${JSON.stringify(sel)})`;
    page.click = (sel) => page.eval(`(() => { const el = ${q(sel)}; if (!el) throw new Error("no element for ${sel.replace(/"/g, '\\"')}"); el.scrollIntoView({block: "center"}); el.click(); return true; })()`);
    page.type = (sel, text) => page.eval(`(() => { const el = ${q(sel)}; if (!el) throw new Error("no element for ${sel.replace(/"/g, '\\"')}"); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", {bubbles: true})); el.dispatchEvent(new Event("change", {bubbles: true})); return true; })()`);
    page.text = (sel) => page.eval(`(${q(sel)}?.textContent ?? null)`);
    page.exists = (sel) => page.eval(`!!${q(sel)}`);
    page.setFiles = async (sel, files) => {
      const { root } = await s("DOM.getDocument", { depth: 0 });
      const { nodeId } = await s("DOM.querySelector", { nodeId: root.nodeId, selector: sel });
      if (!nodeId) throw new Error("no file input for " + sel);
      await s("DOM.setFileInputFiles", { nodeId, files });
    };
    // Widest element overflow: 0 means the page fits its viewport.
    page.overflow = () => page.eval("Math.max(0, document.documentElement.scrollWidth - window.innerWidth)");
    page.screenshot = async (file, { fullPage = false } = {}) => {
      const { cssContentSize, cssVisualViewport: vv } = await s("Page.getLayoutMetrics");
      const scale = mobile ? 0.5 : 1; // phone shots are saved at CSS pixels to keep the files small
      const clip = fullPage
        ? { x: 0, y: 0, width: cssContentSize.width, height: Math.min(cssContentSize.height, 6000), scale }
        : { x: vv.pageX, y: vv.pageY, width: vv.clientWidth, height: vv.clientHeight, scale };
      const { data } = await s("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: fullPage });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    };
    // Run `action` (which should start a download) and return { name, text, bytes } of the saved file.
    page.download = async (action, { timeout = 15000 } = {}) => {
      const before = completed.length;
      await action();
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        const d = completed[before];
        if (d && d.done) {
          const bytes = fs.readFileSync(path.join(downloads, d.guid));
          return { name: d.name, bytes, text: bytes.toString("utf8") };
        }
        await sleep(50);
      }
      throw new Error("no download completed");
    };
    page.close = async () => { listeners.delete(on); await send("Target.closeTarget", { targetId }); };
    return page;
  }

  async function close() {
    try { ws.close(); } catch {}
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await Promise.race([exited, sleep(5000)]);
    for (const d of [profile, downloads]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  return { newPage, close, downloads };
}
