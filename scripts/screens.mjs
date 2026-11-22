#!/usr/bin/env node
// Screenshots of the key screens at desktop (1280px) and phone (390px) widths, into docs/screens/.
//   node scripts/screens.mjs            # from dist/, served locally
//   node scripts/screens.mjs https://host/x/
import path from "node:path";
import { fileURLToPath } from "node:url";
import cfg from "../site.config.mjs";
import { launch } from "./lib/chrome.mjs";
import { serve } from "./lib/serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "screens");
const siteUrl = (process.env.SITE_URL || cfg.defaultSiteUrl).replace(/\/+$/, "");
const server = process.argv[2] ? null : await serve(path.join(ROOT, "dist"), { prefix: new URL(siteUrl + "/").pathname });
const base = process.argv[2] ? process.argv[2].replace(/\/+$/, "") + "/" : server.url;
const READY = "document.documentElement.dataset.ready === '1'";

const browser = await launch();
try {
  for (const [label, width, height, mobile] of [["desktop", 1280, 900, false], ["phone", 390, 844, true]]) {
    const page = await browser.newPage({ width, height, mobile, reducedMotion: true });
    const shot = (name, opts) => page.screenshot(path.join(OUT, `${name}-${label}.png`), opts).then(() => console.log(`docs/screens/${name}-${label}.png`));
    await page.goto(base, { ready: READY });
    await page.eval("localStorage.clear()");
    await shot("cafe", { fullPage: true });
    await page.goto(base + "?preset=event", { ready: READY });
    await shot("event", { fullPage: true });
    await page.goto(base + "how-many-staff-do-i-need/");
    await shot("how-many-staff", { fullPage: true });
    await page.goto(base + "method/");
    await shot("method", { fullPage: true });
    await page.close();
  }
} finally {
  await browser.close();
  if (server) await server.close();
}
