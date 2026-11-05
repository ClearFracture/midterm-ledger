// Polymarket-only pull for every 2026 Senate and governor race (and chamber control).
// For each race: find the 2026 "winner" event, then pull daily price history for the Democratic, Republican and
// Independent markets, with each market's resolution and volume. Events priced per candidate instead of per party
// (California governor) are matched to the general-election nominees by name from raw/results_wiki.json.
// Output: raw/poly_all.json   Usage: node poly_all.mjs [RACEID,RACEID,...]
import fs from 'node:fs';
import { RACES, byId } from './races.mjs';
const G = 'https://gamma-api.polymarket.com', C = 'https://clob.polymarket.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (u) => { for (let i = 0; i < 6; i++) { const r = await fetch(u); if (r.status === 429) { await sleep(2000 * (i + 1)); continue; } if (!r.ok) return { _err: r.status }; return r.json(); } return { _err: 429 }; };
const RES = JSON.parse(fs.readFileSync('raw/results_wiki.json'));
const OUT = 'raw/poly_all.json';
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};
const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
const slugOf = (s) => s.toLowerCase().replace(/ /g, '-');
const targets = [
  { key: 'CONTROLS-2026', slugs: ['which-party-will-win-the-senate-in-2026'] },
  { key: 'CONTROLH-2026', slugs: ['which-party-will-win-the-house-in-2026'] },
  ...RACES.map((r) => ({
    key: r.id, race: r,
    slugs: r.office === 'Senate'
      ? [`${slugOf(r.stateName)}-senate-election-winner`, `${slugOf(r.stateName)}-special-senate-election-winner`, `${slugOf(r.stateName)}-senate-special-election-winner`]
      : [`${slugOf(r.stateName)}-governor-election-winner`, `${slugOf(r.stateName)}-governor-election-2026`, `${slugOf(r.stateName)}-governor-winner-2026`, `${slugOf(r.stateName)}-gubernatorial-election-winner`],
  })),
];
// A 2026 general-election event: closed, not a primary/combo/margin market, and not a 2024 event
const okEvent = (e, r) => e && !/primary|nominee|combo|margin|closer|worst|flips|lieutenant|baja|state senate/i.test(e.title) &&
  (!r || new RegExp(r.stateName, 'i').test(e.title)) && !/2024|2022/.test(e.title + ' ' + e.slug) &&
  (e.markets || []).some((m) => /2026/.test(m.question) || /2026/.test(e.slug) || /2026/.test(e.title) || (e.endDate || '').startsWith('2026'));
for (const t of targets) {
  if (only && !only.has(t.key)) continue;
  let ev = null;
  for (const s of t.slugs) { const r = await j(`${G}/events?slug=${s}`); if (Array.isArray(r) && okEvent(r[0], t.race)) { ev = r[0]; break; } await sleep(150); }
  if (!ev && t.race) {
    const q = `${t.race.stateName} ${t.race.office === 'Senate' ? 'Senate' : 'Governor'} election winner`;
    const s = await j(`${G}/public-search?q=${encodeURIComponent(q)}&limit_per_type=10&events_status=closed`);
    ev = (s.events || []).find((e) => okEvent(e, t.race) && new RegExp(t.race.office === 'Senate' ? 'senate' : 'governor', 'i').test(e.title) && /winner|election/i.test(e.title));
  }
  if (!ev) { out[t.key] = { found: false }; console.log(t.key.padEnd(14), 'NOT FOUND'); continue; }
  const live = (ev.markets || []).filter((m) => +m.volume > 0 && !/Person [A-Z]\b|Party [A-Z]\b|another party/i.test(m.question));
  const pick = {
    D: live.find((m) => /democrat/i.test(m.question)),
    R: live.find((m) => /republican/i.test(m.question)),
    I: live.find((m) => /independent/i.test(m.question)),
  };
  let basis = 'party';
  if (!pick.D && !pick.R && t.race) { // candidate-level event: match the nominees from the results
    const rr = RES.races[t.race.id]; const dem = rr?.candidates.find((c) => c.party === 'DEM'), rep = rr?.candidates.find((c) => c.party === 'GOP');
    const byName = (n) => n && live.find((m) => m.question.toLowerCase().includes(n.split(' ').slice(-1)[0].toLowerCase()));
    pick.D = byName(dem?.name); pick.R = byName(rep?.name); basis = 'candidate';
  }
  const rec = { found: true, slug: ev.slug, title: ev.title, basis, volume: Math.round(+ev.volume || 0), markets: {} };
  for (const [side, m] of Object.entries(pick)) {
    if (!m) continue;
    const tok = JSON.parse(m.clobTokenIds)[0];
    const h = await j(`${C}/prices-history?market=${tok}&interval=max&fidelity=1440`);
    const prices = JSON.parse(m.outcomePrices || '[]').map(Number);
    rec.markets[side] = { question: m.question, conditionId: m.conditionId, volume: Math.round(+m.volume || 0), resolvedYes: m.closed ? prices[0] === 1 : null, history: h.history || [], err: h._err };
    await sleep(250);
  }
  out[t.key] = rec;
  const dH = rec.markets.D?.history.length ?? '-', iH = rec.markets.I?.history.length ?? '-';
  console.log(t.key.padEnd(14), ev.slug.slice(0, 46).padEnd(46), basis.padEnd(9), 'D', String(dH).padStart(3), 'I', String(iH).padStart(3), 'vol', rec.volume);
  fs.writeFileSync(OUT, JSON.stringify(out));
}
fs.writeFileSync(OUT, JSON.stringify(out));
const found = Object.values(out).filter((x) => x.found).length;
console.log(`found ${found} of ${Object.keys(out).length}`);
