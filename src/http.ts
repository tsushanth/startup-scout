export const SCOUT_UA = 'Mozilla/5.0 (compatible; startup-scout-research/1.0)';

export async function politeFetchText(url: string, timeoutMs = 12000): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': SCOUT_UA, Accept: 'text/html,text/plain' }, signal: controller.signal, redirect: 'follow' });
    const text = res.ok ? await res.text() : '';
    return { ok: res.ok, status: res.status, text: text.slice(0, 1_500_000) };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timer);
  }
}
