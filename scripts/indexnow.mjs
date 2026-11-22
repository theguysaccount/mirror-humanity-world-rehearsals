#!/usr/bin/env node
// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver and others) about every URL in the live
// sitemap. The key file (<key>.txt) is published at the site root by the build.
//
//   node scripts/indexnow.mjs [site-url]
//
// Never fails the deploy: the site is already live, and the next deploy submits again.
import cfg from "../site.config.mjs";

const base = (process.argv[2] || process.env.SITE_URL || cfg.defaultSiteUrl).replace(/\/+$/, "");
const host = new URL(base).hostname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const sitemap = await (await fetch(`${base}/sitemap.xml`, { signal: AbortSignal.timeout(30000) })).text();
  const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).filter((u) => new URL(u).hostname === host).slice(0, 10000);
  if (!urlList.length) throw new Error("the live sitemap has no URLs");
  const body = JSON.stringify({ host, key: cfg.indexNowKey, keyLocation: `${base}/${cfg.indexNowKey}.txt`, urlList });
  // A new key can answer 403 until the engine has fetched the key file, so retry a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(30000 * attempt);
    try {
      const r = await fetch("https://api.indexnow.org/indexnow", {
        method: "POST", body, headers: { "Content-Type": "application/json; charset=utf-8" }, signal: AbortSignal.timeout(30000),
      });
      console.log(`IndexNow: HTTP ${r.status} for ${urlList.length} URLs`);
      if (r.status < 300) process.exit(0);
      if (![403, 429].includes(r.status) && r.status < 500) break;
    } catch (e) {
      console.log(`IndexNow: ${e.message}`);
    }
  }
  console.log("::warning::IndexNow submission didn't succeed; the next deploy will try again");
} catch (e) {
  console.log(`::warning::IndexNow skipped: ${e.message}`);
}
