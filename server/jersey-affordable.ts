/** Official application notices, never market-rate unit listings. */
export const JERSEY_AFFORDABLE = { id: 'jersey-affordable', name: 'Jersey City affordable housing' };
export const JERSEY_PAGE = 'https://www.jerseycitynj.gov/CityHall/HousingAndDevelopment/affordable_housing/recent_affordable_housing_postings';
export const JERSEY_APPLICATION = 'https://affordablehousingjc.com/';
export type JerseyNotice = { id: string; name: string; address: string; sizes: number[]; total: number };
export type JerseySnapshot = { revision: string; checkedAt: string; notices: JerseyNotice[]; total: number; sourceUrl: string; applicationUrl: string };
const LIMIT = 512_000;
const plain = (s: string) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&quot;|&#34;/gi, '"').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
export function parseJerseyAffordable(html: string, now = new Date()): JerseySnapshot {
  if (html.length > LIMIT || !Number.isFinite(now.getTime())) throw new Error('Invalid Jersey City response.');
  const section = html.match(/<h4\b[^>]*>(?:\s|<span\b[^>]*>)*Current Affordable Housing Postings(?:\s|<\/span>|<span\b[^>]*>)*<\/h4>([\s\S]*?)<\/div>/i)?.[1];
  if (!section || !section.includes('https://affordablehousingjc.com/')) throw new Error('Jersey City postings structure is unavailable.');
  const date = plain(section).match(/Updated (\d{2})-(\d{2})-(\d{4});/);
  if (!date) throw new Error('Jersey City revision is unavailable.');
  const revision = `${date[3]}-${date[1]}-${date[2]}`;
  const parsed = new Date(revision + 'T00:00:00Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== revision || parsed.getTime() > now.getTime()) throw new Error('Invalid Jersey City revision.');
  const paragraphs = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map(m => plain(m[1]));
  const candidates = paragraphs.filter(p => /is located at|This building has/i.test(p));
  if (!candidates.length) throw new Error('No recognized Jersey City notices; empty coverage is unconfirmed.');
  const notices: JerseyNotice[] = candidates.map(p => {
    const m = p.match(/"([^"<>]{1,160})" is located at (.{1,200}?, Jersey City, NJ \d{5})\. This building has (.+?) available\./i);
    if (!m) throw new Error('Unrecognized Jersey City notice.');
    const sizes = [0,0,0,0,0];
    const counts = [...m[3].matchAll(/(\d+|a) (studio|one-bedroom|two-bedroom|three-bedroom|four-bedroom) apartments?/gi)];
    const remainder = m[3].replace(/(\d+|a) (studio|one-bedroom|two-bedroom|three-bedroom|four-bedroom) apartments?/gi,'').replace(/\band\b|[,\s]/gi,'');
    if (!counts.length || remainder) throw new Error('Unrecognized Jersey City bedroom counts.');
    const seen = new Set<number>();
    for (const c of counts) {
      const index = ['studio','one-bedroom','two-bedroom','three-bedroom','four-bedroom'].indexOf(c[2].toLowerCase());
      const count = c[1].toLowerCase() === 'a' ? 1 : Number(c[1]);
      if (seen.has(index) || !Number.isSafeInteger(count) || count < 1 || count > 10000) throw new Error('Invalid Jersey City bedroom count.');
      seen.add(index); sizes[index] = count;
    }
    return { id: m[2].toLowerCase(), name: m[1], address: m[2], sizes, total: sizes.reduce((a,b)=>a+b,0) };
  });
  if (new Set(notices.map(n=>n.id)).size !== notices.length) throw new Error('Duplicate Jersey City notice.');
  return { revision, checkedAt: now.toISOString(), notices, total: notices.reduce((sum,n)=>sum+n.total,0), sourceUrl: JERSEY_PAGE, applicationUrl: JERSEY_APPLICATION };
}
export async function loadJerseyAffordable(fetcher: (url: string, init?: RequestInit) => Response | Promise<Response>, now = new Date()) {
  const response = await fetcher(JERSEY_PAGE, { headers: { Accept: 'text/html' }, redirect: 'error', signal: AbortSignal.timeout(12000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html') || !response.body) throw new Error('Jersey City postings could not be retrieved.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = ''; let bytes = 0;
  try { while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > LIMIT) throw new Error('Jersey City response is too large.'); text += decoder.decode(part.value, {stream:true}); } text += decoder.decode(); }
  finally { await reader.cancel(); }
  return parseJerseyAffordable(text, now);
}
