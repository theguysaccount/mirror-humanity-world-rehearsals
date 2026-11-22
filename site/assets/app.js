// Shift Rehearsal: the page. Runs the simulation in the browser; the scenario lives in the address
// (so a link reproduces it) and reality checks live in this browser's storage. Nothing is sent anywhere.
import * as sim from "./sim.js";
import { waitChartSVG } from "./art.js";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cfg = JSON.parse($("#site-config").textContent);
const CHECKS = "shift-rehearsal:checks";
const form = $("#scenario");
const out = $("#results");
const live = $("#live");

let storage = null;
try {
  localStorage.setItem("shift-rehearsal:probe", "1");
  localStorage.removeItem("shift-rehearsal:probe");
  storage = localStorage;
} catch {
  storage = null;
}

let scenario = null;
let result = null;
let timer = null;

const track = (name) => { try { window.goatcounter?.count?.({ path: "event/" + name, title: name, event: true }); } catch {} };
const pct = (x) => `${(x * 100).toFixed(0)}%`;
const mins = (x) => sim.minutes(x);
const hours = (x) => `${x.toFixed(1)} h`;
const money = (x) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- the form ------------------------------------------------------------------------------------

function hourRows(s) {
  return s.arrivals.map((a, h) => {
    const suggested = sim.staffNeeded({ perHour: a, serviceMinutes: s.serviceMinutes, targetMinutes: s.targetMinutes, level: s.level / 100 });
    return `<tr><th scope="row">${sim.hourLabel(s.open + h)}</th>
<td><input type="number" min="0" max="${sim.LIMITS.arrivals}" step="1" name="arr-${h}" value="${a}" aria-label="Customers arriving, ${sim.hourLabel(s.open + h)}"></td>
<td><input type="number" min="0" max="${sim.LIMITS.staff}" step="1" name="base-${h}" value="${s.baseline[h]}" aria-label="Staff on duty in the baseline, ${sim.hourLabel(s.open + h)}"></td>
<td><input type="number" min="0" max="${sim.LIMITS.staff}" step="1" name="plan-${h}" value="${s.plan[h]}" aria-label="Staff on duty in the plan, ${sim.hourLabel(s.open + h)}"></td>
<td class="num suggest" title="Fewest staff the textbook formula says reach the target in a steady hour">${suggested}</td></tr>`;
  }).join("");
}

function drawForm(s) {
  form.innerHTML = `
<div class="presets" role="group" aria-label="Examples">${Object.entries(sim.PRESETS).map(([k, p]) => `<button class="btn small quiet" type="button" data-preset="${k}">${esc(p.name.split(",")[0])}</button>`).join("")}</div>
<div class="fields">
<label class="wide">Scenario name <input type="text" name="name" maxlength="80" value="${esc(s.name)}"></label>
<label>Opens at <select name="open">${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === s.open ? " selected" : ""}>${sim.hourLabel(h)}</option>`).join("")}</select></label>
</div>
<div class="table-wrap"><table class="hours"><thead><tr><th>Hour</th><th>Customers arriving</th><th>Staff now (baseline)</th><th>Staff in your plan</th><th class="num">Formula suggests</th></tr></thead>
<tbody>${hourRows(s)}</tbody></table></div>
<div class="btn-row"><button class="btn small quiet" type="button" data-action="add-hour"${s.arrivals.length >= sim.LIMITS.hours ? " disabled" : ""}>Add an hour</button>
<button class="btn small quiet" type="button" data-action="remove-hour"${s.arrivals.length <= 1 ? " disabled" : ""}>Remove the last hour</button>
<button class="btn small quiet" type="button" data-action="suggest">Use the formula's numbers as my plan</button></div>
<div class="fields">
<label>Average service time (minutes) <input type="number" name="svc" min="0.1" max="240" step="0.05" value="${s.serviceMinutes}"></label>
<label>Service times vary <select name="var">${Object.entries(sim.VARIABILITY).map(([k, v]) => `<option value="${k}"${k === s.variability ? " selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
<label>People give up after about (minutes) <input type="number" name="pat" min="0.5" max="240" step="0.5" value="${s.patienceMinutes ?? ""}" placeholder="nobody leaves"${s.patienceMinutes === null ? " disabled" : ""}></label>
<label class="check"><input type="checkbox" name="nopat"${s.patienceMinutes === null ? " checked" : ""}> Nobody leaves the line</label>
<label>Cost of one staff hour <input type="number" name="wage" min="0" max="10000" step="0.01" value="${s.wage}"></label>
<label>Target: serve <input type="number" name="lvl" min="1" max="99" step="1" value="${s.level}"> % within</label>
<label>(minutes) <input type="number" name="tgt" min="0" max="240" step="0.5" value="${s.targetMinutes}"></label>
<label>Simulated days <select name="runs">${[100, 200, 500, 1000].map((n) => `<option value="${n}"${n === s.runs ? " selected" : ""}>${n.toLocaleString("en-US")}</option>`).join("")}</select></label>
</div>
<p class="note">Every number above is an assumption you can change. The examples are illustrations, not measurements of any real business. Use your own: till receipts or ticket logs give customers per hour; a stopwatch gives service time.</p>`;
}

function readForm() {
  const v = (n) => form.elements[n]?.value ?? "";
  const n = form.querySelectorAll("table.hours tbody tr").length;
  const ints = (prefix) => Array.from({ length: n }, (_, h) => Number(v(`${prefix}-${h}`)));
  return sim.validate({
    name: v("name"), open: Number(v("open")), arrivals: ints("arr"), baseline: ints("base"), plan: ints("plan"),
    serviceMinutes: Math.round(Number(v("svc")) * 20) / 20, variability: v("var"),
    patienceMinutes: form.elements.nopat.checked ? null : Math.round(Number(v("pat")) * 2) / 2,
    wage: Math.round(Number(v("wage")) * 100) / 100, targetMinutes: Math.round(Number(v("tgt")) * 2) / 2, level: Number(v("lvl")), runs: Number(v("runs")),
  });
}

// ---- results ------------------------------------------------------------------------------------

function metricRow(label, k, f, { better = "lower", note = "" } = {}) {
  const b = result.baseline[k];
  const p = result.plan[k];
  const d = p.mean - b.mean;
  const good = Math.abs(d) < 1e-9 ? "same" : (d < 0) === (better === "lower") ? "good" : "bad";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "";
  return `<tr><th scope="row">${label}${note ? `<span class="muted"> ${note}</span>` : ""}</th>
<td class="num" data-metric="${k}-baseline">${f(b.mean)}<span class="range">${f(b.low)} to ${f(b.high)}</span></td>
<td class="num" data-metric="${k}-plan">${f(p.mean)}<span class="range">${f(p.low)} to ${f(p.high)}</span></td>
<td class="num diff ${good}">${good === "same" ? "same" : `${sign}${f(Math.abs(d))}`}</td></tr>`;
}

function checksHTML() {
  const checks = readChecks().filter((c) => c.scenario === scenario.name);
  const errors = checks.map((c) => Math.abs(c.observedWait - c.simulatedWait));
  const mae = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
  return `<section class="panel" aria-labelledby="check-h"><h2 id="check-h">Reality check</h2>
<p>After a real shift, write down what actually happened. Shift Rehearsal keeps your checks in this browser only and shows how far its simulations have been from your reality. That's the honest test of whether these assumptions fit your business.</p>
<form id="check" class="fields" novalidate>
<label>Date <input type="date" name="date" value="${new Date().toISOString().slice(0, 10)}"></label>
<label>Staffing used <select name="used"><option value="plan">My plan</option><option value="baseline">The baseline</option></select></label>
<label>Real average wait (minutes) <input type="number" name="wait" min="0" max="240" step="0.1"></label>
<label>Real customers who left <input type="number" name="left" min="0" max="5000" step="1" placeholder="optional"></label>
<button class="btn small" type="submit">Save the check</button></form>
${checks.length ? `<p class="check-summary" data-mae>${checks.length} ${checks.length === 1 ? "check" : "checks"} for “${esc(scenario.name)}”: the simulated average wait was off by <b>${mae.toFixed(1)} min</b> on average.</p>
<div class="table-wrap"><table><thead><tr><th>Date</th><th>Staffing</th><th class="num">Simulated wait</th><th class="num">Real wait</th><th class="num">Off by</th><th></th></tr></thead><tbody>
${checks.slice().reverse().map((c) => `<tr><td>${esc(c.date)}</td><td>${c.used === "plan" ? "Plan" : "Baseline"}</td><td class="num">${c.simulatedWait.toFixed(1)} min</td><td class="num">${c.observedWait.toFixed(1)} min</td><td class="num">${(c.observedWait - c.simulatedWait >= 0 ? "+" : "−") + Math.abs(c.observedWait - c.simulatedWait).toFixed(1)} min</td><td><button class="btn tiny quiet danger" type="button" data-remove-check="${c.at}">Remove</button></td></tr>`).join("")}
</tbody></table></div>` : '<p class="muted">No checks yet for this scenario.</p>'}
</section>`;
}

function drawResults() {
  const s = result.scenario;
  const shareUrl = `${cfg.siteUrl}/?${sim.toQuery(s)}`;
  out.innerHTML = `
<p class="banner" role="note"><b>A simulation, not a forecast.</b> These numbers show what the assumptions above imply over ${s.runs.toLocaleString("en-US")} simulated days. Real days will differ, and they'll differ more when the assumptions are off.</p>
<section class="panel" aria-labelledby="res-h"><h2 id="res-h">Baseline vs. your plan</h2>
<p class="headline" data-headline>${headline()}</p>
<div class="table-wrap"><table class="compare"><thead><tr><th>Per simulated day</th><th class="num">Baseline</th><th class="num">Your plan</th><th class="num">Difference</th></tr></thead><tbody>
${metricRow(`Served within ${s.targetMinutes} min`, "withinTarget", pct, { better: "higher", note: "(people who left count as missed)" })}
${metricRow("Average wait", "meanWait", mins, { note: "(of people served)" })}
${metricRow("Slowest 10% waited at least", "p90Wait", mins)}
${metricRow("People who gave up and left", "left", (x) => x.toFixed(1))}
${metricRow("Longest line", "maxLine", (x) => x.toFixed(1))}
${metricRow("Paid staff hours", "staffHours", hours)}
${metricRow("Idle staff hours", "idleHours", hours)}
${metricRow("Staff cost", "cost", money)}
</tbody></table></div>
<p class="note">Small grey numbers: the range on the middle 80% of simulated days. On <b data-better>${Math.round(result.planBetterShare * 100)}%</b> of simulated days your plan had a shorter average wait than the baseline on the same customers.</p>
<h3>Average wait by hour of arrival</h3>
<p class="legend"><span class="key base">Baseline</span> <span class="key plan">Your plan</span></p>
${waitChartSVG(result)}
</section>
<section class="panel" aria-labelledby="as-h"><h2 id="as-h">Every assumption in this result</h2>
<ul class="assumptions">${sim.assumptions(s).map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
<div class="btn-row"><button class="btn small" type="button" data-action="copy-link">Copy a link to this scenario</button>
<button class="btn small quiet" type="button" data-action="summary">Download the summary</button>
<button class="btn small quiet" type="button" data-action="csv">Download hour-by-hour (CSV)</button></div>
<label class="sr-only" for="share-link">Link to this scenario</label><input id="share-link" class="link" type="text" readonly value="${esc(shareUrl)}">
</section>
${checksHTML()}`;
  document.documentElement.dataset.ready = "1";
}

function headline() {
  const b = result.baseline;
  const p = result.plan;
  const s = result.scenario;
  const extraHours = p.staffHours.mean - b.staffHours.mean;
  const served = (x) => `${Math.round(x * 100)}%`;
  if (Math.abs(extraHours) < 0.05 && Math.abs(p.meanWait.mean - b.meanWait.mean) < 0.05) return "The plan and the baseline perform the same in this simulation.";
  return `In this simulation, your plan serves ${served(p.withinTarget.mean)} of customers within ${s.targetMinutes} minutes, against ${served(b.withinTarget.mean)} for the baseline, ` +
    `using ${Math.abs(extraHours).toFixed(1)} ${extraHours >= 0 ? "more" : "fewer"} staff hours a day; ${p.left.mean.toFixed(0)} people leave the line instead of ${b.left.mean.toFixed(0)}.`;
}

// ---- running -------------------------------------------------------------------------------------

function run({ fromForm = true } = {}) {
  try {
    if (fromForm) scenario = readForm();
  } catch (e) {
    $("#form-error").textContent = e.message;
    $("#form-error").hidden = false;
    return;
  }
  $("#form-error").hidden = true;
  result = sim.rehearse(scenario);
  history.replaceState(null, "", `${location.pathname}?${sim.toQuery(scenario)}`);
  drawResults();
  live.textContent = `Rehearsed ${scenario.runs} simulated days. ${headline()}`;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    run();
    // keep the "formula suggests" column in step with the inputs
    try {
      const s = readForm();
      form.querySelectorAll("td.suggest").forEach((td, h) => { td.textContent = sim.staffNeeded({ perHour: s.arrivals[h], serviceMinutes: s.serviceMinutes, targetMinutes: s.targetMinutes, level: s.level / 100 }); });
    } catch {}
  }, 350);
}

function load(s) {
  scenario = s;
  drawForm(s);
  run({ fromForm: false });
}

// ---- reality checks ------------------------------------------------------------------------------

function readChecks() {
  try {
    const raw = JSON.parse(storage?.getItem(CHECKS) || "[]");
    return Array.isArray(raw) ? raw.filter((c) => c && typeof c.scenario === "string" && Number.isFinite(c.observedWait) && Number.isFinite(c.simulatedWait)) : [];
  } catch {
    return [];
  }
}
function writeChecks(list) {
  try { storage?.setItem(CHECKS, JSON.stringify(list.slice(-500))); } catch {}
}

// ---- events --------------------------------------------------------------------------------------

function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "shift";

form.addEventListener("input", (e) => { if (e.target.name !== "name") schedule(); });
form.addEventListener("change", (e) => {
  if (e.target.name === "nopat") form.elements.pat.disabled = e.target.checked;
  if (e.target.name === "open") { scenario = { ...readFormSafe(), open: Number(e.target.value) }; drawForm(scenario); }
  schedule();
});
function readFormSafe() { try { return readForm(); } catch { return scenario; } }

form.addEventListener("click", (e) => {
  const preset = e.target.closest("[data-preset]");
  if (preset) { load(sim.validate(sim.PRESETS[preset.dataset.preset])); track("preset_" + preset.dataset.preset); return; }
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const s = readFormSafe();
  if (b.dataset.action === "add-hour") {
    load({ ...s, arrivals: [...s.arrivals, s.arrivals.at(-1)], baseline: [...s.baseline, s.baseline.at(-1)], plan: [...s.plan, s.plan.at(-1)] });
  } else if (b.dataset.action === "remove-hour") {
    load({ ...s, arrivals: s.arrivals.slice(0, -1), baseline: s.baseline.slice(0, -1), plan: s.plan.slice(0, -1) });
  } else if (b.dataset.action === "suggest") {
    const plan = s.arrivals.map((a) => sim.staffNeeded({ perHour: a, serviceMinutes: s.serviceMinutes, targetMinutes: s.targetMinutes, level: s.level / 100 }));
    load({ ...s, plan });
    track("suggest");
  }
});

out.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  const rm = e.target.closest("[data-remove-check]");
  if (rm) {
    writeChecks(readChecks().filter((c) => String(c.at) !== rm.dataset.removeCheck));
    drawResults();
    return;
  }
  if (!b) return;
  if (b.dataset.action === "copy-link") {
    const input = $("#share-link");
    try {
      await navigator.clipboard.writeText(input.value);
      b.textContent = "Link copied";
    } catch {
      input.select();
      b.textContent = "Press Ctrl+C or ⌘C to copy";
    }
    track("copy_link");
  } else if (b.dataset.action === "summary") {
    download(sim.summaryText(result, { url: `${cfg.siteUrl}/?${sim.toQuery(result.scenario)}` }), `${slug(result.scenario.name)}-rehearsal.txt`, "text/plain");
    track("summary");
  } else if (b.dataset.action === "csv") {
    download(sim.hourlyCsv(result), `${slug(result.scenario.name)}-by-hour.csv`, "text/csv");
  }
});

out.addEventListener("submit", (e) => {
  if (e.target.id !== "check") return;
  e.preventDefault();
  const f = e.target;
  const wait = Number(f.elements.wait.value);
  if (f.elements.wait.value === "" || !(wait >= 0 && wait <= 240)) {
    f.elements.wait.focus();
    f.elements.wait.setCustomValidity("Type the real average wait in minutes.");
    f.elements.wait.reportValidity();
    return;
  }
  const used = f.elements.used.value === "baseline" ? "baseline" : "plan";
  const leftText = f.elements.left.value;
  const check = {
    at: Date.now(), scenario: scenario.name, date: f.elements.date.value || new Date().toISOString().slice(0, 10), used,
    simulatedWait: result[used].meanWait.mean, observedWait: wait,
    simulatedLeft: result[used].left.mean, observedLeft: leftText === "" ? null : Number(leftText),
  };
  writeChecks([...readChecks(), check]);
  drawResults();
  live.textContent = "Reality check saved.";
  track("reality_check");
});
out.addEventListener("input", (e) => { if (e.target.name === "wait") e.target.setCustomValidity(""); });

let initial = null;
try {
  initial = sim.fromQuery(location.search);
} catch (err) {
  $("#form-error").textContent = `That link's scenario couldn't be used (${err.message}) so the café example is shown instead.`;
  $("#form-error").hidden = false;
}
load(initial || sim.validate(sim.PRESETS.cafe));
