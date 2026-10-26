import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { findHistoricCandidates, exaSpent, HISTORIC_QUERIES } from '../src/discovery';
import { loadSeen } from '../src/store';
import { addFound, importSeen, loadCompanies, saveCompanies } from '../src/companies';
import { writeReport } from '../src/report';

// One-off (re-runnable) historical pass: startups that were in the funding /
// hiring news in past months, verified against their own site, added to
// companies.json as 'queued' for the daily run to research a few at a time. Uses Exa only; no claude CLI, no email.
//   SCOUT_BACKFILL_MONTHS  months back to cover (default 12, max 36)
//   DRY_RUN=1              print what would be added, write nothing
//   Cost is ~$0.07 per (month x query), measured: summaries plus a ~$0.007 lookup per company without a stated homepage.

const BASE = join(homedir(), '.startup-scout');
const SEEN_PATH = join(BASE, 'seen.json');
const dryRun = process.env.DRY_RUN === '1';
const STORE_PATH = join(BASE, dryRun ? 'companies.dry.json' : 'companies.json');
const REPORT_PATH = join(BASE, dryRun ? 'report.dry.html' : 'report.html');
const months = Math.min(36, Math.max(1, Math.floor(Number(process.env.SCOUT_BACKFILL_MONTHS) || 12)));

function monthWindows(n: number): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  const now = new Date();
  for (let i = 1; i <= n; i++) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    out.push({ start: start.toISOString(), end: end.toISOString() });
  }
  return out;
}

async function main(): Promise<number> {
  mkdirSync(BASE, { recursive: true });
  if (existsSync(join(BASE, 'STOP'))) { console.log('STOP file present, not running'); return 0; }
  const store = loadCompanies(dryRun && !existsSync(STORE_PATH) ? join(BASE, 'companies.json') : STORE_PATH);
  importSeen(store, loadSeen(SEEN_PATH));
  const windows = monthWindows(months);
  const searches = windows.length * HISTORIC_QUERIES.length;
  console.log(`backfill: ${months} months x ${HISTORIC_QUERIES.length} queries = ${searches} searches (~$${(searches * 0.07).toFixed(2)}), already known ${store.size}`);

  const { candidates, errors, raw, rejected } = await findHistoricCandidates(
    windows, HISTORIC_QUERIES, () => existsSync(join(BASE, 'STOP')), (d) => { const s = store.get(d)?.status; return s !== undefined && s !== 'unverified'; },
  );
  let added = 0;
  for (const c of candidates) if (addFound(store, c, 'queued', 'backfill')) added++;
  for (const d of rejected) addFound(store, { name: d, domain: d, blurb: null, careersUrl: null }, 'unverified', 'backfill');
  saveCompanies(STORE_PATH, store);
  writeReport(REPORT_PATH, store);
  console.log(JSON.stringify({ dryRun, raw, verified: candidates.length, rejected: rejected.length, added, storeSize: store.size, exaCostUsd: Math.round(exaSpent() * 1e4) / 1e4, errors }, null, 1));
  if (dryRun) for (const c of candidates) console.log(`  - ${c.name} <${c.domain}> :: ${c.blurb?.slice(0, 100)}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('backfill crashed:', e); process.exit(1); });
