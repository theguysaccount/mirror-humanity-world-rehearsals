// Shift Rehearsal: the queue model. Pure functions with no DOM access, shared by the page, the build
// and the tests. Every number it produces is a simulation under stated assumptions, not a forecast.
//
// The model: customers arrive at random (a Poisson process whose rate changes hour by hour), wait in
// one first-come-first-served line, and are served by however many staff are on duty that hour.
// Service times follow a gamma distribution with the chosen average and variability. Customers who
// wait too long leave (exponential patience). When staff go off duty, they finish the customer they
// are serving first. At closing time the doors shut and the people already in line are served.

export const LIMITS = { hours: 24, arrivals: 2000, staff: 50, minutes: 240, runs: 1000 };
export const VARIABILITY = {
  low: { name: "Low: most customers take about the same time", cv: 0.25 },
  medium: { name: "Medium: some quick, some slow", cv: 0.5 },
  high: { name: "High: very different from customer to customer", cv: 1 },
};

// ---- random numbers -------------------------------------------------------------------------------

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// mulberry32: small, fast, and the same everywhere, so a scenario link always gives the same numbers.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const uniform = (r) => { let u; do { u = r(); } while (u === 0); return u; };
export const exponential = (r, mean) => -Math.log(uniform(r)) * mean;
function normal(r) {
  const u = uniform(r);
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// Gamma with the given mean and coefficient of variation (Marsaglia and Tsang; shape >= 1 here).
export function gamma(r, mean, cv) {
  if (cv >= 1) return exponential(r, mean);
  const k = 1 / (cv * cv);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x;
    let v;
    do { x = normal(r); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = uniform(r);
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return (d * v * mean) / k;
  }
}

// ---- the textbook reference (Erlang C) ---------------------------------------------------------------

// Probability that an arriving customer has to wait, for `c` servers and offered load `a` (in
// erlangs: arrivals per minute x minutes per service). 1 when the line would grow forever.
export function erlangC(c, a) {
  if (c <= 0 || a >= c) return 1;
  if (a <= 0) return 0;
  let term = 1;
  let sum = 1;
  for (let k = 1; k < c; k++) { term *= a / k; sum += term; }
  term *= a / c;
  const top = term * (c / (c - a));
  return top / (sum + top);
}

// Steady-state reference for one hour: M/M/c, no one leaves. Times in minutes.
export function steadyState({ perHour, serviceMinutes, staff, targetMinutes = 0 }) {
  const lambda = perHour / 60;
  const a = lambda * serviceMinutes;
  if (staff <= 0 || a >= staff) return { stable: perHour <= 0, load: a, utilization: staff > 0 ? a / staff : Infinity, pWait: 1, meanWait: Infinity, withinTarget: 0 };
  const C = erlangC(staff, a);
  const rate = staff / serviceMinutes - lambda; // per minute
  return { stable: true, load: a, utilization: a / staff, pWait: C, meanWait: C / rate, withinTarget: 1 - C * Math.exp(-rate * targetMinutes) };
}

// The fewest staff for which the steady-state reference serves `level` (0..1) of customers within
// `targetMinutes`. A starting point to check with the simulation, not an answer.
export function staffNeeded({ perHour, serviceMinutes, targetMinutes, level }) {
  if (perHour <= 0) return 0;
  for (let c = Math.max(1, Math.ceil((perHour / 60) * serviceMinutes)); c <= LIMITS.staff; c++) {
    const s = steadyState({ perHour, serviceMinutes, staff: c, targetMinutes });
    if (s.stable && s.withinTarget >= level) return c;
  }
  return LIMITS.staff;
}

// ---- scenarios ----------------------------------------------------------------------------------------

export const PRESETS = {
  cafe: {
    name: "Café, weekday 7am to 3pm", open: 7, arrivals: [30, 55, 40, 25, 35, 45, 25, 15],
    baseline: [2, 2, 2, 2, 2, 2, 2, 2], plan: [2, 3, 3, 2, 2, 3, 2, 1],
    serviceMinutes: 2.5, variability: "medium", patienceMinutes: 6, wage: 18, targetMinutes: 4, level: 80, runs: 200,
  },
  desk: {
    name: "Service desk, 9am to 5pm", open: 9, arrivals: [12, 18, 20, 16, 22, 18, 14, 10],
    baseline: [3, 3, 3, 3, 3, 3, 3, 3], plan: [3, 4, 5, 4, 5, 4, 3, 2],
    serviceMinutes: 12, variability: "high", patienceMinutes: 25, wage: 28, targetMinutes: 15, level: 80, runs: 200,
  },
  event: {
    name: "Event check-in, 5pm to 9pm", open: 17, arrivals: [60, 240, 120, 30],
    baseline: [2, 2, 2, 2], plan: [2, 5, 3, 1],
    serviceMinutes: 0.75, variability: "low", patienceMinutes: 10, wage: 20, targetMinutes: 5, level: 80, runs: 200,
  },
};

const num = (v, lo, hi, step = 0.01) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi && Math.abs(Math.round(v / step) * step - v) < 1e-9;

// Check a scenario and return a clean copy, or throw a readable error.
export function validate(s) {
  const bad = (why) => { throw new Error(why); };
  if (!s || typeof s !== "object") bad("That isn't a scenario.");
  const n = Array.isArray(s.arrivals) ? s.arrivals.length : 0;
  if (n < 1 || n > LIMITS.hours) bad(`A scenario has between 1 and ${LIMITS.hours} hours.`);
  if (!Number.isInteger(s.open) || s.open < 0 || s.open + n > 48) bad("Pick an opening hour.");
  for (const key of ["arrivals", "baseline", "plan"]) {
    if (!Array.isArray(s[key]) || s[key].length !== n) bad("Every hour needs arrivals and both staff numbers.");
  }
  if (!s.arrivals.every((x) => Number.isInteger(x) && x >= 0 && x <= LIMITS.arrivals)) bad(`Customers per hour are whole numbers from 0 to ${LIMITS.arrivals}.`);
  if (!s.baseline.concat(s.plan).every((x) => Number.isInteger(x) && x >= 0 && x <= LIMITS.staff)) bad(`Staff on duty are whole numbers from 0 to ${LIMITS.staff}.`);
  if (!num(s.serviceMinutes, 0.1, LIMITS.minutes, 0.05)) bad("Average service time is between 0.1 and 240 minutes.");
  if (!VARIABILITY[s.variability]) bad("Pick how much service times vary.");
  if (s.patienceMinutes !== null && !num(s.patienceMinutes, 0.5, LIMITS.minutes, 0.5)) bad("Patience is between 0.5 and 240 minutes, or nobody leaves.");
  if (!num(s.wage, 0, 10000, 0.01)) bad("The hourly staff cost is a number from 0 to 10,000.");
  if (!num(s.targetMinutes, 0, LIMITS.minutes, 0.5)) bad("The wait target is between 0 and 240 minutes.");
  if (!Number.isInteger(s.level) || s.level < 1 || s.level > 99) bad("The service level is a whole percentage from 1 to 99.");
  if (![100, 200, 500, 1000].includes(s.runs)) bad("Pick 100, 200, 500 or 1,000 simulated days.");
  return {
    name: String(s.name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "My shift",
    open: s.open, arrivals: [...s.arrivals], baseline: [...s.baseline], plan: [...s.plan], serviceMinutes: s.serviceMinutes,
    variability: s.variability, patienceMinutes: s.patienceMinutes, wage: s.wage, targetMinutes: s.targetMinutes, level: s.level, runs: s.runs,
  };
}

// Scenario <-> query string, so a link reproduces the exact same simulation.
export function toQuery(s) {
  const p = new URLSearchParams();
  p.set("name", s.name);
  p.set("open", s.open);
  p.set("arr", s.arrivals.join("."));
  p.set("base", s.baseline.join("."));
  p.set("plan", s.plan.join("."));
  p.set("svc", s.serviceMinutes);
  p.set("var", s.variability);
  p.set("pat", s.patienceMinutes === null ? "none" : s.patienceMinutes);
  p.set("wage", s.wage);
  p.set("tgt", s.targetMinutes);
  p.set("lvl", s.level);
  p.set("runs", s.runs);
  return p.toString();
}

export function fromQuery(search) {
  const p = new URLSearchParams(search || "");
  if (p.get("preset") && PRESETS[p.get("preset")]) return validate(PRESETS[p.get("preset")]);
  if (!p.has("arr")) return null;
  const list = (k) => (p.get(k) || "").split(".").filter((x) => x !== "").map(Number);
  return validate({
    name: p.get("name") || "", open: Number(p.get("open")), arrivals: list("arr"), baseline: list("base"), plan: list("plan"),
    serviceMinutes: Number(p.get("svc")), variability: p.get("var"), patienceMinutes: p.get("pat") === "none" ? null : Number(p.get("pat")),
    wage: Number(p.get("wage")), targetMinutes: Number(p.get("tgt")), level: Number(p.get("lvl")), runs: Number(p.get("runs")),
  });
}

// ---- the simulation -----------------------------------------------------------------------------------

// One simulated day's customers, shared by both staffing plans (common random numbers), so any
// difference between baseline and plan comes from the staffing alone.
export function customers(s, r) {
  const out = [];
  const cv = VARIABILITY[s.variability].cv;
  s.arrivals.forEach((perHour, h) => {
    if (perHour <= 0) return;
    const mean = 60 / perHour;
    let t = h * 60 + exponential(r, mean);
    while (t < (h + 1) * 60) {
      out.push({ t, service: gamma(r, s.serviceMinutes, cv), patience: s.patienceMinutes === null ? Infinity : exponential(r, s.patienceMinutes) });
      t += exponential(r, mean);
    }
  });
  return out;
}

// Serve one day's customers with `staff` (one number per hour). Event-driven, exact.
export function runDay(s, list, staff) {
  const close = s.arrivals.length * 60;
  const onDuty = (t) => (t >= close ? staff[staff.length - 1] || 1 : staff[Math.floor(t / 60)]);
  const busyUntil = []; // finishing times of customers in service
  const line = []; // indexes into list, waiting
  const waits = [];
  let left = 0;
  let served = 0;
  let busyMinutes = 0;
  let maxLine = 0;
  let lineArea = 0; // integral of line length over time
  const hourWait = s.arrivals.map(() => ({ n: 0, sum: 0 }));
  const hourLine = s.arrivals.map(() => 0);
  let now = 0;
  let i = 0;
  let lastFinish = 0;

  const advance = (to) => {
    if (to > now) {
      lineArea += line.length * (to - now);
      // time-weighted line length per hour
      let a = now;
      while (a < to) {
        const h = Math.floor(a / 60);
        const b = Math.min(to, (h + 1) * 60);
        if (h < hourLine.length) hourLine[h] += line.length * (b - a);
        a = b;
      }
      now = to;
    }
  };
  const startService = () => {
    // Drop people who gave up before now, then start as many as staff allow.
    for (;;) {
      while (line.length && list[line[0]].t + list[line[0]].patience < now) {
        line.shift();
        left += 1;
      }
      if (!line.length || busyUntil.length >= onDuty(now)) return;
      const c = list[line.shift()];
      const wait = now - c.t;
      waits.push(wait);
      const h = Math.min(hourWait.length - 1, Math.floor(c.t / 60));
      hourWait[h].n += 1;
      hourWait[h].sum += wait;
      busyUntil.push(now + c.service);
      busyMinutes += c.service;
      lastFinish = Math.max(lastFinish, now + c.service);
      served += 1;
    }
  };

  for (;;) {
    const nextArrival = i < list.length ? list[i].t : Infinity;
    const nextFinish = busyUntil.length ? Math.min(...busyUntil) : Infinity;
    const nextHour = now < close ? Math.floor(now / 60 + 1e-9) * 60 + 60 : Infinity;
    // The next abandonment among people in line.
    let nextLeave = Infinity;
    for (const k of line) nextLeave = Math.min(nextLeave, list[k].t + list[k].patience);
    const t = Math.min(nextArrival, nextFinish, nextHour, nextLeave);
    if (t === Infinity) break;
    advance(t);
    if (t === nextFinish) busyUntil.splice(busyUntil.indexOf(nextFinish), 1);
    if (t === nextArrival) { line.push(i); i += 1; }
    if (t === nextLeave) {
      const k = line.findIndex((idx) => list[idx].t + list[idx].patience === t);
      if (k !== -1) { line.splice(k, 1); left += 1; }
    }
    maxLine = Math.max(maxLine, line.length);
    startService();
    if (i >= list.length && !line.length && !busyUntil.length) break;
  }

  const paidHours = staff.reduce((a, b) => a + b, 0);
  const overtime = Math.max(0, lastFinish - close) / 60; // hours after closing, at the last hour's staffing
  const paid = paidHours + overtime * (staff[staff.length - 1] || 1);
  waits.sort((a, b) => a - b);
  const within = waits.filter((w) => w <= s.targetMinutes).length;
  return {
    arrivals: list.length, served, left, maxLine,
    meanWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
    p90Wait: waits.length ? waits[Math.min(waits.length - 1, Math.floor(0.9 * waits.length))] : 0,
    withinTarget: list.length ? within / list.length : 1,
    meanLine: lineArea / Math.max(close, lastFinish || close),
    staffHours: paid, busyHours: busyMinutes / 60, idleHours: Math.max(0, paid - busyMinutes / 60), overtimeHours: overtime,
    cost: paid * s.wage,
    hourWait: hourWait.map((x) => (x.n ? x.sum / x.n : 0)),
    hourLine: hourLine.map((area) => area / 60),
  };
}

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];

function summarise(days, keys) {
  const out = {};
  for (const k of keys) {
    const v = days.map((d) => d[k]).sort((a, b) => a - b);
    out[k] = { mean: v.reduce((a, b) => a + b, 0) / v.length, low: quantile(v, 0.1), high: quantile(v, 0.9) };
  }
  return out;
}

const KEYS = ["arrivals", "served", "left", "maxLine", "meanWait", "p90Wait", "withinTarget", "meanLine", "staffHours", "busyHours", "idleHours", "overtimeHours", "cost"];

// Rehearse a scenario: `runs` simulated days, each played with the baseline and the plan staffing
// on the same customers. The seed comes from the scenario, so the same inputs give the same result.
export function rehearse(input) {
  const s = validate(input);
  const seed = hashString(toQuery({ ...s, name: "" }));
  const results = { baseline: [], plan: [] };
  for (let d = 0; d < s.runs; d++) {
    const list = customers(s, rng(seed + d * 0x9e3779b1));
    results.baseline.push(runDay(s, list, s.baseline));
    results.plan.push(runDay(s, list, s.plan));
  }
  const pack = (days) => ({
    ...summarise(days, KEYS),
    hourWait: s.arrivals.map((_, h) => days.reduce((a, d) => a + d.hourWait[h], 0) / days.length),
    hourLine: s.arrivals.map((_, h) => days.reduce((a, d) => a + d.hourLine[h], 0) / days.length),
    costPerServed: days.reduce((a, d) => a + (d.served ? d.cost / d.served : 0), 0) / days.length,
  });
  const reference = s.arrivals.map((perHour, h) => ({
    baseline: steadyState({ perHour, serviceMinutes: s.serviceMinutes, staff: s.baseline[h], targetMinutes: s.targetMinutes }),
    plan: steadyState({ perHour, serviceMinutes: s.serviceMinutes, staff: s.plan[h], targetMinutes: s.targetMinutes }),
    suggested: staffNeeded({ perHour, serviceMinutes: s.serviceMinutes, targetMinutes: s.targetMinutes, level: s.level / 100 }),
  }));
  // How often the plan beat the baseline on the same simulated day.
  const better = results.plan.filter((p, d) => p.meanWait < results.baseline[d].meanWait - 1e-9).length / s.runs;
  return { scenario: s, seed, baseline: pack(results.baseline), plan: pack(results.plan), reference, planBetterShare: better };
}

// ---- words ----------------------------------------------------------------------------------------------

export const hourLabel = (h) => {
  const hh = ((h % 24) + 24) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? "am" : "pm"}`;
};
export const minutes = (m) => (m === Infinity ? "no limit" : m < 1 ? `${Math.round(m * 60)} sec` : `${m.toFixed(1)} min`);

// Every assumption, in plain words. Shown next to results and in every download.
export function assumptions(s) {
  const n = s.arrivals.length;
  return [
    `Open ${hourLabel(s.open)} to ${hourLabel(s.open + n)} (${n} ${n === 1 ? "hour" : "hours"}).`,
    `Customers per hour: ${s.arrivals.map((a, h) => `${hourLabel(s.open + h)} ${a}`).join(", ")}. They arrive at random within each hour (a Poisson process).`,
    `Average service time: ${s.serviceMinutes} minutes, with ${VARIABILITY[s.variability].name.toLowerCase()} (gamma distribution, coefficient of variation ${VARIABILITY[s.variability].cv}).`,
    s.patienceMinutes === null ? "Nobody leaves the line, however long the wait." : `Customers give up and leave after waiting about ${s.patienceMinutes} minutes on average (exponential patience).`,
    "One line, first come first served. Staff going off duty finish the customer they're serving first.",
    "At closing the doors shut and everyone already in line is served, by the last hour's staff; that time counts as overtime.",
    `Staff on duty, baseline: ${s.baseline.join(", ")}. Plan: ${s.plan.join(", ")}.`,
    `Cost of one staff hour: ${s.wage}. Idle time is paid staff time not spent serving.`,
    `Wait target: ${s.level}% of customers served within ${s.targetMinutes} minutes; customers who leave count as missed.`,
    `${s.runs} simulated days. Both plans see the same customers on each day, so differences come from staffing alone. Ranges show the middle 80% of days.`,
  ];
}

export function summaryText(result, { url = "" } = {}) {
  const { scenario: s, baseline: b, plan: p } = result;
  const row = (label, k, f) => `  ${label.padEnd(34)} ${f(b[k].mean).padStart(12)} ${f(p[k].mean).padStart(12)}`;
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const mins = (x) => `${x.toFixed(1)} min`;
  const hrs = (x) => `${x.toFixed(1)} h`;
  const money = (x) => x.toFixed(2);
  return [
    `SHIFT REHEARSAL: ${s.name}`,
    "A simulation, not a forecast. It shows what these assumptions imply, not what will happen.",
    "",
    `  ${"".padEnd(34)} ${"Baseline".padStart(12)} ${"Plan".padStart(12)}`,
    row("Average wait (served customers)", "meanWait", mins),
    row("Slowest 10% waited at least", "p90Wait", mins),
    row(`Served within ${s.targetMinutes} min`, "withinTarget", pct),
    row("Customers who left", "left", (x) => x.toFixed(1)),
    row("Longest line", "maxLine", (x) => x.toFixed(1)),
    row("Paid staff hours", "staffHours", hrs),
    row("Idle staff hours", "idleHours", hrs),
    row("Staff cost", "cost", money),
    "",
    `On ${Math.round(result.planBetterShare * 100)}% of simulated days the plan had a shorter average wait than the baseline.`,
    "",
    "ASSUMPTIONS",
    ...assumptions(s).map((a) => `- ${a}`),
    "",
    url ? `Reproduce it: ${url}` : "",
    "Made with Shift Rehearsal. Results are averages over simulated days.",
  ].join("\n");
}

export function hourlyCsv(result) {
  const { scenario: s, baseline: b, plan: p, reference } = result;
  const rows = [["Hour", "Customers", "Staff (baseline)", "Staff (plan)", "Avg wait baseline (min)", "Avg wait plan (min)", "Avg line baseline", "Avg line plan", "Formula suggests staff"]];
  s.arrivals.forEach((a, h) => rows.push([hourLabel(s.open + h), a, s.baseline[h], s.plan[h], b.hourWait[h].toFixed(2), p.hourWait[h].toFixed(2), b.hourLine[h].toFixed(2), p.hourLine[h].toFixed(2), reference[h].suggested]));
  return ["Note,A simulation under the stated assumptions; not a forecast", ...rows.map((r) => r.join(","))].join("\r\n") + "\r\n";
}
