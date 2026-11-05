// Validate raw/poly_all.json: right event (history runs to Election Day 2026), resolution agrees with the
// Wikipedia winner, and prices match the earlier Polymarket pull where both exist.
import fs from 'node:fs';
import { RACES } from './races.mjs';
const PA = JSON.parse(fs.readFileSync('raw/poly_all.json'));
const PD = JSON.parse(fs.readFileSync('raw/poly_daily.json'));
const RES = JSON.parse(fs.readFileSync('raw/results_wiki.json'));
const CUT = Date.parse('2026-11-03T05:00:00Z') / 1000;
const day = (t) => new Date(t * 1000).toISOString().slice(0, 10);
const problems = [];
for (const r of RACES) {
  const p = PA[r.id]; if (!p?.found) { problems.push(`${r.id} not found`); continue; }
  const side = r.aligned === 'I' ? 'I' : 'D';
  const m = p.markets[side];
  if (!m) { problems.push(`${r.id} no ${side} market (${p.basis})`); continue; }
  const h = m.history; const last = h[h.length - 1], first = h[0];
  const preCut = h.filter((x) => x.t <= CUT); const lastPre = preCut[preCut.length - 1];
  const gapDays = lastPre ? (CUT - lastPre.t) / 86400 : null;
  // winner per Wikipedia: aligned candidate won?
  const rr = RES.races[r.id]; const w = rr?.winnerName;
  const al = r.aligned === 'I' ? rr?.candidates.find((c) => c.party !== 'GOP' && c.party !== 'DEM') : rr?.candidates.find((c) => c.party === 'DEM');
  const wikiD = rr?.callStatus === 'called' && w && al ? (w === al.name ? 1 : 0) : null;
  const polyD = m.resolvedYes === null ? null : m.resolvedYes ? 1 : 0;
  const old = PD[r.poly]?.markets?.D?.history;
  let oldDiff = null;
  if (old && side === 'D' && lastPre) { const o = old.filter((x) => x.t <= CUT).slice(-1)[0]; if (o) oldDiff = Math.abs(o.p - lastPre.p); }
  const flag = [];
  if (gapDays === null || gapDays > 3) flag.push('no price near Election Day');
  if (first && day(first.t) > '2026-06-01') flag.push('history starts ' + day(first.t));
  if (wikiD !== null && polyD !== null && wikiD !== polyD) flag.push(`resolution ${polyD} vs Wikipedia ${wikiD}`);
  if (oldDiff !== null && oldDiff > 0.02) flag.push(`differs from earlier pull by ${(100 * oldDiff).toFixed(1)}`);
  console.log(`${r.id.padEnd(9)} ${p.basis.padEnd(9)} ${side} ${String(h.length).padStart(3)} pts ${first ? day(first.t) : '-'}..${last ? day(last.t) : '-'} | T-1 ${lastPre ? (100 * lastPre.p).toFixed(0).padStart(3) + '%' : '  - '} | poly ${polyD ?? '-'} wiki ${wikiD ?? '-'} | vol ${String(m.volume).padStart(9)} ${flag.length ? ' <<< ' + flag.join('; ') : ''}`);
  if (flag.length) problems.push(`${r.id}: ${flag.join('; ')}`);
}
console.log('\nproblems:', problems.length ? '\n' + problems.join('\n') : 'none');
