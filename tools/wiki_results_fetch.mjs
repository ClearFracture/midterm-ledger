// Fetch the current wikitext of every race's Wikipedia page (results source for the public site).
// Batches up to 50 titles per API call, so all 71 pages take two requests. Saves each page's wikitext
// plus its exact revision id and timestamp, so the data can be tied to a specific snapshot.
// Output: raw/wiki_results_src/<ID>.wikitext and raw/wiki_results_src/meta.json
import fs from 'node:fs';
import { RACES, UA } from './races.mjs';
const DIR = 'raw/wiki_results_src';
fs.mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const meta = { fetchedAt: new Date().toISOString(), pages: {} };
const byTitle = {};
for (const r of RACES) byTitle[r.wiki.replace(/_/g, ' ')] = r;
const titles = Object.keys(byTitle);
for (let i = 0; i < titles.length; i += 50) {
  const batch = titles.slice(i, i + 50);
  const u = 'https://en.wikipedia.org/w/api.php?' + new URLSearchParams({
    action: 'query', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main',
    titles: batch.join('|'), redirects: '1', format: 'json', formatversion: '2', maxlag: '5',
  });
  let j;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(u, { headers: { 'User-Agent': UA } });
    if (res.ok) { j = await res.json(); if (!j.error) break; }
    console.log('retry', attempt + 1, res.status, j?.error?.code || '');
    await sleep(5000 * (attempt + 1));
  }
  if (!j || j.error) throw new Error('fetch failed for batch ' + i);
  const redirect = Object.fromEntries((j.query.redirects || []).map((x) => [x.to, x.from]));
  const norm = Object.fromEntries((j.query.normalized || []).map((x) => [x.to, x.from]));
  for (const p of j.query.pages) {
    const from = redirect[p.title] || norm[p.title] || p.title;
    const race = byTitle[from] || byTitle[p.title];
    if (!race) { console.log('unmatched page', p.title); continue; }
    if (p.missing || !p.revisions) { meta.pages[race.id] = { title: p.title, missing: true }; continue; }
    const rv = p.revisions[0];
    fs.writeFileSync(`${DIR}/${race.id}.wikitext`, rv.slots.main.content);
    meta.pages[race.id] = { title: p.title, revid: rv.revid, timestamp: rv.timestamp };
  }
  await sleep(1500);
}
fs.writeFileSync(`${DIR}/meta.json`, JSON.stringify(meta, null, 1));
const got = Object.values(meta.pages).filter((p) => p.revid).length;
console.log(`saved ${got} of ${RACES.length} pages`, Object.entries(meta.pages).filter(([, p]) => !p.revid).map(([k]) => k).join(' '));
