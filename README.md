# Startup Scout (Mac mini harness)

Finds startups worth applying to, scored equally on **growth potential**, **learning experience**, and
**closeness to real LLM training work** (pretraining/fine-tuning/RLHF/post-training — not "wraps an API").
Sends a daily email digest of what's new. **It never applies, emails, or contacts any company on your
behalf** — output only, for you to act on.

Uses the `claude` CLI on the mini (OAuth, no API key), same pattern as the outreach harnesses.

## Control
- Stop everything now:  `touch ~/.startup-scout/STOP`   (resume: `rm` it)
- Run once now:         `launchctl kickstart gui/$(id -u)/com.sushanth.startup-scout`
- Dry run (no email, no dedupe-file write): `set -a && . ~/.startup-scout/env && set +a && DRY_RUN=1 ./node_modules/.bin/tsx harness/run.ts`
- Logs / history:       `~/.startup-scout/logs/`, `~/.startup-scout/runs.jsonl`
- Seen companies:       `~/.startup-scout/seen.json` — delete an entry (or the whole file) to let a company resurface
- Uninstall:            `launchctl bootout gui/$(id -u)/com.sushanth.startup-scout && rm ~/Library/LaunchAgents/com.sushanth.startup-scout.plist`

## Limits (enforced in code, `harness/run.ts`)
<=6 search queries/day - <=15 researched/day - only companies scoring >=55/100 overall get emailed -
a company already surfaced never gets re-surfaced (seen.json) - 30-minute deadline - skips under 400 MB free disk.

## Env (`~/.startup-scout/env`, chmod 600)
`RESEND_API_KEY`, `SCOUT_TO_EMAIL` (your address), `SCOUT_FROM_EMAIL` (e.g. `"Startup Scout <outreach@calldesk.tech>"`,
reusing an already-verified domain is fine here — this is a to-self notification, not third-party outreach),
optional `SCOUT_QUERIES_PER_DAY`, `SCOUT_RESEARCH_LIMIT`, `SCOUT_MIN_OVERALL`, `SCOUT_DEADLINE_MIN`.
