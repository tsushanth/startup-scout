# Startup Scout (Mac mini harness)

Finds startups worth applying to, scored equally on **growth potential**, **learning experience**, and
**closeness to real LLM training work** (pretraining/fine-tuning/RLHF/post-training — not "wraps an API").
Persists everything it finds to `~/.startup-scout/companies.json` and regenerates a browsable `~/.startup-scout/report.html` (sort/filter, scores, reasons, sources) on every run. A daily email digest is optional (`SCOUT_SEND_DIGEST=1`, off by default). **It never applies, emails, or contacts any company on your
behalf** — output only, for you to act on.

Uses the `claude` CLI on the mini (OAuth, no API key), same pattern as the outreach harnesses.

## Control
- Stop everything now:  `touch ~/.startup-scout/STOP`   (resume: `rm` it)
- Run once now:         `launchctl kickstart gui/$(id -u)/com.sushanth.startup-scout`
- Dry run (no email, no dedupe-file write): `set -a && . ~/.startup-scout/env && set +a && DRY_RUN=1 ./node_modules/.bin/tsx harness/run.ts`
- Logs / history:       `~/.startup-scout/logs/`, `~/.startup-scout/runs.jsonl`
- Seen companies:       `~/.startup-scout/seen.json` — delete an entry (or the whole file) to let a company resurface
- Uninstall:            `launchctl bootout gui/$(id -u)/com.sushanth.startup-scout && rm ~/Library/LaunchAgents/com.sushanth.startup-scout.plist`

## Data
- `companies.json`: every company ever found (status `queued` / `researched` / `unverified` / `error`). `queued` is the backlog the daily run works through, at most 15 researched per run, oldest backlog slots reserved (`SCOUT_BACKLOG_PER_DAY`, default 4). Nothing is deleted.
- `report.html`: open in a browser. `seen.json` is legacy, imported once.
- Exa discovery: `SCOUT_DISCOVERY=exa` + `EXA_API_KEY` (default is the `claude -p` WebSearch path).
- Past startups: `SCOUT_BACKFILL_MONTHS=12 npx tsx harness/backfill.ts` (Exa news per month, ~$0.07 per month x query), adds to the queue; `DRY_RUN=1` writes only `*.dry.*` files.

## Limits (enforced in code, `harness/run.ts`)
<=6 search queries/day - <=15 researched/day - (email only, if enabled) companies scoring >=55/100 overall -
a company already in companies.json is never researched twice - 30-minute deadline - skips under 400 MB free disk.

## Env (`~/.startup-scout/env`, chmod 600)
`RESEND_API_KEY`, `SCOUT_TO_EMAIL` (your address), `SCOUT_FROM_EMAIL` (e.g. `"Startup Scout <outreach@calldesk.tech>"`,
reusing an already-verified domain is fine here — this is a to-self notification, not third-party outreach),
optional `SCOUT_QUERIES_PER_DAY`, `SCOUT_RESEARCH_LIMIT`, `SCOUT_MIN_OVERALL`, `SCOUT_DEADLINE_MIN`.
