// Optional discovery backend: Exa search instead of `claude -p` + WebSearch.
// Enabled with SCOUT_DISCOVERY=exa and EXA_API_KEY. Returns the same shape the
// CLI path produces, so verification, dedupe and scoring downstream are unchanged.

const ENDPOINT = 'https://api.exa.ai/search';

export interface ExaCandidate {
  name: string;
  website: string;
  careersUrl: null;
  location: null;
  blurb: string | null;
}

export interface ExaResult {
  items: ExaCandidate[];
  costUsd: number;
}

interface RawResult {
  url?: string;
  title?: string;
  text?: string;
  summary?: string;
  publishedDate?: string;
}
interface RawBody {
  results?: RawResult[];
  costDollars?: { total?: number };
}

async function post(body: object, apiKey: string): Promise<RawBody> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Exa HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as RawBody;
}

// Exa titles look like "Acme | We train models for X"; keep the company part.
const nameFromTitle = (title: string | undefined, url: string): string => {
  const first = (title ?? '').split(/\s[|–—-]\s|:\s/)[0].trim();
  return first || new URL(url).hostname.replace(/^www\./, '');
};

const withScheme = (u: string): string => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

export async function exaSearch(query: string, apiKey: string, numResults = 10): Promise<ExaResult> {
  const body = await post(
    { query, numResults, type: 'auto', category: 'company', contents: { text: { maxCharacters: 400 } } },
    apiKey,
  );
  const items: ExaCandidate[] = [];
  for (const r of body.results ?? []) {
    if (!r.url) continue;
    items.push({
      name: nameFromTitle(r.title, r.url),
      website: r.url,
      careersUrl: null,
      location: null,
      blurb: r.text ? r.text.replace(/\s+/g, ' ').trim().slice(0, 300) : null,
    });
  }
  return { items, costUsd: body.costDollars?.total ?? 0 };
}

const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Company homepage for a name, via the company index. Only accepts a hit whose
// host or title contains the company name, so a wrong guess is dropped, not used.
async function resolveHomepage(name: string, apiKey: string): Promise<{ website: string | null; costUsd: number }> {
  const body = await post({ query: `${name} startup`, numResults: 3, type: 'auto', category: 'company' }, apiKey);
  const want = normName(name);
  for (const r of body.results ?? []) {
    if (!r.url || want.length < 3) continue;
    const host = normName(new URL(r.url).hostname.replace(/^www\./, ''));
    if (host.includes(want) || normName(r.title ?? '').startsWith(want)) {
      return { website: r.url, costUsd: body.costDollars?.total ?? 0 };
    }
  }
  return { website: null, costUsd: body.costDollars?.total ?? 0 };
}

// Funding/hiring news inside a date window -> the startups that were in the news
// then. The company index has no date filter, so this goes through news articles
// and pulls out the company they are about with a structured summary.
export async function exaWindowSearch(
  query: string,
  apiKey: string,
  startIso: string,
  endIso: string,
  numResults = 10,
): Promise<ExaResult> {
  const body = await post(
    {
      query,
      numResults,
      type: 'auto',
      category: 'news',
      startPublishedDate: startIso,
      endPublishedDate: endIso,
      contents: {
        summary: {
          query: 'Which startup is the subject of this article?',
          schema: {
            type: 'object',
            properties: {
              companyName: { type: 'string' },
              companyWebsite: { type: 'string', description: "the startup's own homepage URL if stated in the article, else empty" },
              whatTheyBuild: { type: 'string' },
              stage: { type: 'string' },
            },
          },
        },
      },
    },
    apiKey,
  );
  let costUsd = body.costDollars?.total ?? 0;
  const items: ExaCandidate[] = [];
  const done = new Set<string>();
  for (const r of body.results ?? []) {
    let s: { companyName?: unknown; companyWebsite?: unknown; whatTheyBuild?: unknown; stage?: unknown };
    try { s = JSON.parse(r.summary ?? ''); } catch { continue; }
    if (typeof s.companyName !== 'string' || !s.companyName.trim()) continue;
    const name = s.companyName.trim().slice(0, 120);
    if (done.has(normName(name))) continue;
    done.add(normName(name));
    let website = typeof s.companyWebsite === 'string' && s.companyWebsite.trim() ? withScheme(s.companyWebsite.trim()) : null;
    if (!website) {
      try {
        const hit = await resolveHomepage(name, apiKey);
        costUsd += hit.costUsd;
        website = hit.website;
      } catch { /* leave unresolved; dropped below */ }
    }
    if (!website) continue;
    const what = typeof s.whatTheyBuild === 'string' ? s.whatTheyBuild : '';
    const stage = typeof s.stage === 'string' && s.stage && s.stage !== 'null' ? `${s.stage}, ` : '';
    const when = r.publishedDate ? r.publishedDate.slice(0, 7) : '';
    items.push({
      name,
      website,
      careersUrl: null,
      location: null,
      blurb: `${stage}in the news ${when}: ${what}`.replace(/\s+/g, ' ').trim().slice(0, 300),
    });
  }
  return { items, costUsd };
}
