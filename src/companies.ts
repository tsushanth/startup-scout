import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import type { SeenEntry } from './store';

// The permanent record of everything the scout has ever found, and the queue the
// daily run works through. A company is never deleted: it moves queued ->
// researched (with full scores, reasons and sources), or is kept as unverified /
// error so nothing found is lost. `status: 'queued'` is the backlog.

export type CompanyStatus = 'queued' | 'researched' | 'unverified' | 'error';

export interface CompanyRecord {
  domain: string;
  name: string;
  blurb: string | null;
  careersUrl: string | null;
  status: CompanyStatus;
  source: 'daily' | 'backfill' | 'imported';
  firstFoundAt: string;
  researchedAt?: string;
  growthPotential?: number;
  learningExperience?: number;
  llmTrainingCloseness?: number;
  overall?: number;
  reasons?: string[];
  sources?: string[];
  emailed?: boolean;
  lastError?: string;
}

export function loadCompanies(path: string): Map<string, CompanyRecord> {
  if (!existsSync(path)) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(path, 'utf8')) as Record<string, CompanyRecord>));
  } catch {
    // Never silently start empty over a file we could not parse: keep a copy first.
    renameSync(path, `${path}.corrupt-${Date.now()}`);
    return new Map();
  }
}

// Write-then-rename so a crash mid-write cannot truncate the store.
export function saveCompanies(path: string, companies: Map<string, CompanyRecord>): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(Object.fromEntries(companies), null, 1));
  renameSync(tmp, path);
}

// One-time bridge from the old seen.json: those companies were already surfaced,
// so they count as researched (without details, which the old format never kept).
export function importSeen(companies: Map<string, CompanyRecord>, seen: Map<string, SeenEntry>): number {
  let n = 0;
  for (const [domain, s] of seen) {
    if (companies.has(domain)) continue;
    companies.set(domain, {
      domain, name: s.name, blurb: null, careersUrl: null, status: 'researched', source: 'imported',
      firstFoundAt: s.firstSeenAt, researchedAt: s.firstSeenAt, overall: s.overall,
    });
    n++;
  }
  return n;
}

export function addFound(
  companies: Map<string, CompanyRecord>,
  c: { name: string; domain: string; blurb: string | null; careersUrl: string | null },
  status: CompanyStatus,
  source: 'daily' | 'backfill',
): boolean {
  const existing = companies.get(c.domain);
  // A site that failed the check once (maybe transiently) gets another chance when it verifies later.
  if (existing && !(existing.status === 'unverified' && status !== 'unverified')) return false;
  companies.set(c.domain, {
    domain: c.domain, name: c.name, blurb: c.blurb, careersUrl: c.careersUrl,
    status, source, firstFoundAt: new Date().toISOString(),
  });
  return true;
}
