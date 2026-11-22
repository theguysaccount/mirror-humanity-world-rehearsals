# Launch and distribution

Live at https://theguysaccount.github.io/mirror-humanity-world-rehearsals/. Machine channels only: nothing is posted by or as a person, and nothing is sent to anyone. The original Mirror Humanity app and its live deployment were not touched.

## Channels that run themselves

| Channel | How |
|---|---|
| Search | The simulator ("how many staff do I need", "queue wait time calculator", "staffing calculator for a café"), the staffing guide and table ("how many staff for 100 customers an hour", "Erlang C staffing table"), and the method page ("queue simulation", "Erlang C vs simulation"). Each page has its own title, description, canonical, Open Graph card and structured data. |
| IndexNow | Every deploy submits every URL in the live sitemap. |
| Account root | `theguysaccount.github.io/robots.txt` lists this sitemap automatically within a day. |
| Share loop | Every scenario is a link, and the downloaded summary ends with it; owners send them to partners, managers and accountants. |
| GitHub | Public repo with description, topics and README. |

## The first 1,000 users (machine plan)

1. **Days 1–7:** IndexNow covers Bing-family engines. Google needs Search Console (OPERATIONS.md, key 4).
2. **Ongoing:** the staffing table answers the most common question directly and links into the simulator.
3. Targets at 30 days, once analytics are on: 1,000 visits, 25% change an input, 10% copy a link or download a summary, and the first reality checks (the evaluator's swing factor: whether a real day lands inside the simulated range).

## Production domain

Not this session's job: the domain rollout session picks and points the domain. The switch is one repository variable plus the Pages custom-domain setting (OPERATIONS.md, key 1). Nothing has been changed in DNS.
