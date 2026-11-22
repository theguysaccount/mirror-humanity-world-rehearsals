#!/usr/bin/env node
// Health check of the live site, run weekly by selftest.yml and after every deploy.
//
//   node scripts/check_live.mjs [site-url]
//
// Checks: every sitemap URL answers 200 and names itself as canonical; robots.txt points at the
// sitemap; the IndexNow key file and the share images are served; a missing page answers 404; and
// the live build is the one this checkout produces. Build first with the same settings (the
// workflows do), or set EXPECT_VERSION. When the live build is behind, prints stale=true to
// $GITHUB_OUTPUT so the workflow can redeploy. Exits 1 on any problem.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cfg from "../site.config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] || process.env.SITE_URL || cfg.defaultSiteUrl).replace(/\/+$/, "");
const UA = `${cfg.repo}-healthcheck/1.0 (+${cfg.repoUrl})`;
const problems = [];

async function get(url, { tries = 3 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    if (i) await new Promise((r) => setTimeout(r, 4000 * i));
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(30000) });
      const body = Buffer.from(await r.arrayBuffer());
      if (r.status >= 500) { last = new Error(`${url}: HTTP ${r.status}`); continue; }
      return { status: r.status, type: r.headers.get("content-type") || "", body, text: body.toString("utf8") };
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const expectedVersion = process.env.EXPECT_VERSION ||
  (fs.existsSync(path.join(ROOT, "dist", "build.json")) ? JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8")).version : null);

const sitemap = await get(`${base}/sitemap.xml`);
const urls = [...sitemap.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (sitemap.status !== 200 || urls.length === 0) problems.push(`sitemap.xml: HTTP ${sitemap.status}, ${urls.length} URLs`);
for (const u of urls) {
  if (!u.startsWith(base + "/")) { problems.push(`sitemap lists a URL outside the site: ${u}`); continue; }
  try {
    const r = await get(u);
    const canonical = (r.text.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    if (r.status !== 200 || canonical !== u) problems.push(`${u}: HTTP ${r.status}, canonical ${canonical || "missing"}`);
    for (const img of r.text.matchAll(/<meta property="og:image" content="([^"]+)"/g)) {
      const i = await get(img[1]);
      if (i.status !== 200 || !i.type.startsWith("image/png") || i.body.length < 5000) problems.push(`${img[1]}: HTTP ${i.status} ${i.type} ${i.body.length} bytes`);
    }
  } catch (e) {
    problems.push(`${u}: ${e.message}`);
  }
}

const robots = await get(`${base}/robots.txt`);
if (!robots.text.includes(`Sitemap: ${base}/sitemap.xml`)) problems.push("robots.txt doesn't name the sitemap");
const key = await get(`${base}/${cfg.indexNowKey}.txt`);
if (key.status !== 200 || key.text.trim() !== cfg.indexNowKey) problems.push("the IndexNow key file isn't served");
const missing = await get(`${base}/this-page-does-not-exist-${Date.now()}/`);
if (missing.status !== 404) problems.push(`a missing page answered HTTP ${missing.status}, not 404`);

let stale = false;
try {
  const live = JSON.parse((await get(`${base}/build.json`)).text);
  if (!expectedVersion) {
    console.log(`live build ${live.version} (no local build to compare)`);
  } else if (live.version !== expectedVersion) {
    stale = true;
    problems.push(`the live site is build ${live.version}, but main builds ${expectedVersion}: the last deploy didn't go out`);
  } else {
    console.log(`live build ${live.version} matches main (built ${live.built})`);
  }
} catch (e) {
  problems.push(`build.json: ${e.message}`);
}

if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `stale=${stale}\n`);
console.log(`checked ${urls.length} pages at ${base}`);
for (const p of problems) console.log(`::error::${p}`);
process.exit(problems.length ? 1 : 0);
