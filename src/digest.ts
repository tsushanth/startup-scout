// Sends the daily digest email — to the user themselves, never a third
// party, so none of the outreach guardrails (suppression lists, daily send
// caps, unsubscribe links) apply. Still identifies itself and stays polite.

export interface DigestItem {
  name: string;
  domain: string;
  careersUrl: string | null;
  overall: number;
  growthPotential: number;
  learningExperience: number;
  llmTrainingCloseness: number;
  reasons: string[];
  sources: string[];
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildDigest(items: DigestItem[]): { subject: string; html: string; text: string } {
  const sorted = [...items].sort((a, b) => b.overall - a.overall);
  const subject = `Startup Scout: ${sorted.length} new compan${sorted.length === 1 ? 'y' : 'ies'} worth a look`;

  const text = sorted
    .map((it, i) => {
      const link = it.careersUrl || `https://${it.domain}`;
      return `${i + 1}. ${it.name} (${it.domain}) — overall ${it.overall}/100 (growth ${it.growthPotential}, learning ${it.learningExperience}, LLM training ${it.llmTrainingCloseness})\n   ${link}\n   ${it.reasons.join(' | ')}\n   sources: ${it.sources.join(', ')}`;
    })
    .join('\n\n');

  const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;font-size:14px;line-height:1.6;color:#1a1d29;max-width:640px">
    ${sorted
      .map((it) => {
        const link = it.careersUrl || `https://${it.domain}`;
        return `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e5e7eb">
          <p style="margin:0 0 4px"><a href="${escapeHtml(link)}" style="font-weight:600;font-size:15px">${escapeHtml(it.name)}</a>
          <span style="color:#6b7280"> — ${it.domain} — overall ${it.overall}/100</span></p>
          <p style="margin:0 0 6px;color:#6b7280;font-size:12.5px">growth ${it.growthPotential} · learning ${it.learningExperience} · LLM training ${it.llmTrainingCloseness}</p>
          <ul style="margin:0;padding-left:18px;font-size:13px">${it.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
        </div>`;
      })
      .join('')}
    <p style="color:#9ca3af;font-size:11px">Startup Scout — a personal research harness. Nothing here was contacted or applied to on your behalf.</p>
  </div>`;

  return { subject, html, text };
}

export async function sendDigest(to: string, from: string, apiKey: string, items: DigestItem[]): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { subject, html, text } = buildDigest(items);
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html, text }),
    });
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const data = await res.json();
    return { ok: true, id: data.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
