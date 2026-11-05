// Parse every general-election matchup poll table in a Wikipedia HTML fragment.
// A matchup table has a "Poll source" header, a Republican column "(R)" and an aligned column:
// "(D)"/"(DFL)" for most races, "(I)" where the Democratic-aligned candidate is independent (Nebraska).
// Primary tables carry no party tags and are skipped. Each row keeps its matchup, so pre-primary
// hypotheticals can be averaged instead of picking the eventual nominee with hindsight.
const decode = (s) => s.replace(/&#160;|&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#91;/g, '[').replace(/&#93;/g, ']').replace(/&ndash;|&#8211;/g, '–').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const clean = (s) => decode(s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<sup[\s\S]*?<\/sup>/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function tableToGrid(t) {
  const rows = t.match(/<tr[\s\S]*?<\/tr>/g) || [];
  const grid = [], pending = [];
  for (const r of rows) {
    const out = []; let col = 0;
    const cells = [...r.matchAll(/<t([hd])([^>]*)>([\s\S]*?)<\/t\1>/g)];
    const take = () => { while (pending[col] && pending[col].left > 0) { out[col] = pending[col].text; pending[col].left--; col++; } };
    for (const c of cells) {
      take();
      const cs = +(c[2].match(/colspan="?(\d+)/)?.[1] || 1), rs = +(c[2].match(/rowspan="?(\d+)/)?.[1] || 1);
      const text = clean(c[3]);
      for (let i = 0; i < cs; i++) { out[col] = text; if (rs > 1) pending[col] = { text, left: rs - 1 }; col++; }
    }
    take();
    grid.push({ cells: out, isHeader: /<th/.test(r) && !/<td/.test(r) });
  }
  return grid;
}
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
export function endDate(s) {
  const y = s.match(/(\d{4})\s*$/) || s.match(/,\s*(\d{4})/);
  if (!y) return null;
  const m = [...s.matchAll(/([A-Z][a-z]{2})[a-z]*\.?\s+(\d{1,2})/g)];
  if (!m.length) return null;
  const last = m[m.length - 1];
  const dash = s.match(/[–-]\s*(?:([A-Z][a-z]{2})[a-z]*\.?\s+)?(\d{1,2})\b/);
  let mon = MONTHS[last[1]], day = +last[2];
  if (dash) { if (dash[1]) mon = MONTHS[dash[1]]; day = +dash[2]; }
  if (mon === undefined) return null;
  return new Date(Date.UTC(+y[1], mon, day)).toISOString().slice(0, 10);
}
const name = (h) => h.replace(/\s*\((D|R|I|DFL|L|G)\)\s*/, '').trim();

export function parseMatchups(html, aligned = 'D') {
  const alignedRe = aligned === 'I' ? /\(I\)/ : /\((D|DFL)\)/;
  const rows = [];
  const tabs = html.match(/<table[\s\S]*?<\/table>/g) || [];
  tabs.forEach((t, ti) => {
    if (!/Poll source/i.test(t)) return;
    const g = tableToGrid(t);
    const hdr = g.find((r) => r.isHeader); if (!hdr) return;
    const h = hdr.cells;
    const aCol = h.findIndex((x) => alignedRe.test(x)), rCol = h.findIndex((x) => /\(R\)/.test(x));
    if (aCol < 0 || rCol < 0) return;
    const matchup = `${name(h[aCol])} v ${name(h[rCol])}`;
    for (const r of g) {
      if (r.isHeader || r.cells.length < 6) continue;
      const c = r.cells;
      const end = endDate(c[1] || '');
      const av = parseFloat((c[aCol] || '').replace('%', '')), rv = parseFloat((c[rCol] || '').replace('%', ''));
      if (!end || isNaN(av) || isNaN(rv)) continue;
      const pollster = c[0];
      const tags = [...pollster.matchAll(/\((R|D)\)/g)].map((m) => m[1]);
      const partisan = tags.length && tags.every((x) => x === tags[0]) ? tags[0] : null; // bipartisan teams count as non-partisan
      rows.push({ s: pollster, pt: partisan, e: end, n: +(String(c[2] || '').replace(/,/g, '').match(/\d+/) || [0])[0], pop: (String(c[2] || '').match(/\((LV|RV|A|V)\)/) || [])[1] || null, mu: matchup, t: ti, D: av, R: rv, m: Math.round((av - rv) * 10) / 10 });
    }
  });
  return rows;
}
export const pollsterKey = (s) => s.replace(/\s*\((R|D)\)/g, '').replace(/\/.*$/, '').trim().toLowerCase();

// Point-in-time average for a day: polls ending on or before that day, latest poll per pollster within 21 days
// (45 if fewer than 3 pollsters), averaged across every matchup that poll tested, then equal-weighted.
export function pollAverage(rows, dayISO, { nonpartisan = false } = {}) {
  const cut = Date.parse(dayISO + 'T00:00:00Z');
  const get = (win) => {
    const by = new Map();
    for (const p of rows) {
      if (nonpartisan && p.pt) continue;
      const t = Date.parse(p.e + 'T00:00:00Z');
      if (t > cut || t < cut - win * 864e5) continue;
      const k = pollsterKey(p.s), prev = by.get(k);
      if (!prev || t > prev.t) by.set(k, { t, ms: [p.m] }); else if (t === prev.t) prev.ms.push(p.m);
    }
    return [...by.values()].map((v) => v.ms.reduce((a, b) => a + b, 0) / v.ms.length);
  };
  let m = get(21); if (m.length < 3) m = get(45);
  return m.length ? { margin: m.reduce((a, b) => a + b, 0) / m.length, n: m.length } : null;
}
