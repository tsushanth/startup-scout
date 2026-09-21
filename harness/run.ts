import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { findCandidates } from '../src/discovery';
import { researchCandidate } from '../src/research';
import { loadSeen, saveSeen } from '../src/store';
import { sendDigest, type DigestItem } from '../src/digest';

// One bounded daily pass: discover candidate startups, verify each looks
// real, research+score the new ones, email a digest of what's new. Never
// applies, emails, or contacts any company — output only, to the user.
// Guards, same shape as the other Mac mini harnesses:
//   STOP file    -> run nothing (touch ~/.startup-scout/STOP)
//   disk floor   -> skip if under 400 MB free
//   deadline     -> winds down cleanly (default 30 min)
//   dedupe       -> a company already surfaced never gets emailed twice

const BASE = join(homedir(), '.startup-scout');
const STOP = join(BASE, 'STOP');
const SEEN_PATH = join(BASE, 'seen.json');
const RUNS = join(BASE, 'runs.jsonl');
const MIN_FREE_MB = 400;
const dryRun = process.env.DRY_RUN === '1';

const clamp = (v: unknown, max: number, fallback: number) => {
  const n = Number(v);
  return Math.min(max, Math.max(0, Number.isFinite(n) ? Math.floor(n) : fallback));
};
const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

function freeMb(): number {
  try { return Math.floor(Number(execSync("df -k / | awk 'NR==2 {print $4}'").toString().trim()) / 1024); } catch { return Infinity; }
}

async function main(): Promise<number> {
  mkdirSync(BASE, { recursive: true });
  if (existsSync(STOP)) { log('STOP file present, not running'); return 0; }
  const free = freeMb();
  if (free < MIN_FREE_MB) { console.error(`only ${free} MB free, skipping`); return 2; }

  const started = Date.now();
  const deadlineMs = clamp(process.env.SCOUT_DEADLINE_MIN, 60, 30) * 60_000;
  const stop = () => existsSync(STOP) || Date.now() - started > deadlineMs;

  const perDay = clamp(process.env.SCOUT_QUERIES_PER_DAY, 6, 3);
  const researchLimit = clamp(process.env.SCOUT_RESEARCH_LIMIT, 15, 6);
  const minOverall = clamp(process.env.SCOUT_MIN_OVERALL, 100, 55);

  const seen = loadSeen(SEEN_PATH);
  const summary = { at: new Date().toISOString(), dryRun, candidates: 0, researched: 0, emailed: 0, errors: [] as string[] };

  const { candidates, errors, raw, rejected } = await findCandidates(perDay, stop);
  summary.candidates = candidates.length;
  summary.errors.push(...errors);
  log(`found ${candidates.length} verified candidates (raw ${raw}, rejected ${rejected.length}) via ${perDay} queries`);

  const items: DigestItem[] = [];
  for (const c of candidates) {
    if (stop()) break;
    if (seen.has(c.domain)) continue; // already surfaced before
    try {
      const score = researchCandidate({ name: c.name, domain: c.domain, blurb: c.blurb });
      summary.researched++;
      seen.set(c.domain, { name: c.name, firstSeenAt: new Date().toISOString(), overall: score.overall });
      if (score.overall < minOverall) { log(`skip ${c.name}: overall ${score.overall} < ${minOverall}`); continue; }
      items.push({
        name: c.name, domain: c.domain, careersUrl: c.careersUrl, overall: score.overall,
        growthPotential: score.growthPotential, learningExperience: score.learningExperience,
        llmTrainingCloseness: score.llmTrainingCloseness, reasons: score.reasons, sources: score.sources,
      });
      if (items.length >= researchLimit) break;
    } catch (error) {
      summary.errors.push(`research ${c.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!dryRun) saveSeen(SEEN_PATH, seen);

  if (items.length && !dryRun) {
    const to = process.env.SCOUT_TO_EMAIL;
    const from = process.env.SCOUT_FROM_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;
    if (!to || !from || !apiKey) {
      summary.errors.push('SCOUT_TO_EMAIL / SCOUT_FROM_EMAIL / RESEND_API_KEY not fully configured; digest not sent');
    } else {
      const result = await sendDigest(to, from, apiKey, items);
      if (result.ok) { summary.emailed = items.length; log(`digest sent: ${items.length} companies`); }
      else summary.errors.push(`digest send failed: ${result.error}`);
    }
  } else if (items.length && dryRun) {
    log(`DRY RUN: would email digest with ${items.length} companies`);
    for (const it of items) log(`  - ${it.name} (${it.domain}) overall=${it.overall}`);
  } else {
    log('nothing new above the score threshold today');
  }

  appendFileSync(RUNS, JSON.stringify(summary) + '\n');
  console.log(JSON.stringify(summary, null, 1));
  return summary.errors.length && !items.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((error) => { console.error('harness crashed:', error); process.exit(1); });
