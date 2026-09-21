import { cliComplete, extractJson } from './llm';
import { hostOf } from './util';
import type { Candidate } from './discovery';

// Reads a candidate's own site (careers page + homepage) and produces the
// three equal-weighted scores plus a citable reason for each. Trusted only
// if it cites pages on the company's own domain — same discipline as the
// outreach research module, just scoring a company instead of a contact.

export interface ScoreBreakdown {
  growthPotential: number; // 0-100
  learningExperience: number; // 0-100
  llmTrainingCloseness: number; // 0-100
  overall: number; // simple average of the three
  reasons: string[];
  sources: string[];
}

export interface ResearchInput {
  name: string;
  domain: string;
  blurb?: string | null;
}

const PROMPT = (i: ResearchInput) => `You are evaluating a startup as a place a strong software/ML engineer might want to APPLY TO WORK, on three dimensions, equally weighted.

Company: ${i.name}
Website: https://${i.domain}
${i.blurb ? `What I already know: ${i.blurb}\n` : ''}
Fetch the homepage, the careers/jobs page if one exists, and at most 2 other pages (about, engineering blog). Use ONLY what you actually read on those pages. Do not guess or fill gaps from memory or general reputation.

Score each dimension 0-100, with one factual reason each:
- growthPotential: signals of real traction — funding stage/amount if stated, hiring velocity (many open roles), customer/revenue signals, notable investors if named on their own site.
- learningExperience: signals of a strong technical environment — notable founders/team backgrounds if stated on their own site, an engineering blog with real technical depth, hard/interesting problems described, small team (more ownership) vs. large org.
- llmTrainingCloseness: how close the actual work is to LLM training/fine-tuning/RLHF/post-training/pretraining/foundation-model work, based on role descriptions or what they say they build — NOT just "uses AI" or "built on GPT/Claude API" (that scores low; that's a wrapper, not training work).

Return ONLY a JSON object with keys: growthPotential (0-100), growthReason (one sentence), learningExperience (0-100), learningReason (one sentence), llmTrainingCloseness (0-100), llmReason (one sentence), sources (the exact URLs you fetched). If you could not read the site or found no real evidence for a dimension, score it 30 (neutral-low, not 0) and say so in the reason. No commentary, no markdown fences.`;

const clamp = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 30);
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function researchCandidate(input: ResearchInput): ScoreBreakdown {
  const text = cliComplete(PROMPT(input), { tools: 'WebFetch WebSearch', maxTurns: 12, timeoutMs: 300_000 });
  const parsed = extractJson<Record<string, unknown>>(text, 'object');
  if (!parsed) throw new Error('Research reply was not valid JSON');

  const own = (u: string) => {
    const h = hostOf(u);
    return !!h && (h === input.domain || h.endsWith(`.${input.domain}`));
  };
  const sourcesRaw = Array.isArray(parsed.sources) ? (parsed.sources as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const sources = sourcesRaw.filter(own).slice(0, 6);

  const growthPotential = clamp(parsed.growthPotential);
  const learningExperience = clamp(parsed.learningExperience);
  const llmTrainingCloseness = clamp(parsed.llmTrainingCloseness);
  const overall = Math.round((growthPotential + learningExperience + llmTrainingCloseness) / 3);

  const reasons = [
    `Growth (${growthPotential}): ${str(parsed.growthReason, 300) || 'no reason given'}`,
    `Learning (${learningExperience}): ${str(parsed.learningReason, 300) || 'no reason given'}`,
    `LLM training closeness (${llmTrainingCloseness}): ${str(parsed.llmReason, 300) || 'no reason given'}`,
  ];

  return { growthPotential, learningExperience, llmTrainingCloseness, overall, reasons, sources };
}

export type { Candidate };
