import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';
import { findCandidates, exaSpent } from '../src/discovery';
import { researchCandidate } from '../src/research';
import { loadSeen } from '../src/store';
import { addFound, importSeen, loadCompanies, saveCompanies } from '../src/companies';
import { writeReport } from '../src/report';
import { sendDigest, type DigestItem } from '../src/digest';

// One bounded daily pass: discover candidate startups, verify each looks
// real, research+score the queued ones, and PERSIST everything found to
// companies.json (+ a browsable report.html). Email is opt-in (SCOUT_SEND_DIGEST=1).
// Never applies, emails, or contacts any company — output only, for the user.
// Guards, same shape as the other Mac mini harnesses:
//   STOP file    -> run nothing (touch ~/.startup-scout/STOP)
//   disk floor   -> skip if under 400 MB free
//   deadline     -> winds down cleanly (default 30 min)
//   cap          -> at most 15 companies researched per run
//   dedupe       -> a domain already in companies.json is never researched twice
//   DRY_RUN=1    -> writes companies.dry.json / report.dry.html only, never the live files

const BASE = join(homedir(), '.startup-scout');
const STOP = join(BASE, 'STOP');
const SEEN_PATH = join(BASE, 'seen.json'); // legacy, read once to seed companies.json
const RUNS = join(BASE, 'runs.jsonl');
const MIN_FREE_MB = 400;
const dryRun = process.env.DRY_RUN === '1';
const STORE_PATH = join(BASE, dryRun ? 'companies.dry.json' : 'companies.json');
const REPORT_PATH = join(BASE, dryRun ? 'report.dry.html' : 'report.html');

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
  const minOverall = clamp(process.env.SCOUT_MIN_OVERALL, 100, 55); // only affects the optional email
  const maxResearch = clamp(process.env.SCOUT_MAX_RESEARCH, 15, 15);
  const reserveForBacklog = clamp(process.env.SCOUT_BACKLOG_PER_DAY, 15, 4);

  // In a dry run, start from the live store (read-only) so novelty and the queue are realistic.
  const store = loadCompanies(dryRun && !existsSync(STORE_PATH) ? join(BASE, 'companies.json') : STORE_PATH);
  const imported = importSeen(store, loadSeen(SEEN_PATH));
  const summary = { at: new Date().toISOString(), dryRun, discovery: process.env.SCOUT_DISCOVERY || 'cli', exaCostUsd: 0, candidates: 0, newFound: 0, researched: 0, queuedLeft: 0, emailed: 0, errors: [] as string[] };
  if (imported) log(`imported ${imported} companies from seen.json`);

  const { candidates, errors, raw, rejected } = await findCandidates(perDay, stop);
  summary.candidates = candidates.length;
  summary.exaCostUsd = Math.round(exaSpent() * 1e4) / 1e4;
  summary.errors.push(...errors);
  log(`found ${candidates.length} verified candidates (raw ${raw}, rejected ${rejected.length}) via ${perDay} queries`);

  // Persist everything found, before any research, so a crash or the cap loses nothing.
  const freshDomains = new Set<string>();
  for (const c of candidates) if (addFound(store, c, 'queued', 'daily')) { freshDomains.add(c.domain); summary.newFound++; }
  for (const d of rejected) addFound(store, { name: d, domain: d, blurb: null, careersUrl: null }, 'unverified', 'daily');
  saveCompanies(STORE_PATH, store);

  // Today's fresh finds first, but keep some slots for the older backlog so it drains.
  const queued = [...store.values()].filter((r) => r.status === 'queued');
  const fresh = queued.filter((r) => freshDomains.has(r.domain));
  const older = queued.filter((r) => !freshDomains.has(r.domain)).sort((a, b) => a.firstFoundAt.localeCompare(b.firstFoundAt));
  const reserve = Math.min(reserveForBacklog, older.length);
  const picked = [...fresh.slice(0, maxResearch - reserve), ...older.slice(0, reserve)];
  for (const r of [...fresh.slice(maxResearch - reserve), ...older.slice(reserve)]) {
    if (picked.length >= maxResearch) break;
    picked.push(r);
  }

  const items: DigestItem[] = [];
  for (const rec of picked) {
    if (stop()) break;
    try {
      const score = researchCandidate({ name: rec.name, domain: rec.domain, blurb: rec.blurb });
      summary.researched++;
      Object.assign(rec, {
        status: 'researched', researchedAt: new Date().toISOString(), lastError: undefined,
        growthPotential: score.growthPotential, learningExperience: score.learningExperience,
        llmTrainingCloseness: score.llmTrainingCloseness, overall: score.overall,
        reasons: score.reasons, sources: score.sources,
      });
      if (score.overall >= minOverall) {
        items.push({
          name: rec.name, domain: rec.domain, careersUrl: rec.careersUrl, overall: score.overall,
          growthPotential: score.growthPotential, learningExperience: score.learningExperience,
          llmTrainingCloseness: score.llmTrainingCloseness, reasons: score.reasons, sources: score.sources,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      summary.errors.push(`research ${rec.name}: ${msg}`);
      rec.lastError = msg.slice(0, 300); // stays queued: retried on a later run
    }
    saveCompanies(STORE_PATH, store); // after each company, so a mid-run kill keeps the work
  }

  summary.queuedLeft = [...store.values()].filter((r) => r.status === 'queued').length;
  saveCompanies(STORE_PATH, store);
  writeReport(REPORT_PATH, store);
  log(`store: ${store.size} companies, ${summary.queuedLeft} queued; report at ${REPORT_PATH}`);

  if (process.env.SCOUT_SEND_DIGEST === '1' && items.length && !dryRun) {
    const to = process.env.SCOUT_TO_EMAIL;
    const from = process.env.SCOUT_FROM_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;
    if (!to || !from || !apiKey) {
      summary.errors.push('SCOUT_TO_EMAIL / SCOUT_FROM_EMAIL / RESEND_API_KEY not fully configured; digest not sent');
    } else {
      const result = await sendDigest(to, from, apiKey, items);
      if (result.ok) {
        summary.emailed = items.length;
        for (const it of items) { const r = store.get(it.domain); if (r) r.emailed = true; }
        saveCompanies(STORE_PATH, store);
        log(`digest sent: ${items.length} companies`);
      } else summary.errors.push(`digest send failed: ${result.error}`);
    }
  }

  appendFileSync(RUNS, JSON.stringify(summary) + '\n');
  console.log(JSON.stringify(summary, null, 1));
  return summary.errors.length && !summary.researched ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((error) => { console.error('harness crashed:', error); process.exit(1); });
