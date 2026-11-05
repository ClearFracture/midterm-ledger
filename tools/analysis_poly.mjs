// Analysis, Polymarket-only version (public site): rule-based race universe, point-in-time poll averages from
// Wikipedia revision snapshots, pre-primary averaging across all matchups, results from Wikipedia, and
// market prices from Polymarket only (raw/poly_all.json, from poly_all.mjs).
// Output: raw/analysis_poly.json (page-ready per-race data + summary) and printed tables.
import fs from 'node:fs';
import { RACES, dayOf } from './races.mjs';
import { parseMatchups, pollAverage } from './polls_lib.mjs';
const R = (f) => JSON.parse(fs.readFileSync(f));
const PA = R('raw/poly_all.json');
const RES = R('raw/results_wiki.json');
const W2 = fs.existsSync('raw/wallets_v2.json') ? R('raw/wallets_v2.json') : { markets: {} };
const HMAX = 240, HS = [1, 7, 30, 90];
const CUT = Date.parse('2026-11-03T05:00:00Z') / 1000, DAY = 86400;
const r1 = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);
const SIG = (h) => (h <= 7 ? 6.5 : h <= 30 ? 6.5 + (h - 7) / 23 : h <= 90 ? 7.5 + 1.5 * (h - 30) / 60 : 9);
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)); }

// ---- Polymarket series: price of the Democratic-aligned side at the end of each day (midnight ET), h = 1..HMAX
// Candidate-level events (California governor) only measure the party's chances once the nominee is set, so the
// series starts the day after the June 2 top-two primary.
const CANDIDATE_FROM = { GOVCA: '2026-06-03' };
function pAt(hist, h) { const cut = CUT - (h - 1) * DAY; let best = null; for (const pt of hist) { if (pt.t <= cut) best = pt; else break; } return best && cut - best.t < 3 * DAY ? best.p : null; }
function market(race) {
  const p = PA[race.id]; if (!p?.found) return null;
  const m = p.markets[race.aligned === 'I' ? 'I' : 'D']; if (!m || !m.history.length) return null;
  const from = CANDIDATE_FROM[race.id];
  const s = Array.from({ length: HMAX }, (_, i) => { if (from && dayOf(i + 1) < from) return null; const v = pAt(m.history, i + 1); return v === null ? null : r3(v); });
  return { series: s, outcome: m.resolvedYes === null ? null : m.resolvedYes ? 1 : 0, volume: p.volume, basis: p.basis, slug: p.slug };
}

// ---- results (Wikipedia)
function result(race) {
  const x = RES.races[race.id]; if (!x) return null;
  const rep = x.candidates.find((c) => c.party === 'GOP');
  const al = race.aligned === 'I' ? x.candidates.find((c) => c.party !== 'GOP' && c.party !== 'DEM') : x.candidates.find((c) => c.party === 'DEM');
  if (!rep || !al || al.share === null || rep.share === null) return null;
  return { dName: al.name, rName: rep.name, d: r1(al.share), r: r1(rep.share), margin: r1(al.share - rep.share), eevp: x.eevp, called: x.callStatus === 'called', updatedAt: x.revTimestamp, revid: x.revid || null };
}

// ---- snapshots
function snaps(race) {
  const dir = `raw/wiki_snap/${race.id}`; if (!fs.existsSync(`${dir}/meta.json`)) return null;
  const meta = R(`${dir}/meta.json`); const rows = {};
  for (const [h, s] of Object.entries(meta.snaps)) rows[h] = s.revid && fs.existsSync(`${dir}/${h}.html`) ? parseMatchups(fs.readFileSync(`${dir}/${h}.html`, 'utf8'), race.aligned) : [];
  return { meta, rows };
}
function snapFor(S, h) { const avail = Object.keys(S.rows).map(Number).filter((x) => x >= h).sort((a, b) => a - b); return avail.length ? S.rows[avail[0]] : null; }
const distinctPolls = (rows, from, to) => new Set(rows.filter((p) => p.e >= from && p.e <= to).map((p) => p.s + '|' + p.e)).size;

// ---- build
const races = [], universe = [], pending = [];
for (const race of RACES) {
  const S = snaps(race); const res = result(race); const mk = market(race);
  const t1 = S ? S.rows[1] || [] : [];
  const nPolls30 = distinctPolls(t1, dayOf(30), dayOf(1));
  const called = res?.called;
  const hasMarket = !!(mk && mk.series[0] !== null && mk.outcome !== null);
  const qualifies = nPolls30 >= 5;
  const status = !qualifies ? 'few-polls' : !called || !hasMarket ? 'pending' : 'in';
  // cross-check: market resolution vs result margin
  if (status === 'in' && (res.margin > 0 ? 1 : 0) !== mk.outcome) console.log('!! resolution disagrees with result margin:', race.id, res.margin, mk.outcome);
  const entry = { race, S, res, mk, nPolls30, status };
  if (status === 'in') universe.push(entry); else if (status === 'pending') pending.push(entry);
  races.push(entry);
}
console.log(`Universe: ${universe.length} races (called on Wikipedia, resolved Polymarket market, 5+ polls ending Oct 4-Nov 2 on Wikipedia as of Nov 2).`);
console.log('  in:', universe.map((e) => e.race.id).join(' '));
console.log('  pending:', pending.map((e) => e.race.id).join(' ') || '-');

function horizonRow(e, h) {
  const rows = e.S ? snapFor(e.S, h) : null;
  const a = rows ? pollAverage(rows, dayOf(h)) : null, np = rows ? pollAverage(rows, dayOf(h), { nonpartisan: true }) : null;
  return { avg: a?.margin ?? null, np: np?.margin ?? null, pPoll: a ? Phi(a.margin / SIG(h)) : null, mkt: e.mk ? e.mk.series[h - 1] : null, out: e.mk ? e.mk.outcome : null, res: e.res?.margin ?? null };
}
const stats = (arr) => { const n = arr.length; if (!n) return null; const m = arr.reduce((a, b) => a + b, 0) / n; const sd = n > 1 ? Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : 0; const rmse = Math.sqrt(arr.reduce((a, b) => a + b * b, 0) / n); return { n, mean: m, sd, rmse, beat: arr.filter((x) => x > 0).length }; };
let seed = 11; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const boot = (v) => { const bs = []; for (let b = 0; b < 5000; b++) { let s = 0; for (let i = 0; i < v.length; i++) s += v[Math.floor(rnd() * v.length)]; bs.push(s / v.length); } bs.sort((a, b) => a - b); return [bs[125], bs[4875]]; };

const summary = { marketSource: 'Polymarket', universe: universe.map((e) => e.race.id), pending: pending.map((e) => e.race.id), horizons: {} };
console.log('\nPoll miss (result margin minus point-in-time poll average) and scoring vs Polymarket');
for (const h of HS) {
  const rows = universe.map((e) => ({ e, x: horizonRow(e, h) })).filter((o) => o.x.avg !== null && o.x.res !== null);
  const miss = stats(rows.map((o) => o.x.res - o.x.avg));
  const missNP = stats(rows.filter((o) => o.x.np !== null).map((o) => o.x.res - o.x.np));
  const sc = rows.filter((o) => o.x.mkt !== null && o.x.out !== null);
  const diff = sc.map((o) => (o.x.pPoll - o.x.out) ** 2 - (o.x.mkt - o.x.out) ** 2);
  const bp = sc.reduce((a, o) => a + (o.x.pPoll - o.x.out) ** 2, 0) / sc.length, bm = sc.reduce((a, o) => a + (o.x.mkt - o.x.out) ** 2, 0) / sc.length;
  const share = (miss.mean ** 2) / (miss.rmse ** 2);
  summary.horizons[h] = { n: miss.n, pollMiss: r1(miss.mean), sd: r1(miss.sd), rmse: r1(miss.rmse), beatPolls: miss.beat, npMiss: r1(missNP?.mean), npBeat: missNP?.beat, npN: missNP?.n, nScored: sc.length, brierPoll: r3(bp), brierMarket: r3(bm), diffCI: boot(diff).map(r3), marketExpected: r3(sc.reduce((a, o) => a + o.x.mkt, 0) / sc.length), pollExpected: r3(sc.reduce((a, o) => a + o.x.pPoll, 0) / sc.length), actual: r3(sc.reduce((a, o) => a + o.x.out, 0) / sc.length), commonShare: r3(share), nEff: r1(miss.n / (1 + (miss.n - 1) * share)) };
  const H_ = summary.horizons[h];
  console.log(` T-${String(h).padEnd(3)} n=${H_.n} miss ${H_.pollMiss > 0 ? '+' : ''}${H_.pollMiss} (SD ${H_.sd}) beat ${H_.beatPolls}/${H_.n} | non-partisan ${H_.npMiss} (${H_.npBeat}/${H_.npN}) | scored ${H_.nScored}: Brier poll ${H_.brierPoll} vs Polymarket ${H_.brierMarket}, diff CI [${H_.diffCI}] | mean P(D) poll ${H_.pollExpected} Polymarket ${H_.marketExpected} actual ${H_.actual} | n_eff ${H_.nEff}`);
}
// full set: every resolved Polymarket Senate and governor market
summary.fullSet = Object.fromEntries(HS.map((h) => {
  const v = races.map((e) => e.mk).filter((mk) => mk && mk.outcome !== null && mk.series[h - 1] !== null);
  return [h, { n: v.length, wins: v.reduce((a, x) => a + x.outcome, 0), expected: r1(v.reduce((a, x) => a + x.series[h - 1], 0)), brier: r3(v.reduce((a, x) => a + (x.series[h - 1] - x.outcome) ** 2, 0) / v.length) }];
}));
console.log('\nFull set (all resolved Polymarket Senate+governor markets):', HS.map((h) => `T-${h} ${summary.fullSet[h].wins}/${summary.fullSet[h].n} vs ${summary.fullSet[h].expected}`).join(' | '));
// big disagreements: |poll-implied - market| >= 15 points at a scored horizon; which ended closer to the outcome?
const gaps = [];
for (const e of universe) for (const h of HS) { const x = horizonRow(e, h); if (x.pPoll === null || x.mkt === null) continue; if (Math.abs(x.pPoll - x.mkt) >= 0.15) gaps.push({ id: e.race.id, h, poll: r3(x.pPoll), market: x.mkt, out: x.out, closer: Math.abs(x.mkt - x.out) < Math.abs(x.pPoll - x.out) ? 'market' : 'polls' }); }
summary.bigGaps = { n: gaps.length, market: gaps.filter((g) => g.closer === 'market').length, polls: gaps.filter((g) => g.closer === 'polls').length, list: gaps };
console.log(`Gaps of 15+ points: ${gaps.length} (market closer ${summary.bigGaps.market}, polls ${summary.bigGaps.polls})`);
console.log('  ', gaps.map((g) => `${g.id} T-${g.h} poll ${Math.round(100 * g.poll)} mkt ${Math.round(100 * g.market)} -> ${g.closer}`).join(' | '));

// per-race page data
const pageRaces = [];
for (const e of races.filter((x) => x.status !== 'few-polls')) {
  const { race, S, res, mk } = e;
  const avg = [], implied = [];
  for (let h = 1; h <= HMAX; h++) { const rows = S ? snapFor(S, h) : null; const a = rows ? pollAverage(rows, dayOf(h)) : null; avg.push(a ? r1(a.margin) : null); implied.push(a ? r3(Phi(a.margin / SIG(h))) : null); }
  const t1 = (S?.rows[1] || []).filter((p) => p.e >= '2025-11-03');
  const w = W2.markets[race.poly];
  pageRaces.push({
    id: race.id, st: race.st, stateName: race.stateName, office: race.office,
    d: res?.dName || null, dParty: race.aligned === 'I' ? 'I' : 'D', r: res?.rName || null,
    outcome: e.status === 'in' ? mk.outcome : null, pending: e.status !== 'in',
    result: res ? { d: res.d, r: res.r, margin: res.margin, eevp: res.eevp, updatedAt: res.updatedAt, revid: res.revid } : null,
    market: mk ? mk.series : null, marketBasis: mk?.basis || null, marketFrom: CANDIDATE_FROM[race.id] || null,
    avg, implied, polls: t1.map((p) => ({ e: p.e, s: p.s, m: p.m, pt: p.pt, n: p.n, pop: p.pop, mu: p.mu })),
    nPolls30: e.nPolls30, vol: mk ? mk.volume : null,
    wallets: w ? w.cohorts.map((c) => ({ label: c.label, wallets: c.wallets, walletShare: r3(c.walletShare), dollarShare: r3(c.dollarShare), buyUSD: c.buyUSD, ret: r3(c.ret), sided: c.sided, leanWinner: r3(c.leanWinner) })) : null,
    snapshots: S ? Object.fromEntries(Object.entries(S.meta.snaps).map(([h, s]) => [h, { revid: s.revid, ts: s.ts }])) : null,
  });
}
// final week: market-implied margin error vs poll error, across assumed SDs
const inv = (p) => { p = Math.min(0.995, Math.max(0.005, p)); let lo = -4, hi = 4; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; };
summary.finalWeek = [4, 5, 6.5, 8].map((sd) => {
  const errs = (h) => universe.map((e) => { const x = horizonRow(e, h); return x.mkt === null || x.res === null || x.avg === null ? null : { mk: x.res - sd * inv(x.mkt), pl: x.res - x.avg }; }).filter(Boolean);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const e7 = errs(7), e1 = errs(1);
  return { sd, market7: r1(mean(e7.map((x) => x.mk))), market1: r1(mean(e1.map((x) => x.mk))), poll7: r1(mean(e7.map((x) => x.pl))), poll1: r1(mean(e1.map((x) => x.pl))) };
});
summary.excluded = races.filter((x) => x.status === 'few-polls').map((x) => `${x.race.id}(${x.nPolls30})`);
summary.resultsSource = { source: RES.source, fetchedAt: RES.fetchedAt };
fs.writeFileSync('raw/analysis_poly.json', JSON.stringify({ summary, races: pageRaces }));
console.log('\nwrote raw/analysis_poly.json', pageRaces.length, 'races');
