// Build the page's data bundle from analysis_poly (Polymarket-only market prices, point-in-time polls,
// Wikipedia results) plus Polymarket chamber-control markets and Polymarket wallet data.
// Run from the repo root: node tools/analysis_poly.mjs && node tools/build_data.mjs
import fs from 'node:fs';
const R = (f) => JSON.parse(fs.readFileSync(f));
const A = R('raw/analysis_poly.json');
const PA = R('raw/poly_all.json');
const W2 = R('raw/wallets_v2.json');
const HMAX = 240, CUT = Date.parse('2026-11-03T05:00:00Z') / 1000, DAY = 86400;
const r3 = (x) => (x === null || x === undefined ? null : Math.round(x * 1000) / 1000);
function pAt(hist, h) { const cut = CUT - (h - 1) * DAY; let best = null; for (const pt of hist) { if (pt.t <= cut) best = pt; else break; } return best && cut - best.t < 3 * DAY ? best.p : null; }
const pSeries = (key) => { const d = PA[key]?.markets?.D?.history || []; return d.length ? Array.from({ length: HMAX }, (_, i) => r3(pAt(d, i + 1))) : null; };

const races = A.races;
const summary = { ...A.summary };
const chambers = { senate: { market: pSeries('CONTROLS-2026') }, house: { market: pSeries('CONTROLH-2026') } };

summary.pooledWallets = {
  bins: W2.pooled.map((p) => ({ label: p.label, wallets: p.wallets, usd: p.usd, walletShare: r3(p.walletShare), dollarShare: r3(p.dollarShare), ret: r3(p.ret) })),
  totalWallets: W2.totalWallets, totalUSD: W2.totalUSD, markets: Object.keys(W2.markets).length,
};
const WLABEL = { 'CONTROLS-2026': 'Senate control', 'CONTROLH-2026': 'House control' };
summary.walletMarkets = Object.entries(W2.markets).map(([key, m]) => {
  const race = races.find((r) => (r.office === 'Senate' ? `SENATE${r.st}-26` : `GOVPARTY${r.st}-26`) === key);
  return {
    key, id: race?.id || null,
    label: race ? `${race.st} ${race.office === 'Senate' ? 'Sen.' : 'Gov.'}` : WLABEL[key], name: race ? `${race.stateName} ${race.office}` : WLABEL[key],
    winner: race ? (m.dWon ? race.d : race.r) : m.dWon ? 'Democrats' : 'Republicans',
    cohorts: m.cohorts.map((c) => ({ label: c.label, wallets: c.wallets, dollarShare: r3(c.dollarShare), ret: r3(c.ret), sided: c.sided, leanWinner: r3(c.leanWinner) })),
  };
});

const out = { asOf: '2026-11-05', H: HMAX, races, chambers, summary };
fs.writeFileSync('raw/data.json', JSON.stringify(out));
console.log('races', races.length, '(universe', summary.universe.length, '+ pending', summary.pending.length + ')', 'size', (fs.statSync('raw/data.json').size / 1024).toFixed(0) + 'KB');
