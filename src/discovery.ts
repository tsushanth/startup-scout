import { hostOf } from './util';
import { politeFetchText } from './http';
import { cliComplete, extractJson } from './llm';

// Finds startups worth applying to: rotating web searches across funding
// news, YC batches, AI-research hiring roundups, and "who's hiring" threads.
// The model only proposes candidates; nothing is trusted until the
// company's own careers/site is fetched and actually looks real and hiring.

export interface Candidate {
  name: string;
  domain: string;
  careersUrl: string | null;
  blurb: string | null;
  location: string | null;
}

// Deliberately varied angles so the daily rotation doesn't just re-find the
// same "top AI startups" listicles every time.
const QUERIES = [
  'seed or Series A funding announcement LLM training infrastructure startup',
  'YC latest batch startup foundation model pretraining fine-tuning',
  'startup hiring machine learning engineer RLHF post-training',
  'AI research lab startup hiring evals data engineering for LLMs',
  'startup building LLM inference infrastructure raised funding',
  'small AI startup team building own foundation models hiring',
  'startup applying reinforcement learning to LLM training hiring engineer',
  'AI infra startup Series A hiring research engineer',
];

export function queriesForDay(now = new Date(), perDay = 3): string[] {
  const dayNumber = Math.floor(now.getTime() / 86_400_000);
  return Array.from({ length: perDay }, (_, i) => QUERIES[(dayNumber * perDay + i) % QUERIES.length]);
}

const EXCLUDED_HOSTS = [
  'linkedin.com', 'twitter.com', 'x.com', 'ycombinator.com', 'crunchbase.com', 'techcrunch.com',
  'news.ycombinator.com', 'reddit.com', 'wikipedia.org', 'google.com', 'wellfound.com', 'indeed.com',
  'greenhouse.io', 'lever.co', 'levels.fyi', 'glassdoor.com',
];

const PROMPT = (query: string) => `Search the web for: ${query}

I'm a software engineer looking for startups worth applying to — ones with real growth potential, a strong learning environment, and ideally close to actual LLM training/fine-tuning/RLHF/foundation-model work (not just "AI wrapper" products). Exclude big tech companies, companies that have clearly shut down or gone quiet, and pure news aggregators/directories.

Return ONLY a JSON array (at most 10 items) of objects with keys: name, website (the company's own homepage URL, from the search results), careersUrl (their careers/jobs page URL if you saw one, else null), location (if shown, else null), blurb (one factual sentence about what they build, from what you actually saw). Only include companies you actually saw in the search results. Use at most 4 web searches, then answer immediately. No commentary, no markdown fences.`;

async function runQuery(query: string): Promise<unknown[]> {
  return extractJson<unknown[]>(cliComplete(PROMPT(query), { tools: 'WebSearch', maxTurns: 14, timeoutMs: 300_000 }), 'array') ?? [];
}

const LOOKS_LIKE_REAL_COMPANY = /(careers|jobs|hiring|team|about|mission|engineering blog)/i;

export async function verifyCandidateSite(domain: string): Promise<boolean> {
  const res = await politeFetchText(`https://${domain}`, 12000);
  if (!res.ok || res.text.length < 500) return false;
  return LOOKS_LIKE_REAL_COMPANY.test(res.text.slice(0, 200_000));
}

export async function findCandidates(
  perDay: number,
  shouldStop: () => boolean = () => false,
): Promise<{ candidates: Candidate[]; errors: string[]; raw: number; rejected: string[] }> {
  const errors: string[] = [];
  let raw = 0;
  const byDomain = new Map<string, Candidate>();

  for (const query of queriesForDay(new Date(), perDay)) {
    if (shouldStop()) break;
    try {
      const found = await runQuery(query);
      raw += found.length;
      for (const entry of found) {
        const item = entry as { name?: unknown; website?: unknown; careersUrl?: unknown; location?: unknown; blurb?: unknown };
        if (typeof item.name !== 'string' || typeof item.website !== 'string') continue;
        const domain = hostOf(item.website);
        if (!domain || EXCLUDED_HOSTS.some((h) => domain === h || domain.endsWith(`.${h}`))) continue;
        if (byDomain.has(domain)) continue;
        byDomain.set(domain, {
          name: item.name.trim().slice(0, 120),
          domain,
          careersUrl: typeof item.careersUrl === 'string' ? item.careersUrl.trim().slice(0, 300) : null,
          blurb: typeof item.blurb === 'string' ? item.blurb.trim().slice(0, 400) : null,
          location: typeof item.location === 'string' ? item.location.trim().slice(0, 120) : null,
        });
      }
    } catch (error) {
      errors.push(`search "${query}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const verified: Candidate[] = [];
  const rejected: string[] = [];
  for (const candidate of byDomain.values()) {
    if (shouldStop()) break;
    if (await verifyCandidateSite(candidate.domain)) verified.push(candidate);
    else rejected.push(candidate.domain);
  }
  return { candidates: verified, errors, raw, rejected };
}
