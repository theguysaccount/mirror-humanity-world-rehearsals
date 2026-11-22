// Static-site helpers shared by scripts/build.mjs. Node 22+, no dependencies.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const attr = (s) => esc(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// JSON that is safe inside a <script> data block.
export const jsonScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c");

export function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return [dir];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.name !== ".DS_Store")
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
}

// One short hash over every input that decides what the site contains. The build date is left out
// on purpose, so the same sources always give the same version (the self-test compares the live
// site's version with the repository's to spot a deploy that never happened).
export function contentVersion(root, inputs, settings) {
  const h = crypto.createHash("sha1");
  for (const input of inputs) {
    for (const f of walk(path.join(root, input))) {
      h.update(path.relative(root, f).split(path.sep).join("/"));
      h.update(fs.readFileSync(f));
    }
  }
  h.update(JSON.stringify(settings));
  return h.digest("hex").slice(0, 10);
}

export function copyDir(src, dst) {
  for (const f of walk(src)) {
    const to = path.join(dst, path.relative(src, f));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
  }
}

// Browsers cache ES modules by URL, so every relative import gets the build version appended.
export function versionModuleImports(dir, ver) {
  for (const f of walk(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(f, "utf8");
    const out = src
      .replace(/(from\s+["'])(\.\.?\/[^"']+\.js)(["'])/g, `$1$2?v=${ver}$3`)
      .replace(/(import\(\s*["'])(\.\.?\/[^"']+\.js)(["']\s*\))/g, `$1$2?v=${ver}$3`);
    if (out !== src) fs.writeFileSync(f, out);
  }
}

// A Content-Security-Policy that only lets the page load its own files. With an analytics key set,
// the one counter script and its endpoint are added; nothing else can be loaded or contacted.
export function contentSecurityPolicy(goatcounterUrl) {
  let script = "'self'";
  let img = "'self' data: blob:";
  let connect = "'self'";
  if (goatcounterUrl) {
    const origin = new URL(goatcounterUrl).origin;
    script += " https://gc.zgo.at";
    img += " " + origin;
    connect += " " + origin;
  }
  return [
    "default-src 'none'", `script-src ${script}`, "style-src 'self'", `img-src ${img}`, "font-src 'self'",
    `connect-src ${connect}`, "manifest-src 'self'", "base-uri 'self'", "form-action 'none'",
  ].join("; ");
}

export class Site {
  constructor({ root, out, cfg, env = process.env, inputs, settings = {} }) {
    this.root = root;
    this.out = out;
    this.cfg = cfg;
    this.siteUrl = (env.SITE_URL || cfg.defaultSiteUrl).replace(/\/+$/, "");
    this.basePath = new URL(this.siteUrl + "/").pathname; // "/repo/" on project Pages, "/" on a domain
    this.today = env.BUILD_DATE || new Date().toISOString().slice(0, 10);
    this.commit = env.GITHUB_SHA || null;
    this.settings = settings;
    this.version = contentVersion(root, inputs, { siteUrl: this.siteUrl, ...settings });
    this.pages = [];
  }

  url(p = "") {
    return `${this.siteUrl}/${p}`;
  }

  rootFor(p) {
    const depth = p.split("/").length - 1;
    return depth ? "../".repeat(depth) : "./";
  }

  write(rel, content) {
    const f = path.join(this.out, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }

  // Everything inside <head>. `page`: { path, title, description, og, jsonld, data, modules, noindex, root }
  head(page) {
    const { cfg } = this;
    const root = page.root ?? this.rootFor(page.path);
    const v = this.version;
    const canonical = this.url(page.path);
    const og = `${this.siteUrl}/assets/og/${page.og || "home"}.png`;
    const lines = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      `<meta http-equiv="Content-Security-Policy" content="${attr(contentSecurityPolicy(this.settings.goatcounterUrl))}">`,
      '<meta name="referrer" content="strict-origin-when-cross-origin">',
      `<title>${esc(page.title)}</title>`,
      `<meta name="description" content="${attr(page.description)}">`,
      `<link rel="canonical" href="${attr(canonical)}">`,
      page.noindex ? '<meta name="robots" content="noindex">' : "",
      '<meta property="og:type" content="website">',
      `<meta property="og:site_name" content="${attr(cfg.brand)}">`,
      `<meta property="og:title" content="${attr(page.ogTitle || page.title)}">`,
      `<meta property="og:description" content="${attr(page.description)}">`,
      `<meta property="og:url" content="${attr(canonical)}">`,
      `<meta property="og:image" content="${attr(og)}">`,
      '<meta property="og:image:width" content="1200">',
      '<meta property="og:image:height" content="630">',
      '<meta name="twitter:card" content="summary_large_image">',
      `<meta name="theme-color" content="${attr(cfg.themeColor)}">`,
      `<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">`,
      cfg.touchIcon ? `<link rel="apple-touch-icon" href="${root}${cfg.touchIcon}">` : "",
      cfg.manifest ? `<link rel="manifest" href="${root}${cfg.manifest}">` : "",
      `<link rel="stylesheet" href="${root}assets/site.css?v=${v}">`,
      ...(page.jsonld || []).map((b) => `<script type="application/ld+json">${jsonScript(b)}</script>`),
      ...Object.entries(page.data || {}).map(([id, value]) => `<script type="application/json" id="${attr(id)}">${jsonScript(value)}</script>`),
      ...(page.modules || []).map((m) => `<script type="module" src="${root}assets/${m}?v=${v}"></script>`),
      this.settings.goatcounterUrl
        ? `<script data-goatcounter="${attr(this.settings.goatcounterUrl)}" async src="https://gc.zgo.at/count.js"></script>`
        : "",
    ];
    return lines.filter(Boolean).join("\n");
  }

  // Register and write a page. `render(page, root)` returns the full HTML document.
  page(page, render) {
    const root = page.root ?? this.rootFor(page.path);
    const file = page.path === "" || page.path.endsWith("/") ? page.path + "index.html" : page.path;
    this.write(file, render({ ...page, root }, root));
    if (!page.noindex) this.pages.push(page.path);
  }

  finish() {
    const urls = this.pages.map((p) => this.url(p));
    this.write("sitemap.xml",
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map((u) => `<url><loc>${esc(u)}</loc><lastmod>${this.today}</lastmod></url>\n`).join("") + "</urlset>\n");
    this.write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${this.siteUrl}/sitemap.xml\n`);
    this.write(`${this.cfg.indexNowKey}.txt`, this.cfg.indexNowKey);
    this.write("build.json", JSON.stringify({ version: this.version, built: new Date().toISOString(), commit: this.commit }) + "\n");
    return urls;
  }
}
