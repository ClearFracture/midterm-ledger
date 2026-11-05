// Fetch each race page's general-election polling section as it stood at the end of each snapshot day,
// using Wikipedia revision history. Usage: node wiki_snap.mjs [h,h,...] [RACEID,RACEID,...]
// Fast path: pull the revision's raw wikitext, cut out the "Polling" subsection of "General election",
// and render only that fragment (rendering whole old revisions is slow). Falls back to rendering the
// whole revision when no such section is found.
// Saves raw/wiki_snap/<RACEID>/<h>.html and raw/wiki_snap/<RACEID>/meta.json
import fs from 'node:fs';
import { RACES, H_SNAP, cutoffISO, UA } from './races.mjs';
const API = 'https://en.wikipedia.org/w/api.php';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(params, post) {
  const base = { format: 'json', formatversion: '2' };
  for (let i = 0; i < 5; i++) {
    try {
      const r = post
        ? await fetch(API, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...base, ...params }) })
        : await fetch(API + '?' + new URLSearchParams({ ...base, ...params }), { headers: { 'User-Agent': UA } });
      const text = await r.text();
      if (r.status === 429 || r.status >= 500 || /too many requests/i.test(text.slice(0, 200))) { await sleep(10000 * (i + 1)); continue; }
      await sleep(PACE);
      return JSON.parse(text);
    } catch (e) { await sleep(5000 * (i + 1)); }
  }
  return { error: 'fetch failed' };
}
const PACE = +(process.env.PACE || 1000); // ms between calls: Wikipedia rate-limits fast anonymous clients
// Find the general-election polling subsection in raw wikitext.
function pollingSection(wt) {
  const lines = wt.split('\n');
  const heads = [];
  lines.forEach((l, i) => { const m = l.match(/^(={2,6})\s*(.+?)\s*\1\s*$/); if (m) heads.push({ i, level: m[1].length, title: m[2].replace(/<[^>]+>/g, '').trim() }); });
  const ge = heads.findIndex((h) => h.level === 2 && /general election/i.test(h.title));
  if (ge < 0) return null;
  const geEnd = heads.findIndex((h, k) => k > ge && h.level <= 2);
  for (let k = ge + 1; k < (geEnd < 0 ? heads.length : geEnd); k++) {
    if (/^poll(ing|s)?\b/i.test(heads[k].title)) {
      const lvl = heads[k].level;
      const nxt = heads.findIndex((h, j) => j > k && h.level <= lvl);
      const endLine = nxt < 0 ? lines.length : heads[nxt].i;
      return { title: `General election > ${heads[k].title}`, text: lines.slice(heads[k].i, endLine).join('\n') };
    }
  }
  return null;
}
const hs = process.argv[2] ? process.argv[2].split(',').map(Number) : H_SNAP;
const ids = process.argv[3] ? process.argv[3].split(',') : RACES.map((r) => r.id);
let calls = 0;
for (const id of ids) {
  const race = RACES.find((r) => r.id === id);
  const dir = `raw/wiki_snap/${id}`; fs.mkdirSync(dir, { recursive: true });
  const metaPath = `${dir}/meta.json`;
  const meta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath)) : { title: race.wiki, snaps: {} };
  const byRev = {};
  for (const [h, s] of Object.entries(meta.snaps)) if (s.revid && fs.existsSync(`${dir}/${h}.html`)) byRev[s.revid] = h;
  for (const h of hs) {
    if (meta.snaps[h]?.done) continue;
    const q = await api({ action: 'query', prop: 'revisions', titles: race.wiki, redirects: '1', rvlimit: '1', rvdir: 'older', rvstart: cutoffISO(h), rvprop: 'ids|timestamp' }); calls++;
    if (q.error || !q.query) { console.log(id, h, 'query failed, will retry on next run'); continue; } // never record a failed call as "no revision"
    const page = q.query?.pages?.[0], rev = page?.revisions?.[0];
    if (!rev) { meta.snaps[h] = { done: true, revid: null, note: page?.missing ? 'page missing' : 'no revision before cutoff' }; continue; }
    if (byRev[rev.revid]) { fs.copyFileSync(`${dir}/${byRev[rev.revid]}.html`, `${dir}/${h}.html`); meta.snaps[h] = { done: true, revid: rev.revid, ts: rev.timestamp, section: meta.snaps[byRev[rev.revid]].section, copiedFrom: +byRev[rev.revid] }; continue; }
    const c = await api({ action: 'query', prop: 'revisions', revids: String(rev.revid), rvprop: 'content', rvslots: 'main' }); calls++;
    const wt = c.query?.pages?.[0]?.revisions?.[0]?.slots?.main?.content || '';
    const sec = pollingSection(wt);
    let html = '';
    if (sec) {
      const p = await api({ action: 'parse', text: sec.text, title: page.title, contentmodel: 'wikitext', prop: 'text', disablelimitreport: '1' }, true); calls++;
      html = p.parse?.text || '';
    } else {
      const p = await api({ action: 'parse', oldid: String(rev.revid), prop: 'text' }); calls++;
      html = p.parse?.text || '';
    }
    if (!wt || !html) { console.log(id, h, 'content or render failed, will retry on next run'); continue; }
    fs.writeFileSync(`${dir}/${h}.html`, html);
    meta.snaps[h] = { done: true, revid: rev.revid, ts: rev.timestamp, section: sec ? sec.title : 'full page', bytes: html.length };
    byRev[rev.revid] = h;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
    await sleep(100);
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  const s1 = meta.snaps[hs[0]];
  console.log(id.padEnd(9), Object.keys(meta.snaps).length, 'snaps', '| first:', s1?.revid ? `${s1.ts} ${s1.section}` : s1?.note, '| calls', calls);
}
