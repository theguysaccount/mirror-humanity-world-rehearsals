#!/usr/bin/env node
// Build the Shift Rehearsal static site into dist/. Node 22+, no dependencies.
//
//   node scripts/build.mjs [--out dist]
//
// Optional environment (GitHub repository variables in CI; see OPERATIONS.md):
//   SITE_URL         canonical origin + path, no trailing slash (default: the GitHub Pages URL)
//   GOATCOUNTER_URL  e.g. https://example.goatcounter.com/count -> cookieless visit counts on
//   STUDIES_URL      link to paid saved and scored studies on other hosting (with STUDIES_LABEL); hidden when empty
//   MOVE_NOTICE_URL  the new address, a few weeks before a domain move (reality checks are saved per address)
//   BUILD_DATE       YYYY-MM-DD, to reproduce a build
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import cfg from "../site.config.mjs";
import { Site, esc, attr, copyDir, versionModuleImports } from "./lib/build-lib.mjs";
import * as sim from "../site/assets/sim.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#3b2a6b"/><circle cx="18" cy="38" r="6" fill="#ffd166"/><circle cx="32" cy="38" r="6" fill="#ffd166" opacity="0.8"/><circle cx="46" cy="38" r="6" fill="#ffd166" opacity="0.55"/><rect x="12" y="16" width="40" height="8" rx="4" fill="#9f8cff"/><path d="M14 52h36" stroke="#9f8cff" stroke-width="4" stroke-linecap="round"/></svg>';
const NAV = [["", "Rehearse a shift"], ["how-many-staff-do-i-need/", "How many staff?"], ["method/", "Method and checks"], ["about/", "About"]];

// The validation cases published on the method page and checked by the tests: steady arrivals for
// 24 hours, exponential service, nobody leaves, so the textbook (Erlang C) answer applies.
export const VALIDATION_CASES = [
  { perHour: 48, serviceMinutes: 1, staff: 1, label: "One server, 80% busy" },
  { perHour: 180, serviceMinutes: 1, staff: 4, label: "Four servers, 75% busy" },
  { perHour: 100, serviceMinutes: 2.5, staff: 5, label: "Café-like: five staff, 83% busy" },
  { perHour: 30, serviceMinutes: 8, staff: 5, label: "Desk-like: five staff, 80% busy" },
];

export function validation() {
  return VALIDATION_CASES.map((c) => {
    const r = sim.rehearse({ name: "check", open: 0, arrivals: Array(24).fill(c.perHour), baseline: Array(24).fill(c.staff), plan: Array(24).fill(c.staff),
      serviceMinutes: c.serviceMinutes, variability: "high", patienceMinutes: null, wage: 0, targetMinutes: 1, level: 80, runs: 100 });
    const theory = sim.steadyState({ perHour: c.perHour, serviceMinutes: c.serviceMinutes, staff: c.staff, targetMinutes: 1 });
    return { ...c, theoryWait: theory.meanWait, simWait: r.baseline.meanWait.mean, theoryWithin: theory.withinTarget, simWithin: r.baseline.withinTarget.mean,
      little: Math.abs(r.baseline.meanLine.mean - (c.perHour / 60) * r.baseline.meanWait.mean) };
  });
}

function httpsUrl(value, name) {
  if (!value) return "";
  let u;
  try { u = new URL(value); } catch { throw new Error(`${name} is not a URL: ${value}`); }
  if (u.protocol !== "https:") throw new Error(`${name} must start with https://`);
  return u.href;
}

export function build({ out = path.join(ROOT, "dist"), env = process.env } = {}) {
  const settings = {
    goatcounterUrl: httpsUrl((env.GOATCOUNTER_URL || "").trim(), "GOATCOUNTER_URL"),
    studiesUrl: httpsUrl((env.STUDIES_URL || "").trim(), "STUDIES_URL"),
    studiesLabel: (env.STUDIES_LABEL || "").trim() || "Saved, scored studies",
    moveNoticeUrl: httpsUrl((env.MOVE_NOTICE_URL || "").trim(), "MOVE_NOTICE_URL"),
  };
  const site = new Site({ root: ROOT, out, cfg, env, settings, inputs: ["site", "site.config.mjs", "scripts/build.mjs", "scripts/lib/build-lib.mjs"] });
  fs.rmSync(out, { recursive: true, force: true });
  copyDir(path.join(ROOT, "site", "assets"), path.join(out, "assets"));
  versionModuleImports(path.join(out, "assets"), site.version);
  fs.copyFileSync(path.join(ROOT, "site", "favicon.svg"), path.join(out, "favicon.svg"));
  site.write("site.webmanifest", JSON.stringify({
    name: cfg.brand, short_name: cfg.brand, description: "Rehearse a shift before you staff it.", start_url: "./", scope: "./", display: "standalone",
    background_color: "#f6f5fb", theme_color: cfg.themeColor,
    icons: [{ src: "assets/icon-192.png", sizes: "192x192", type: "image/png" }, { src: "assets/icon-512.png", sizes: "512x512", type: "image/png" }, { src: "favicon.svg", sizes: "any", type: "image/svg+xml" }],
  }, null, 1));

  const privacy = "Everything runs in your browser: no account, nothing uploaded. Scenarios live in the link; reality checks stay in this browser." +
    (settings.goatcounterUrl ? " Visits are counted with GoatCounter (no cookies, no personal data, never your numbers)." : "");
  const layout = (page, body) => `<!doctype html>
<html lang="en">
<head>
${site.head(page)}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head"><div class="wrap">
<a class="logo" href="${page.root}">${LOGO}Shift Rehearsal</a>
<nav class="nav" aria-label="Main">${NAV.map(([p, t]) => `<a href="${page.root}${p}"${p === page.path ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>
</div></header>
<main id="main" class="wrap${page.narrow ? " narrow" : ""}">
${body}
</main>
<footer class="site-foot"><div class="wrap">
<nav aria-label="Footer">${NAV.map(([p, t]) => `<a href="${page.root}${p}">${t}</a>`).join("")}<a href="${cfg.repoUrl}">Source code</a>${settings.studiesUrl ? `<a href="${attr(settings.studiesUrl)}" rel="noopener sponsored">${esc(settings.studiesLabel)}</a>` : ""}</nav>
<p><b>Simulations, not forecasts.</b> Results show what the stated assumptions imply. They aren't predictions about any real business.</p>
<p>${privacy}</p>
</div></footer>
</body>
</html>
`;

  // ---- the tool ------------------------------------------------------------------------------------
  site.page({
    path: "", og: "home",
    title: "Shift Rehearsal: how many staff do I need? Free queue and wait-time simulator",
    ogTitle: "Rehearse a shift before you staff it",
    description: "Compare your current staffing with a plan, hour by hour: average waits, people who give up, idle staff hours and cost, simulated over hundreds of days. Every assumption visible. Free, no sign-up.",
    modules: ["app.js"], data: { "site-config": { siteUrl: site.siteUrl } },
    jsonld: [{
      "@context": "https://schema.org", "@type": "WebApplication", name: cfg.brand, url: site.url(""), applicationCategory: "BusinessApplication",
      operatingSystem: "Any", browserRequirements: "Requires JavaScript", isAccessibleForFree: true, inLanguage: "en", offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      description: "A free staffing and queue simulator for cafés, service desks and events: compare a baseline and a plan with every assumption labelled. Simulations, not forecasts.",
    }],
  }, (page) => layout(page, `
<section class="hero">
<p class="eyebrow">A staffing and queue simulator for small operators</p>
<h1>Rehearse a shift before you staff it.</h1>
<p class="lede">Put in how many customers you expect each hour, how long serving one takes, and two staffing plans. Shift Rehearsal plays the day hundreds of times and shows the waits, the people who give up, the idle hours and the cost of each plan, side by side.</p>
</section>
${settings.moveNoticeUrl ? `<p class="msg" id="move-notice">Shift Rehearsal is moving to <a href="${attr(settings.moveNoticeUrl)}">${esc(new URL(settings.moveNoticeUrl).host)}</a>. Scenario links keep working; reality checks are saved per web address, so note them down if you need them.</p>` : ""}
<p id="live" class="sr-only" aria-live="polite"></p>
<section class="panel" aria-labelledby="in-h"><h2 id="in-h">Your shift</h2>
<form id="scenario" novalidate><noscript><p class="msg warn">The simulator needs JavaScript. You can still read <a href="how-many-staff-do-i-need/">how many staff you need</a>, with a table worked out from the textbook formula.</p></noscript></form>
<p class="msg warn" id="form-error" role="alert" hidden></p></section>
<div id="results"></div>`));

  // ---- how many staff guide ---------------------------------------------------------------------------
  const perHours = [10, 20, 30, 40, 60, 80, 100, 120, 160, 200];
  const services = [1, 2, 3, 5, 8, 12];
  const target = { minutes: 3, level: 0.8 };
  const table = perHours.map((ph) => `<tr><th scope="row">${ph}</th>${services.map((m) => `<td class="num">${sim.staffNeeded({ perHour: ph, serviceMinutes: m, targetMinutes: target.minutes, level: target.level })}</td>`).join("")}</tr>`).join("");
  const worked = sim.steadyState({ perHour: 40, serviceMinutes: 3, staff: 3, targetMinutes: 3 });
  site.page({
    path: "how-many-staff-do-i-need/", og: "staff", narrow: true,
    title: "How many staff do I need? A queue-based staffing table and calculator",
    description: "How many people to have on shift for a given number of customers per hour and service time, from the queueing formula businesses use (Erlang C), with a free simulator to check it for your day.",
    jsonld: [{ "@context": "https://schema.org", "@type": "Article", headline: "How many staff do I need?", dateModified: site.today, mainEntityOfPage: site.url("how-many-staff-do-i-need/"), inLanguage: "en", author: { "@type": "Organization", name: cfg.brand }, publisher: { "@type": "Organization", name: cfg.brand } }],
  }, (page) => layout(page, `
<article class="prose">
<h1>How many staff do I need?</h1>
<p class="lede">It depends on three numbers you can measure: how many customers arrive in an hour, how long serving one takes, and how long you're willing to let them wait. Here's the arithmetic, a table to start from, and why the answer is usually one more person than "enough to keep up".</p>
<h2>Step 1: the workload</h2>
<p>Multiply customers per hour by minutes per customer and divide by 60. That's how many people would be busy every single minute if customers arrived perfectly evenly. At 40 customers an hour and 3 minutes each, it's 2: two people fully busy.</p>
<h2>Step 2: add room for bunching</h2>
<p>Customers don't arrive evenly. They bunch, and every bunch makes a line that the next quiet spell has to clear. With exactly enough staff to keep up on average, lines grow without limit. With 40 customers an hour at 3 minutes each, the textbook formula (Erlang C, used by call centres since the 1910s) gives:</p>
<ul>
<li><b>2 staff:</b> busy 100% of the time; the line never clears.</li>
<li><b>3 staff:</b> busy ${Math.round(worked.utilization * 100)}% of the time; ${Math.round(worked.pWait * 100)}% of customers wait at all, ${Math.round(worked.withinTarget * 100)}% are served within 3 minutes, and the average wait is ${worked.meanWait.toFixed(1)} minutes.</li>
</ul>
<h2>A table to start from</h2>
<p>Fewest staff to serve 80% of customers within 3 minutes, in a steady hour, if service times vary a lot and nobody gives up. Rows: customers per hour. Columns: average minutes to serve one.</p>
<div class="table-wrap"><table class="staff-table"><thead><tr><th>Customers / hour</th>${services.map((m) => `<th class="num">${m} min</th>`).join("")}</tr></thead><tbody>${table}</tbody></table></div>
<h2>Step 3: rehearse your real day</h2>
<p>The table assumes a steady hour. Real shifts have rushes, staff who arrive and leave on the hour, and customers who give up. That's what the <a href="../">simulator</a> is for: put in your own hourly numbers and compare your current rota with a plan. It also shows the formula's suggestion for every hour.</p>
<h2>Where the numbers come from</h2>
<ul>
<li><b>Customers per hour:</b> till receipts or ticket timestamps, grouped by hour, averaged over a few similar days.</li>
<li><b>Service time:</b> time a dozen customers with a stopwatch, from "next please" to done.</li>
<li><b>Patience:</b> watch how long people stand in line before walking away, or start with 5 to 10 minutes.</li>
</ul>
<p><a class="btn" href="../">Rehearse your shift</a></p>
</article>`));

  // ---- method -----------------------------------------------------------------------------------------
  const checks = validation();
  site.page({
    path: "method/", og: "home", narrow: true,
    title: "Shift Rehearsal's method: the queue model, its assumptions and how it's checked",
    description: "How Shift Rehearsal simulates a shift (random arrivals, one first-come-first-served line, staff changes on the hour, people who give up), and how its results are checked against the textbook formula every week.",
  }, (page) => layout(page, `
<article class="prose">
<h1>Method and checks</h1>
<p class="lede">Shift Rehearsal is a small discrete-event simulation that runs in your browser. It's written to be checked: the rules are below, the code is public, and the results are compared with the textbook formula every week.</p>
<h2>The model</h2>
<ul>
<li><b>Arrivals:</b> random, at the average rate you give for each hour (a Poisson process whose rate changes on the hour).</li>
<li><b>Service:</b> one line, first come first served. Service times are random around your average, with the variability you choose (a gamma distribution; "high" is exponential).</li>
<li><b>Staff:</b> the number on duty can change every hour. Someone going off duty finishes the customer they're serving first.</li>
<li><b>Giving up:</b> each customer has a random patience (exponential, around your average). If service hasn't started by then, they leave.</li>
<li><b>Closing:</b> no one new arrives after closing; people already in line are served, and that time is paid as overtime.</li>
<li><b>Paired days:</b> both plans see exactly the same customers on each simulated day, so differences come from staffing, not luck.</li>
<li><b>Same inputs, same results:</b> the random numbers are seeded from the scenario, so a link always reproduces the same numbers.</li>
</ul>
<h2>The weekly check against the textbook</h2>
<p>For steady arrivals, exponential service and nobody giving up, queueing theory gives an exact long-run answer (Erlang C). Each week the self-test runs these cases through the simulator for 100 simulated 24-hour days and fails if they drift apart. Results from this build:</p>
<div class="table-wrap"><table><thead><tr><th>Case</th><th class="num">Formula: average wait</th><th class="num">Simulated</th><th class="num">Formula: served within 1 min</th><th class="num">Simulated</th></tr></thead><tbody>
${checks.map((c) => `<tr><th scope="row">${esc(c.label)} (${c.perHour}/h, ${c.serviceMinutes} min)</th><td class="num">${c.theoryWait.toFixed(2)} min</td><td class="num">${c.simWait.toFixed(2)} min</td><td class="num">${(c.theoryWithin * 100).toFixed(1)}%</td><td class="num">${(c.simWithin * 100).toFixed(1)}%</td></tr>`).join("")}
</tbody></table></div>
<p>Simulated days start with an empty shop, so at high utilisation they wait slightly less than the long-run formula, which assumes a line that's been running forever. Little's law (average line = arrival rate × average wait) holds in every case to within ${Math.max(...checks.map((c) => c.little)).toFixed(2)} people.</p>
<h2>What it doesn't know</h2>
<ul>
<li>Your real arrival pattern, service times and patience: they're your assumptions, and the results are only as good as they are.</li>
<li>Several lines, priority customers, staff doing other work between customers, breaks, or customers who come back later.</li>
<li>Anything about demand: more staff may bring more customers, or none.</li>
</ul>
<p>That's why results are labelled simulations, not forecasts, and why the tool has a reality check: write down what happened after a real shift and see how far off the simulation was.</p>
</article>`));

  // ---- about -------------------------------------------------------------------------------------
  site.page({
    path: "about/", og: "home", narrow: true,
    title: "About Shift Rehearsal: free, private, and honest about what it can't know",
    description: "Shift Rehearsal is a free, open-source staffing simulator that runs entirely in your browser. What it stores (nothing on a server), how links work, and why it calls its results simulations.",
  }, (page) => layout(page, `
<article class="prose">
<h1>About Shift Rehearsal</h1>
<p class="lede">A free tool for the people who make the rota: café and shop owners, clinic and front-desk managers, event organisers. It answers one question well: what does this staffing plan do to waits, walk-outs and cost, compared with what we do now?</p>
<h2>What it stores</h2>
<ul>
<li><b>Scenarios live in the link.</b> The address bar holds every input, so you can bookmark or share a scenario. Nothing is sent to a server; the simulation runs in your browser.</li>
<li><b>Reality checks stay in this browser</b> (local storage), and you can remove them any time.</li>
<li>${settings.goatcounterUrl ? "<b>Visit counts</b> come from GoatCounter, which uses no cookies and collects no personal data. Your numbers are never part of it." : "<b>No analytics.</b> The page loads no trackers and no third-party scripts."}</li>
</ul>
<h2>Simulations, not forecasts</h2>
<p>Every result is what the stated assumptions imply, averaged over many simulated days, with the range in which most days fall. It doesn't predict what will happen at your business, and it says so next to every number.</p>
<h2>Open source</h2>
<p>The code is on <a href="${cfg.repoUrl}">GitHub</a> under the MIT license, including the weekly check against the textbook formula. Problems or ideas: <a href="${cfg.repoUrl}/issues">open an issue</a>.</p>
${settings.studiesUrl ? `<h2>Saved, scored studies</h2><p class="sponsor">The simulator is free and stays free. For saved scenarios with a running accuracy score across many reality checks: <a href="${attr(settings.studiesUrl)}" rel="noopener sponsored">${esc(settings.studiesLabel)}</a>.</p>` : ""}
</article>`));

  site.page({
    path: "404.html", root: site.basePath, noindex: true, narrow: true,
    title: "Page not found | Shift Rehearsal",
    description: "That page doesn't exist. Go back to Shift Rehearsal to compare staffing plans for your shift.",
  }, (page) => layout(page, `<h1>Page not found</h1><p class="lede">That page doesn't exist.</p><p><a class="btn" href="${site.basePath}">Rehearse a shift</a></p>`));

  const urls = site.finish();
  return { site, urls, checks };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf("--out");
  const out = i === -1 ? path.join(ROOT, "dist") : path.resolve(process.argv[i + 1]);
  const { site, urls } = build({ out });
  console.log(`built ${urls.length} pages into ${path.relative(process.cwd(), out) || "."} (version ${site.version}, ${site.siteUrl})`);
}
