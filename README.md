# Shift Rehearsal

**Live:** https://theguysaccount.github.io/mirror-humanity-world-rehearsals/ · **Screens:** [docs/screens](docs/screens/) · **Operations:** [OPERATIONS.md](OPERATIONS.md)

A free staffing and queue simulator for small operators: cafés, service desks, clinics, event check-in. Put in customers per hour, service time and two staffing plans (what you do now, and a plan). Shift Rehearsal plays the day hundreds of times and compares waits, people who give up, idle staff hours and cost, with every assumption written out next to the result.

**Simulations, not forecasts.** Results show what the stated assumptions imply. They aren't predictions about any real business.

- **Hour-by-hour inputs:** customers arriving, staff now, staff in the plan; the textbook formula's (Erlang C) suggestion beside each hour, and a button to use it as the plan.
- **The model:** random (Poisson) arrivals with an hourly rate, one first-come-first-served line, gamma service times (low, medium or high variability), exponential patience (or nobody leaves), staff changes on the hour, closing with the line served as overtime.
- **Paired days:** both plans see the same customers on every simulated day, so differences come from staffing alone. The seed comes from the scenario, so a link reproduces the same numbers.
- **Results:** served within target, average and slowest-10% waits, people who left, longest line, paid and idle staff hours, cost, each with the middle-80% range; a wait-by-hour chart.
- **Every assumption in plain words**, a downloadable summary (.txt) and hour-by-hour CSV, and a link that carries the whole scenario.
- **Reality check:** after a real shift, record the real average wait; the tool keeps these in the browser and shows how far off its simulations have been.
- **Guides:** "How many staff do I need?" with a staffing table computed by the model, and a method page with this build's checks against queueing theory.

## How it runs

| What | Where | When |
|---|---|---|
| Simulation regression and build tests, build, headless-Chrome run-through, deploy, live check, IndexNow | `.github/workflows/pages.yml` | every push to `main` that touches the site; on demand |
| The same regression tests, live checks, live run-through, redeploy if stale, keep-alive | `.github/workflows/selftest.yml` | weekly (Fridays 13:37 UTC) |

## Layout

```
site/assets/sim.js    the model: random numbers, Erlang C, the event-driven day, paired rehearsals, words
site/assets/art.js    the wait-by-hour chart as an SVG string
site/assets/app.js    the page: form, results, links, downloads, reality checks
scripts/build.mjs     static site generator -> dist/ (the staffing table and method checks come from sim.js)
scripts/e2e.mjs       uses the tool in headless Chrome as an owner would, local or live
tests/sim.test.mjs    regression tests against Erlang C, M/G/1, Little's law and edge cases
```

## Run, test, deploy

Node 22+ and Google Chrome (or Chromium). No `npm install`.

```bash
node scripts/build.mjs && node scripts/lib/serve.mjs dist /mirror-humanity-world-rehearsals/ 8080
node --test tests/*.test.mjs
node scripts/e2e.mjs            # or --live
```

Deploy is a push to `main`.

## Relation to Mirror Humanity

This is a new, small tool written from scratch for the "world rehearsals" idea's staffing wedge. It shares no code with the original Mirror Humanity app, and nothing in the original was changed.

## License

MIT. See [LICENSE](LICENSE).
