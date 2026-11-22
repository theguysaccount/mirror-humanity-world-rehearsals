# Operations

Shift Rehearsal runs itself on GitHub: Pages hosts it, Actions runs every recurring job. Nothing needs a person for it to keep working. It is a new tool; the original Mirror Humanity app is maintained elsewhere and nothing here touches it.

**Live:** https://theguysaccount.github.io/mirror-humanity-world-rehearsals/
**Repo:** https://github.com/theguysaccount/mirror-humanity-world-rehearsals

## Automated jobs

| Job | Workflow | When | What it does | How it fails safe |
|---|---|---|---|---|
| Deploy | `pages.yml` | every push to `main` that touches the site; on demand | Simulation regression tests (the model against Erlang C, the M/G/1 formula and Little's law; customer conservation; edge cases) and build tests; builds `dist/` (the staffing table and the method page's checks are computed by the model); uses the tool in headless Chrome at desktop and phone sizes and in dark mode (fails on any console error, request to another site, or sideways scrolling); deploys; waits for the new build to be served and checks every page; repeats the run-through live; pings IndexNow | Any failure before deploy stops the run, so the last good site stays live. IndexNow problems are warnings. |
| Self-test + keep-alive | `selftest.yml` | Fridays 13:37 UTC; on demand | The same regression tests; rebuilds with the deploy's settings; checks every live page (200, own canonical, share image), robots.txt, the IndexNow key file, the 404 page, and that the live build is the one main produces; repeats the live run-through (a page smoke test). **Staleness check:** if the live build is behind main and no deploy is running, it dispatches `pages.yml`. | On failure it opens (or comments on) one `ops-alert` issue and GitHub emails the repo owner; the next clean run closes it. |
| Keep-alive | `selftest.yml` → `scripts/keepalive.sh` | every self-test run | Re-enables every scheduled workflow (unless a person disabled it); pushes an empty `[skip ci]` commit when the last commit is 45+ days old | GitHub disables scheduled workflows after 60 days without repository activity. |

The regression tests use fixed seeds, so they're exact and repeatable: a failure means the code changed, not bad luck. Every job is safe to re-run and nothing depends on a run firing at an exact time.

**Temporary line to remove:** `selftest.yml` has a second cron, `29,59 * 22-24 11 *`, that only runs on 22–24 November 2026 to prove the schedule trigger. Remove it once a scheduled run has passed.

## What to watch

- **Open `ops-alert` issues** (GitHub emails the account owner).
- **Issues from users** saying a result looks wrong: reproduce it from their scenario link (it carries every input and gives the same numbers).

## Run anything by hand

```bash
~/.local/bin/gh workflow run selftest.yml -R theguysaccount/mirror-humanity-world-rehearsals
~/.local/bin/gh workflow run pages.yml -R theguysaccount/mirror-humanity-world-rehearsals
node scripts/e2e.mjs https://theguysaccount.github.io/mirror-humanity-world-rehearsals/
```

## Keys Jack can turn later

Nothing below is needed for the tool to work.

### 1. Custom domain

One setting holds the address: the repository variable `SITE_URL` (default `https://theguysaccount.github.io/mirror-humanity-world-rehearsals`). Canonical URLs, the sitemap, robots.txt, the links in summaries and IndexNow follow it. Scenario links keep working after the move (GitHub redirects the old address with its query). Reality checks are saved per web address; if people use them by then, first set `MOVE_NOTICE_URL` to the new address and run `pages.yml` so the tool warns them.

Steps (replace `shifts.example.com`):
1. DNS at the registrar. Subdomain: `CNAME shifts` → `theguysaccount.github.io`. Apex: `A @` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; `AAAA @` → `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`; `CNAME www` → `theguysaccount.github.io`.
2. `~/.local/bin/gh api -X PUT repos/theguysaccount/mirror-humanity-world-rehearsals/pages -f cname=shifts.example.com`
3. When `~/.local/bin/gh api repos/theguysaccount/mirror-humanity-world-rehearsals/pages --jq .https_certificate.state` says `approved`: `~/.local/bin/gh api -X PUT repos/theguysaccount/mirror-humanity-world-rehearsals/pages -F https_enforced=true`
4. `~/.local/bin/gh variable set SITE_URL -R theguysaccount/mirror-humanity-world-rehearsals -b https://shifts.example.com` (no trailing slash); delete `MOVE_NOTICE_URL` if set.
5. `~/.local/bin/gh workflow run pages.yml -R theguysaccount/mirror-humanity-world-rehearsals`

### 2. Money: saved, scored studies

GitHub Pages is non-commercial, so the tool sells nothing. The brief's optional key is Stripe-paid saved and scored studies on separate hosting: scenarios kept over time, reality checks across a team, and a running accuracy score (the evaluator's "honest predict-observe-score ledger"). The slot is a footer link and a section on About, hidden until a link exists.

- Build it elsewhere, then `~/.local/bin/gh variable set STUDIES_URL -R theguysaccount/mirror-humanity-world-rehearsals -b https://…` (https only), optionally `STUDIES_LABEL`, and run `pages.yml`.

### 3. Analytics (activation metric)

Off by default. Events already in the code: `preset_cafe`/`preset_desk`/`preset_event`, `suggest`, `copy_link` and `summary` (**activation**: a scenario taken away), `reality_check`. No scenario numbers are ever sent.

- Create a free GoatCounter site, then `~/.local/bin/gh variable set GOATCOUNTER_URL -R theguysaccount/mirror-humanity-world-rehearsals -b https://<code>.goatcounter.com/count` and run `pages.yml`.

### 4. Search Console

Verify the site in Google Search Console (needs a Google account; easiest after the domain move) and submit `/sitemap.xml`.

### 5. The evaluator's cheapest test (needs a real café)

"Run one staffing prediction for a real café against its POS data." The tool is ready for it: put a week of the café's customers per hour and a timed service sample into a scenario, run it, then record the real average wait in the reality check. That needs a café willing to share its numbers, which a machine can't arrange.

### 6. Content routine (optional)

No recurring content is needed. If more examples would help search, a quarterly Claude routine can add one preset (for example a pharmacy counter or a bike repair desk) to `PRESETS` in `site/assets/sim.js`, labelled an illustration, then run `node --test tests/*.test.mjs` and `node scripts/build.mjs && node scripts/e2e.mjs`, commit and push.
