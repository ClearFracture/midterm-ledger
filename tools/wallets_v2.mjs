// Wallet analysis v2: maker AND taker fills (raw/trades_all, taker_only=false), buys through Nov 2 ET.
// Accuracy is price-adjusted: return on every purchase held to resolution, sum(payout - cost) / sum(cost).
// "Lean toward winner" is kept only as a secondary, unpriced description.
import fs from 'node:fs';
const DIR = 'raw/trades_all';
const CUT = Date.parse('2026-11-03T05:00:00Z') / 1000; // midnight ET starting Election Day
const BINS = [[0, 100, '<$100'], [100, 1000, '$100–1k'], [1000, 10000, '$1k–10k'], [10000, 1e12, '$10k+']];
const keys = process.argv[2] ? process.argv[2].split(',') : fs.readdirSync(DIR).map((f) => f.replace('.json', ''));
const pc = (x) => (x === null || !isFinite(x) ? '  - ' : (100 * x).toFixed(0).padStart(3) + '%');
const out = {};
const pool = BINS.map(() => ({ wallets: 0, buy: 0, payout: 0 }));
for (const key of keys) {
  const f = `${DIR}/${key}.json`; if (!fs.existsSync(f)) continue;
  const o = JSON.parse(fs.readFileSync(f));
  const pay = {}; for (const m of o.markets) { pay[m.side + 0] = m.yesPayout; pay[m.side + 1] = 1 - m.yesPayout; }
  if (Object.values(pay).some((v) => v !== 0 && v !== 1)) { console.log(key, 'unresolved, skipped'); continue; }
  const dWon = pay.D0 !== undefined ? pay.D0 === 1 : pay.R0 === 0;
  // diagnostic: do net shares now balance? (sum over wallets of net shares per token)
  const net = {};
  const W = new Map();
  for (const [side, w, ts, oi, size, price, time] of o.rows) {
    if (time > CUT) continue;
    net[side + oi] = (net[side + oi] || 0) + (ts === 'B' ? size : -size);
    if (ts !== 'B') continue;
    const dem = (side === 'D' && oi === 0) || (side === 'R' && oi === 1);
    let x = W.get(w); if (!x) W.set(w, (x = { d: 0, r: 0, payout: 0 }));
    x[dem ? 'd' : 'r'] += size * price;
    x.payout += size * pay[side + oi];
  }
  const ws = [...W.values()].map((x) => ({ ...x, buy: x.d + x.r, flat: Math.abs(x.d - x.r) < 0.2 * (x.d + x.r) }));
  const tot$ = ws.reduce((a, w) => a + w.buy, 0);
  const sorted = [...ws].sort((a, b) => b.buy - a.buy);
  const top1 = sorted.slice(0, Math.ceil(ws.length * 0.01)).reduce((a, w) => a + w.buy, 0) / tot$;
  const cohorts = BINS.map(([lo, hi, label], i) => {
    const c = ws.filter((w) => w.buy >= lo && w.buy < hi);
    const buy = c.reduce((a, w) => a + w.buy, 0), payout = c.reduce((a, w) => a + w.payout, 0);
    const sided = c.filter((w) => !w.flat), right = sided.filter((w) => (dWon ? w.d > w.r : w.r > w.d)).length;
    pool[i].wallets += c.length; pool[i].buy += buy; pool[i].payout += payout;
    return { label, wallets: c.length, walletShare: c.length / ws.length, dollarShare: buy / tot$, buyUSD: Math.round(buy), ret: buy ? (payout - buy) / buy : null, sided: sided.length, leanWinner: sided.length ? right / sided.length : null };
  });
  out[key] = { dWon, wallets: ws.length, buyUSD: Math.round(tot$), top1, median: sorted[Math.floor(sorted.length / 2)].buy, cohorts, netShares: Object.fromEntries(Object.entries(net).map(([k, v]) => [k, Math.round(v)])) };
  console.log(`\n=== ${key} | winner ${dWon ? 'Dem' : 'Rep'} | wallets ${ws.length.toLocaleString()} | buys $${(tot$ / 1e6).toFixed(2)}M | top 1% = ${pc(top1)} | median $${Math.round(out[key].median)}`);
  console.log(' cohort      wallets  %wallets  %dollars | return on buys | lean→winner (n sided)');
  for (const c of cohorts) console.log(` ${c.label.padEnd(10)} ${String(c.wallets).padStart(7)}   ${pc(c.walletShare)}     ${pc(c.dollarShare)}   | ${c.ret === null ? '   -' : ((c.ret >= 0 ? '+' : '') + (100 * c.ret).toFixed(1) + '%').padStart(8)}      | ${pc(c.leanWinner)} (${c.sided})`);
  console.log(' net shares per token (0 = balanced):', JSON.stringify(out[key].netShares));
}
const tw = pool.reduce((a, p) => a + p.wallets, 0), tb = pool.reduce((a, p) => a + p.buy, 0);
const pooled = pool.map((p, i) => ({ label: BINS[i][2], wallets: p.wallets, walletShare: p.wallets / tw, dollarShare: p.buy / tb, usd: Math.round(p.buy), ret: (p.payout - p.buy) / p.buy }));
console.log('\nPOOLED (' + Object.keys(out).length + ' markets):');
for (const p of pooled) console.log(` ${p.label.padEnd(10)} ${pc(p.walletShare)} of wallets, ${pc(p.dollarShare)} of dollars, return ${(100 * p.ret).toFixed(1)}%`);
fs.writeFileSync('raw/wallets_v2.json', JSON.stringify({ markets: out, pooled, totalWallets: tw, totalUSD: Math.round(tb) }, null, 1));
