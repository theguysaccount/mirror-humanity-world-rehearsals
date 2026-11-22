// Serve a built site from a folder under a path prefix, the way GitHub Pages serves a project site
// (https://owner.github.io/<repo>/), so relative-link mistakes show up locally. No dependencies.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json", ".csv": "text/csv; charset=utf-8",
};

export function serve(dir, { prefix = "/", port = 0 } = {}) {
  const root = path.resolve(dir);
  const base = "/" + prefix.replace(/^\/+|\/+$/g, "");
  const mount = base === "/" ? "/" : base + "/";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let p = decodeURIComponent(url.pathname);
    const send = (status, file) => {
      res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(file).pipe(res);
    };
    const notFound = () => {
      const f = path.join(root, "404.html");
      if (fs.existsSync(f)) return send(404, f);
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    };
    if (mount !== "/" && p === base) { res.writeHead(301, { Location: mount }); return res.end(); }
    if (!p.startsWith(mount)) return notFound();
    let file = path.join(root, p.slice(mount.length));
    if (!file.startsWith(root)) return notFound();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!p.endsWith("/")) { res.writeHead(301, { Location: p + "/" + url.search }); return res.end(); }
      file = path.join(file, "index.html");
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound();
    send(200, file);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${server.address().port}${mount}`,
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

// node scripts/lib/serve.mjs [dir] [prefix] [port]: serve a folder until stopped.
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = await serve(process.argv[2] || "dist", { prefix: process.argv[3] || "/", port: Number(process.argv[4]) || 0 });
  console.log(s.url);
}
