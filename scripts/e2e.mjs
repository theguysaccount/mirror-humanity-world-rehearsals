#!/usr/bin/env node
// End-to-end test: uses Shift Rehearsal in headless Chrome as a café owner would, on desktop and phone.
//
//   node scripts/e2e.mjs                 # build output in dist/, served locally under the site's path
//   node scripts/e2e.mjs https://host/x/ # a live site
//   node scripts/e2e.mjs --live          # the live site from SITE_URL or site.config.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import cfg from "../site.config.mjs";
import { launch } from "./lib/chrome.mjs";
import { serve } from "./lib/serve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = process.argv[2];
const siteUrl = (process.env.SITE_URL || cfg.defaultSiteUrl).replace(/\/+$/, "");
let server = null;
let base;
if (arg === "--live") base = siteUrl + "/";
else if (arg) base = arg.replace(/\/+$/, "") + "/";
else {
  server = await serve(path.join(ROOT, "dist"), { prefix: new URL(siteUrl + "/").pathname });
  base = server.url;
}
const origin = new URL(base).origin;
const READY = "document.documentElement.dataset.ready === '1'";
let failures = 0;

async function step(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL  ${name}\n        ${e.message.split("\n").join("\n        ")}`);
  }
}
const expect = (cond, what) => { if (!cond) throw new Error(what); };
const equal = (got, want, what) => { if (got !== want) throw new Error(`${what}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); };
const metric = (page, key) => page.eval(`document.querySelector('[data-metric="${key}"]').firstChild.textContent.trim()`);
const headline = (page) => page.text("[data-headline]");
async function setInput(page, name, value) {
  await page.eval(`(() => { const el = document.querySelector('#scenario [name="${name}"]'); el.value = ${JSON.stringify(String(value))}; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`);
}
async function rerun(page, before) {
  await page.waitFor(`document.querySelector('[data-headline]')?.textContent !== ${JSON.stringify(before)}`, { what: "the results to update" });
}
function checkClean(page, label) {
  expect(page.errors.length === 0, `${label}: console errors:\n${page.errors.join("\n")}`);
  const foreign = page.requests.filter((u) => !u.startsWith(origin) && !u.startsWith("data:") && !u.startsWith("blob:"));
  expect(foreign.length === 0, `${label}: requests to other origins:\n${foreign.join("\n")}`);
}

let shareUrl = null;
let sharedHeadline = null;

async function owner(browser) {
  const page = await browser.newPage({ width: 1280, height: 900 });
  await step("the café example runs on arrival, labelled a simulation", async () => {
    await page.goto(base, { ready: READY });
    await page.eval("localStorage.clear()");
    await page.reload({ ready: READY });
    expect((await page.text(".banner")).includes("A simulation, not a forecast"), "banner");
    equal(await page.eval("document.querySelectorAll('table.hours tbody tr').length"), 8, "hours");
    expect(Number((await metric(page, "withinTarget-plan")).replace("%", "")) > Number((await metric(page, "withinTarget-baseline")).replace("%", "")), "the plan serves more within target");
    expect((await page.eval("location.search")).includes("arr=30.55.40"), "the scenario is in the address");
    expect(await page.exists("svg.wait-chart polyline.plan-line"), "chart");
    equal(await page.eval("document.querySelectorAll('.assumptions li').length"), 10, "assumptions listed");
  });
  await step("changing an input re-runs the rehearsal and updates the link", async () => {
    const before = await headline(page);
    await setInput(page, "arr-1", 80);
    await rerun(page, before);
    expect((await page.eval("location.search")).includes("arr=30.80.40"), "address updated");
  });
  await step("examples switch the whole scenario", async () => {
    const before = await headline(page);
    await page.click('[data-preset="desk"]');
    await rerun(page, before);
    equal(await page.eval("document.querySelector('#scenario [name=svc]').value"), "12", "service time");
    expect((await page.text(".assumptions")).includes("Open 9am to 5pm"), "assumptions follow");
  });
  await step("the formula's suggestion becomes the plan; hours can be added and removed", async () => {
    await page.click('[data-action="suggest"]');
    await page.waitFor("[...document.querySelectorAll('table.hours tbody tr')].every((tr) => tr.querySelector('[name^=plan]').value === tr.querySelector('td.suggest').textContent)", { what: "plan = suggestion" });
    await page.click('[data-action="add-hour"]');
    await page.waitFor("document.querySelectorAll('table.hours tbody tr').length === 9", { what: "an added hour" });
    await page.click('[data-action="remove-hour"]');
    await page.waitFor("document.querySelectorAll('table.hours tbody tr').length === 8", { what: "a removed hour" });
  });
  await step("'nobody leaves' means nobody leaves", async () => {
    const before = await headline(page);
    await page.eval("document.querySelector('#scenario [name=nopat]').click()");
    await rerun(page, before);
    equal(await page.eval("document.querySelector('#scenario [name=pat]').disabled"), true, "patience disabled");
    equal(await metric(page, "left-baseline"), "0.0", "nobody left");
    expect((await page.text(".assumptions")).includes("Nobody leaves the line"), "assumption says so");
  });
  await step("bad input is refused with a message, not a crash", async () => {
    await setInput(page, "svc", "0");
    await page.waitFor("!document.querySelector('#form-error').hidden", { what: "the error" });
    expect((await page.text("#form-error")).includes("service time"), "message");
    await setInput(page, "svc", "12");
    await page.waitFor("document.querySelector('#form-error').hidden", { what: "the error to clear" });
  });
  await step("downloads: a summary with every assumption, and hour-by-hour CSV", async () => {
    const summary = await page.download(() => page.click('[data-action="summary"]'));
    expect(summary.text.includes("A simulation, not a forecast") && summary.text.includes("ASSUMPTIONS") && summary.text.includes("Reproduce it:"), "summary");
    const csv = await page.download(() => page.click('[data-action="csv"]'));
    equal(csv.text.trim().split(/\r?\n/).length, 1 + 1 + 8, "CSV rows");
    shareUrl = await page.eval("document.querySelector('#share-link').value");
    sharedHeadline = await headline(page);
  });
  await step("a reality check is saved and scored, and can be removed", async () => {
    await page.type("#check [name=wait]", "3.5");
    await page.click("#check button[type=submit]");
    await page.waitFor("!!document.querySelector('[data-mae]')", { what: "the score" });
    expect((await page.text("[data-mae]")).includes("off by"), "score");
    await page.click("[data-remove-check]");
    await page.waitFor("!document.querySelector('[data-mae]')", { what: "the check to go" });
  });
  await step("a broken link falls back to the example with a message", async () => {
    await page.goto(base + "?arr=1.x.3&base=1&plan=1&open=7&svc=2&var=low&pat=5&wage=1&tgt=2&lvl=80&runs=100", { ready: READY });
    expect(!(await page.eval("document.querySelector('#form-error').hidden")), "message shown");
    equal(await page.eval("document.querySelectorAll('table.hours tbody tr').length"), 8, "café example shown");
  });
  await step("desktop: no console errors, no other origins, no sideways scroll", async () => {
    checkClean(page, "owner");
    equal(await page.overflow(), 0, "overflow");
  });
  await page.close();
}

async function shared(browser) {
  const page = await browser.newPage({ width: 1280, height: 900 });
  await step("a shared link reproduces exactly the same numbers", async () => {
    expect(shareUrl, "a link from the earlier step");
    await page.goto(shareUrl.replace(siteUrl + "/", base), { ready: READY });
    equal(await headline(page), sharedHeadline, "same headline");
  });
  await step("guides open cleanly, and a missing page gets the 404 page", async () => {
    for (const p of ["how-many-staff-do-i-need/", "method/", "about/"]) {
      await page.goto(base + p);
      equal(await page.eval("document.querySelectorAll('h1').length"), 1, `${p} h1`);
      equal(await page.overflow(), 0, `${p} overflow`);
      if (p.startsWith("how-many")) expect(await page.exists(".staff-table td"), "staffing table");
      if (p === "method/") expect((await page.text("main")).includes("Little's law"), "validation section");
    }
    await page.goto(base + "no-such-page/");
    expect(await page.exists("main a.btn"), "404 way back");
    page.errors = page.errors.filter((e) => !/404/.test(e));
    checkClean(page, "pages");
  });
  await page.close();
}

async function phone(browser) {
  const page = await browser.newPage({ width: 390, height: 844, mobile: true });
  await step("phone: the simulator and pages fit a 390px screen", async () => {
    await page.goto(base, { ready: READY });
    equal(await page.overflow(), 0, "tool overflow");
    for (const k of ["desk", "event"]) {
      const before = await headline(page);
      await page.click(`[data-preset="${k}"]`);
      await rerun(page, before);
      equal(await page.overflow(), 0, `${k} overflow`);
    }
    for (const p of ["how-many-staff-do-i-need/", "method/", "about/"]) {
      await page.goto(base + p);
      equal(await page.overflow(), 0, `${p} overflow`);
    }
    checkClean(page, "phone");
  });
  await page.close();
}

async function dark(browser) {
  const page = await browser.newPage({ width: 1280, height: 900, dark: true });
  await step("dark mode follows the system setting", async () => {
    await page.goto(base, { ready: READY });
    const bg = await page.eval("getComputedStyle(document.body).backgroundColor");
    expect(bg !== "rgb(246, 245, 251)", "dark background, got " + bg);
    checkClean(page, "dark");
  });
  await page.close();
}

console.log(`end-to-end: ${base}`);
const browser = await launch();
try {
  await owner(browser);
  await shared(browser);
  await phone(browser);
  await dark(browser);
} finally {
  await browser.close();
  if (server) await server.close();
}
console.log(failures ? `${failures} step(s) failed` : "all steps passed");
process.exit(failures ? 1 : 0);
