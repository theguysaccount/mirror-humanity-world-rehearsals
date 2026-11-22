// The built site: pages, links, metadata, privacy (no third-party requests) and the optional keys.
// Builds use today's date and the real data, so nothing here depends on launch-day counts.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../scripts/build.mjs";
import { walk } from "../scripts/lib/build-lib.mjs";
import cfg from "../site.config.mjs";
import * as sim from "../site/assets/sim.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const SITE = "https://example.org/sr";

function buildInto(env = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "sr-build-"));
  const result = build({ out, env: { SITE_URL: SITE, ...env } });
  return { out, ...result };
}

const html = (out, p) => fs.readFileSync(path.join(out, p), "utf8");
const attrs = (page, tag, name) => [...page.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${name}="([^"]*)"`, "g"))].map((m) => m[1].replace(/&amp;/g, "&"));
const meta = (page, key) => (page.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`)) || [])[1];

const main = buildInto();
test.after(() => fs.rmSync(main.out, { recursive: true, force: true }));
const pages = walk(main.out).filter((f) => f.endsWith(".html")).map((f) => path.relative(main.out, f).split(path.sep).join("/"));

test("every page is built, and the sitemap lists exactly the indexable ones", () => {
  assert.deepEqual(pages.sort(), ["404.html", "about/index.html", "how-many-staff-do-i-need/index.html", "index.html", "method/index.html"]);
  const locs = [...html(main.out, "sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, main.urls);
  assert.deepEqual(locs.sort(), [`${SITE}/`, `${SITE}/about/`, `${SITE}/how-many-staff-do-i-need/`, `${SITE}/method/`]);
  assert.equal(html(main.out, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  assert.equal(html(main.out, `${cfg.indexNowKey}.txt`), cfg.indexNowKey);
  assert.match(cfg.indexNowKey, /^[0-9a-f]{32}$/);
});

test("each page has a title, a description, one canonical, a share image and valid structured data", () => {
  for (const p of pages) {
    const page = html(main.out, p);
    const canonical = attrs(page, "link", "href").filter((_, i, all) => page.includes(`<link rel="canonical" href="${all[i]}"`));
    assert.equal(canonical.length, 1, p);
    if (p !== "404.html") assert.equal(canonical[0], `${SITE}/${p.replace(/index\.html$/, "")}`, p);
    assert.ok(/<title>[^<]{15,}<\/title>/.test(page), `${p} title`);
    assert.ok((meta(page, "description") || "").length > 60, `${p} description`);
    const og = meta(page, "og:image");
    assert.ok(og.startsWith(`${SITE}/assets/og/`) && fs.existsSync(path.join(main.out, og.slice(SITE.length + 1))), `${p} og:image ${og}`);
    for (const m of page.matchAll(/<script type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) JSON.parse(m[1]);
    assert.equal((page.match(/<h1[\s>]/g) || []).length, 1, `${p} has one h1`);
    assert.equal(page.includes('<meta name="robots" content="noindex">'), p === "404.html", `${p} robots`);
  }
});

test("every internal link and asset resolves", () => {
  for (const p of pages.filter((x) => x !== "404.html")) {
    const page = html(main.out, p);
    for (const href of [...attrs(page, "a", "href"), ...attrs(page, "link", "href"), ...attrs(page, "script", "src")]) {
      if (/^(https?:|mailto:|#)/.test(href)) continue;
      const target = new URL(href, `http://x/${p}`).pathname.replace(/^\//, "");
      const file = target === "" || target.endsWith("/") ? target + "index.html" : target;
      assert.ok(fs.existsSync(path.join(main.out, file)), `${p} -> ${href}`);
    }
  }
  const notFound = html(main.out, "404.html");
  assert.ok(notFound.includes('href="/sr/assets/site.css'), "the 404 page uses absolute paths");
});

test("no page loads anything from another site by default, and the policy says so", () => {
  for (const p of pages) {
    const page = html(main.out, p);
    for (const src of [...attrs(page, "script", "src"), ...attrs(page, "link", "href").filter((h) => /\.(css|js)(\?|$)/.test(h))]) {
      assert.ok(!/^(https?:)?\/\//.test(src), `${p} loads ${src}`);
    }
    const csp = meta(page, "Content-Security-Policy") || page.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
    assert.match(csp.replace(/&#39;/g, "'"), /default-src 'none'; script-src 'self';/, p);
  }
  for (const f of walk(path.join(main.out, "assets")).filter((f) => f.endsWith(".js"))) {
    const src = fs.readFileSync(f, "utf8");
    assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(src), `${path.basename(f)} makes network requests`);
  }
});

test("module imports carry the build version, and the version ignores the build date", () => {
  const v = main.site.version;
  assert.ok(html(main.out, "index.html").includes(`assets/app.js?v=${v}`));
  assert.ok(html(main.out, "assets/app.js").includes(`from "./sim.js?v=${v}"`));
  assert.ok(html(main.out, "assets/art.js").includes(`from "./sim.js?v=${v}"`));
  assert.equal(JSON.parse(html(main.out, "build.json")).version, v);
  const other = buildInto({ BUILD_DATE: "2030-01-01" });
  try {
    assert.equal(other.site.version, v);
  } finally {
    fs.rmSync(other.out, { recursive: true, force: true });
  }
});

test("every page says results are simulations, not forecasts", () => {
  for (const p of pages) assert.ok(html(main.out, p).includes("<b>Simulations, not forecasts.</b>"), p);
});

test("the staffing table and the method page's checks come from the model itself", () => {
  const staffPage = html(main.out, "how-many-staff-do-i-need/index.html");
  assert.ok(staffPage.includes(`<td class="num">${sim.staffNeeded({ perHour: 100, serviceMinutes: 3, targetMinutes: 3, level: 0.8 })}</td>`));
  const method = html(main.out, "method/index.html");
  for (const c of main.checks) assert.ok(method.includes(`${c.theoryWait.toFixed(2)} min`), c.label);
});

test("the keys switch on analytics and the paid slot, and refuse non-https links", () => {
  const keyed = buildInto({ GOATCOUNTER_URL: "https://x.goatcounter.com/count", STUDIES_URL: "https://example.org/studies", STUDIES_LABEL: "Scored studies" });
  try {
    const home = html(keyed.out, "index.html");
    assert.ok(home.includes('data-goatcounter="https://x.goatcounter.com/count" async src="https://gc.zgo.at/count.js"'));
    assert.match(home.replace(/&#39;/g, "'"), /script-src 'self' https:\/\/gc\.zgo\.at;.*connect-src 'self' https:\/\/x\.goatcounter\.com/);
    assert.ok(home.includes('href="https://example.org/studies" rel="noopener sponsored">Scored studies<'));
    assert.ok(html(keyed.out, "about/index.html").includes("Visits are counted with GoatCounter"));
    assert.notEqual(keyed.site.version, main.site.version);
  } finally {
    fs.rmSync(keyed.out, { recursive: true, force: true });
  }
  assert.throws(() => buildInto({ STUDIES_URL: "http://example.org/studies" }), /https/);
  const moving = buildInto({ MOVE_NOTICE_URL: "https://climb.example.com/" });
  try {
    assert.ok(html(moving.out, "index.html").includes('id="move-notice">Shift Rehearsal is moving to <a href="https://climb.example.com/">climb.example.com</a>'));
  } finally {
    fs.rmSync(moving.out, { recursive: true, force: true });
  }
  assert.ok(!html(main.out, "index.html").includes("move-notice"), "no move notice by default");
  assert.ok(!html(main.out, "index.html").includes("sponsored"), "the paid slot is hidden by default");
});

test("a custom domain at the root builds with root paths", () => {
  const root = buildInto({ SITE_URL: "https://climb.example.com" });
  try {
    assert.ok(html(root.out, "404.html").includes('href="/assets/site.css'));
    assert.ok(html(root.out, "robots.txt").includes("Sitemap: https://climb.example.com/sitemap.xml"));
    assert.ok(html(root.out, "index.html").includes('<link rel="canonical" href="https://climb.example.com/">'));
  } finally {
    fs.rmSync(root.out, { recursive: true, force: true });
  }
});
