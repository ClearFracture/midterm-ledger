// Pull full wallet-level trade history for the Dem and Rep markets of selected Polymarket races (v2 Data API).
import fs from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (u) => { for (let i = 0; i < 6; i++) { const r = await fetch(u); if (r.status === 429) { await sleep(2000 * (i + 1)); continue; } if (!r.ok) return { _err: r.status, _b: (await r.text()).slice(0, 200) }; return r.json(); } return { _err: 429 }; };

const SLUGS = {
  'CONTROLS-2026': 'which-party-will-win-the-senate-in-2026', 'CONTROLH-2026': 'which-party-will-win-the-house-in-2026',
  'SENATETX-26': 'texas-senate-election-winner', 'SENATEMI-26': 'michigan-senate-election-winner', 'SENATEME-26': 'maine-senate-election-winner',
  'SENATEKS-26': 'kansas-senate-election-winner', 'SENATEIA-26': 'iowa-senate-election-winner', 'SENATESC-26': 'south-carolina-senate-election-winner',
  'GOVPARTYTX-26': 'texas-governor-winner-2026', 'GOVPARTYFL-26': 'florida-governor-winner-2026',
};
const only = process.argv[2] ? process.argv[2].split(',') : Object.keys(SLUGS);
const MAXPAGES = +process.env.MAXPAGES || 2000;
// MAKERS=1 includes maker fills (taker_only=false): every row is one wallet's own fill, from its own side.
// Without it the feed returns taker fills only (one row per trade), which misses makers entirely.
const MAKERS = process.env.MAKERS === '1';
const OUTDIR = MAKERS ? 'raw/trades_all' : 'raw/trades';
fs.mkdirSync(OUTDIR, { recursive: true });

for (const key of only) {
  const ev = (await j(`https://gamma-api.polymarket.com/events?slug=${SLUGS[key]}`))[0];
  const mk = ev.markets.filter((m) => (/democrat/i.test(m.question) || /republican/i.test(m.question)) && +m.volume > 0 && !/Party [A-Z]\b/.test(m.question));
  const out = { key, markets: [], rows: [] }; // row: [side, wallet, tradeSide(B/S), outcomeIndex, size, price, ts]
  for (const m of mk) {
    const side = /democrat/i.test(m.question) ? 'D' : 'R';
    const resolved = JSON.parse(m.outcomePrices)[0];
    out.markets.push({ side, conditionId: m.conditionId, volume: +m.volume, yesPayout: +resolved, question: m.question });
    let cursor = null, pages = 0, n = 0, t0 = Date.now();
    do {
      const u = `https://data-api.polymarket.com/v2/trades?condition=${m.conditionId}&limit=500${MAKERS ? '&taker_only=false' : ''}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`;
      const r = await j(u);
      if (r._err) { console.log(key, side, 'ERR', r._err, r._b); break; }
      for (const t of r.data) out.rows.push([side, t.proxy_wallet, t.side === 'BUY' ? 'B' : 'S', t.outcome_index, t.size, t.price, t.timestamp]);
      n += r.data.length; pages++;
      cursor = r.pagination?.next_cursor || null;
      await sleep(120);
    } while (cursor && pages < MAXPAGES);
    const usd = out.rows.filter((x) => x[0] === side).reduce((a, x) => a + x[4] * x[5], 0);
    console.log(key.padEnd(14), side, 'trades', n, 'pages', pages, cursor ? '(TRUNCATED)' : '(complete)', '| sum size*price $' + Math.round(usd).toLocaleString(), '| gamma vol $' + Math.round(+m.volume).toLocaleString(), '|', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  }
  fs.writeFileSync(`${OUTDIR}/${key}.json`, JSON.stringify(out));
}
