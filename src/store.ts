import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

// Simple local dedupe store: a JSON file on the mini, keyed by domain, so a
// company already surfaced (and emailed) never gets re-surfaced. No cloud
// dependency needed — this is single-machine, personal-use state.

export interface SeenEntry {
  name: string;
  firstSeenAt: string;
  overall: number;
}

export function loadSeen(path: string): Map<string, SeenEntry> {
  if (!existsSync(path)) return new Map();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, SeenEntry>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

export function saveSeen(path: string, seen: Map<string, SeenEntry>): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(Object.fromEntries(seen), null, 1));
}
