// The queue model (site/assets/sim.js), checked against known queueing results. These are the
// "simulation regression tests" the weekly self-test runs. Seeds are fixed, so results are exact
// and repeatable; tolerances cover the gap between finite simulated days and long-run formulas.
import test from "node:test";
import assert from "node:assert/strict";
import * as sim from "../site/assets/sim.js";
import { validation, VALIDATION_CASES } from "../scripts/build.mjs";

const steady = (perHour, serviceMinutes, staff, extra = {}) => ({
  name: "t", open: 0, arrivals: Array(24).fill(perHour), baseline: Array(24).fill(staff), plan: Array(24).fill(staff),
  serviceMinutes, variability: "high", patienceMinutes: null, wage: 10, targetMinutes: 1, level: 80, runs: 100, ...extra,
});
const close = (a, b, rel, what) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${what}: ${a} vs ${b} (allowed ${rel * 100}%)`);

test("Erlang C matches textbook values", () => {
  assert.equal(sim.erlangC(1, 0.8), 0.8);
  assert.ok(Math.abs(sim.erlangC(4, 3) - 0.5094339622641509) < 1e-12);
  assert.ok(Math.abs(sim.erlangC(2, 1) - 1 / 3) < 1e-12);
  assert.equal(sim.erlangC(3, 3), 1, "a full load never clears");
  assert.equal(sim.erlangC(3, 0), 0);
  const mm1 = sim.steadyState({ perHour: 48, serviceMinutes: 1, staff: 1, targetMinutes: 0 });
  assert.ok(Math.abs(mm1.meanWait - 4) < 1e-9);
  assert.ok(Math.abs(mm1.utilization - 0.8) < 1e-12);
  assert.equal(sim.steadyState({ perHour: 120, serviceMinutes: 1, staff: 2 }).stable, false);
});

test("staffing suggestions meet the target and are the fewest that do", () => {
  for (const [perHour, m] of [[40, 3], [100, 2.5], [12, 12], [240, 0.75]]) {
    const c = sim.staffNeeded({ perHour, serviceMinutes: m, targetMinutes: 3, level: 0.8 });
    assert.ok(sim.steadyState({ perHour, serviceMinutes: m, staff: c, targetMinutes: 3 }).withinTarget >= 0.8);
    const fewer = sim.steadyState({ perHour, serviceMinutes: m, staff: c - 1, targetMinutes: 3 });
    assert.ok(!fewer.stable || fewer.withinTarget < 0.8, `${perHour}/h, ${m} min: ${c - 1} would do`);
  }
  assert.equal(sim.staffNeeded({ perHour: 0, serviceMinutes: 5, targetMinutes: 1, level: 0.8 }), 0);
});

test("simulated waits agree with Erlang C in steady conditions", () => {
  for (const c of validation()) {
    // Simulated days start empty, so busy systems wait a little less than the long-run formula.
    close(c.simWait, c.theoryWait, 0.08, `${c.label} average wait`);
    assert.ok(Math.abs(c.simWithin - c.theoryWithin) < 0.02, `${c.label} served within 1 min: ${c.simWithin} vs ${c.theoryWithin}`);
    assert.ok(c.little < 0.05 * Math.max(1, (c.perHour / 60) * c.theoryWait), `${c.label}: Little's law off by ${c.little}`);
  }
  assert.equal(validation().length, VALIDATION_CASES.length);
});

test("service-time variability behaves like the M/G/c family", () => {
  // Less variable service means shorter waits at the same load (Pollaczek-Khinchine for one server).
  const one = (v) => sim.rehearse(steady(40, 1.2, 1, { variability: v })).baseline.meanWait.mean;
  const [low, medium, high] = ["low", "medium", "high"].map(one);
  assert.ok(low < medium && medium < high, `${low} < ${medium} < ${high}`);
  const pk = (cv) => ((40 / 60) * 1.2 * 1.2 * (1 + cv * cv)) / (2 * (1 - (40 / 60) * 1.2));
  close(low, pk(0.25), 0.12, "M/G/1 with low variability");
  close(medium, pk(0.5), 0.12, "M/G/1 with medium variability");
});

test("gamma service times have the asked-for mean and spread", () => {
  for (const cv of [0.25, 0.5, 1]) {
    const r = sim.rng(42);
    const xs = Array.from({ length: 40000 }, () => sim.gamma(r, 3, cv));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    close(mean, 3, 0.02, `mean at cv ${cv}`);
    close(sd / mean, cv, 0.04, `cv at cv ${cv}`);
  }
});

test("every customer is accounted for, and impatient customers leave", () => {
  const s = sim.validate({ ...sim.PRESETS.cafe, baseline: [1, 1, 1, 1, 1, 1, 1, 1] });
  for (let d = 0; d < 20; d++) {
    const list = sim.customers(s, sim.rng(100 + d));
    for (const staff of [s.baseline, s.plan]) {
      const r = sim.runDay(s, list, staff);
      assert.equal(r.served + r.left, r.arrivals, "served + left = arrived");
    }
  }
  const r = sim.rehearse({ ...sim.PRESETS.cafe, baseline: [1, 1, 1, 1, 1, 1, 1, 1] });
  assert.ok(r.baseline.left.mean > r.plan.left.mean, "an understaffed day loses more customers");
  const patient = sim.rehearse({ ...sim.PRESETS.cafe, patienceMinutes: null });
  assert.equal(patient.baseline.left.mean, 0);
});

test("edge cases: an empty day, a single customer, an hour with nobody on duty", () => {
  const s = sim.validate({ ...sim.PRESETS.cafe, arrivals: [0, 0], baseline: [1, 1], plan: [1, 1] });
  const empty = sim.runDay(s, [], s.baseline);
  assert.equal(empty.arrivals, 0);
  assert.equal(empty.withinTarget, 1);
  assert.equal(empty.idleHours, 2);
  const one = sim.runDay(s, [{ t: 30, service: 5, patience: Infinity }], s.baseline);
  assert.equal(one.served, 1);
  assert.equal(one.meanWait, 0);
  assert.ok(Math.abs(one.busyHours - 5 / 60) < 1e-12);
  const gap = sim.validate({ ...s, arrivals: [10, 0], baseline: [0, 1], plan: [0, 1], patienceMinutes: null });
  const list = [{ t: 10, service: 2, patience: Infinity }, { t: 50, service: 2, patience: Infinity }];
  const r = sim.runDay(gap, list, gap.baseline);
  assert.equal(r.served, 2, "they wait for the next hour's staff");
  assert.ok(Math.abs(r.meanWait - ((60 - 10) + (62 - 50)) / 2) < 1e-9);
  const late = sim.runDay(gap, [{ t: 119, service: 30, patience: Infinity }], gap.baseline);
  assert.ok(late.overtimeHours > 0.4, "serving past closing is overtime");
});

test("more staff on the same customers never makes anyone wait longer (nobody leaving)", () => {
  const s = sim.validate({ ...sim.PRESETS.desk, patienceMinutes: null });
  for (let d = 0; d < 30; d++) {
    const list = sim.customers(s, sim.rng(7 + d));
    const few = sim.runDay(s, list, [2, 2, 2, 2, 2, 2, 2, 2]);
    const more = sim.runDay(s, list, [3, 3, 3, 3, 3, 3, 3, 3]);
    assert.ok(more.meanWait <= few.meanWait + 1e-9);
    assert.ok(more.p90Wait <= few.p90Wait + 1e-9);
  }
});

test("identical plans give identical results, and the same inputs give the same numbers", () => {
  const same = sim.rehearse({ ...sim.PRESETS.event, plan: sim.PRESETS.event.baseline });
  assert.deepEqual(same.baseline, same.plan);
  assert.equal(same.planBetterShare, 0);
  assert.deepEqual(sim.rehearse(sim.PRESETS.desk), sim.rehearse(sim.PRESETS.desk));
});

test("scenarios round-trip through links, and bad ones are refused", () => {
  for (const p of Object.values(sim.PRESETS)) {
    const s = sim.validate(p);
    assert.deepEqual(sim.fromQuery("?" + sim.toQuery(s)), s);
  }
  assert.deepEqual(sim.fromQuery("?preset=desk"), sim.validate(sim.PRESETS.desk));
  assert.equal(sim.fromQuery("?nothing=1"), null);
  const bad = (patch, why) => assert.throws(() => sim.validate({ ...sim.PRESETS.cafe, ...patch }), why);
  bad({ arrivals: [] }, /between 1 and 24/);
  bad({ arrivals: [1.5, 2, 3, 4, 5, 6, 7, 8] }, /whole numbers/);
  bad({ plan: [1, 2] }, /Every hour/);
  bad({ serviceMinutes: 0 }, /service time/);
  bad({ variability: "wild" }, /vary/);
  bad({ runs: 7 }, /simulated days/);
  bad({ open: 24 }, /opening hour/);
  bad({ open: -1 }, /opening hour/);
  assert.equal(sim.validate({ ...sim.PRESETS.cafe, name: "<b>x</b>\n".repeat(30) }).name.length, 80);
});

test("the words: every assumption is listed and the summary says it's a simulation", () => {
  const r = sim.rehearse(sim.PRESETS.cafe);
  const a = sim.assumptions(r.scenario);
  assert.equal(a.length, 10);
  assert.ok(a.some((x) => x.includes("2.5 minutes")));
  const text = sim.summaryText(r, { url: "https://example.org/?x" });
  assert.match(text, /A simulation, not a forecast/);
  for (const line of a) assert.ok(text.includes(line));
  const csv = sim.hourlyCsv(r);
  assert.equal(csv.trim().split(/\r?\n/).length, 2 + r.scenario.arrivals.length);
  assert.equal(sim.hourLabel(0), "12am");
  assert.equal(sim.hourLabel(13), "1pm");
  assert.equal(sim.hourLabel(24), "12am");
});
