# State (2026-11-22)

- **Existing material (read only, untouched):** the original Mirror Humanity app, a larger world-rehearsal workspace with a staffing page among other tools. It was read for context only; nothing in it, its database or its deployment was copied or changed.
- **What was built:** the brief asked for a new, small, client-side tool, not a rebuild. Shift Rehearsal is written from scratch (no copied code) around one wedge: staffing and queue decisions, with assumptions visible and results labelled as simulations.
- **What works now:** a live static simulator with three examples, hour-by-hour inputs, Erlang C suggestions, paired baseline-vs-plan rehearsals over 100 to 1,000 days, a chart, plain-language assumptions, text and CSV downloads, scenario links, and a local reality-check log. Two workflows: deploy on push; weekly regression tests plus live checks and keep-alive.
- **What's limited:** one line, one server pool, no breaks or multi-skill staff; the reality check is per browser. No analytics until a key is set.
- **Worth reusing:** `sim.js` (seeded event-driven multi-server queue with abandonment and hourly staffing, Erlang C, gamma sampling) and its regression tests.
