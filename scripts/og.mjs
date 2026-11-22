#!/usr/bin/env node
// Draw the social preview images (1200x630) and the app icons with headless Chrome, into
// site/assets/. Run it by hand when the art or the headlines change, then commit the PNGs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { launch } from "./lib/chrome.mjs";
import * as sim from "../site/assets/sim.js";
import { waitChartSVG } from "../site/assets/art.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(ROOT, "site", "assets", "site.css"), "utf8");
const chart = waitChartSVG(sim.rehearse(sim.PRESETS.cafe), { width: 760, height: 300 }).replace("<svg ", '<svg width="560" height="221" ');
const card = (headline, sub) => `<!doctype html><meta charset="utf-8"><style>${css} body{margin:0}</style>
<body style="width:1200px;height:630px;overflow:hidden;background:#f6f5fb;color:#1c1730;font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;padding:0 56px;box-sizing:border-box;gap:36px">
<div style="flex:1"><div style="font-size:25px;font-weight:700;letter-spacing:3px;color:#5b3fd1">SHIFT REHEARSAL</div>
<div style="font-size:60px;font-weight:800;line-height:1.06;margin-top:26px;letter-spacing:-1px">${headline}</div>
<div style="font-size:27px;line-height:1.35;margin-top:20px;color:#5f5a73">${sub}</div></div>
<div style="background:#fff;border-radius:22px;padding:18px;border:1px solid #e0dcef">${chart}</div></body>`;
const CARDS = {
  home: card("Rehearse a shift before you staff it.", "Waits, walk-outs, idle hours and cost for two staffing plans. Simulations, not forecasts."),
  staff: card("How many staff do I need?", "The queueing arithmetic, a table to start from, and a free simulator for your day."),
};
const work = fs.mkdtempSync(path.join(os.tmpdir(), "og-"));
const browser = await launch();
try {
  fs.mkdirSync(path.join(ROOT, "site", "assets", "og"), { recursive: true });
  const page = await browser.newPage({ width: 1200, height: 630 });
  for (const [name, html] of Object.entries(CARDS)) {
    const file = path.join(work, `${name}.html`);
    fs.writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page.screenshot(path.join(ROOT, "site", "assets", "og", `${name}.png`));
    console.log(`site/assets/og/${name}.png`);
  }
  await page.close();
  const favicon = fs.readFileSync(path.join(ROOT, "site", "favicon.svg"), "utf8");
  for (const size of [180, 192, 512]) {
    const icon = await browser.newPage({ width: size, height: size });
    const file = path.join(work, `icon-${size}.html`);
    fs.writeFileSync(file, `<!doctype html><body style="margin:0;background:#3b2a6b">${favicon.replace("<svg ", `<svg width="${size}" height="${size}" style="display:block" `)}</body>`);
    await icon.goto(pathToFileURL(file).href);
    await icon.screenshot(path.join(ROOT, "site", "assets", `icon-${size}.png`));
    await icon.close();
  }
  console.log("icons done");
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}
