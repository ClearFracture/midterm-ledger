// Parse general-election results from saved Wikipedia wikitext (wiki_results_fetch.mjs).
// Takes the first {{Election box begin}} ... {{Election box end}} block inside the level-2 "General election"
// section and reads each candidate template's party, name, votes, percentage and winner flag.
// Writes raw/results_wiki.json in the same shape analysis_v3.mjs reads from raw/results.json, plus provenance.
// Hand-reviewed overrides (raw/wiki_results_overrides.json) win over the parser, each with a note.
import fs from 'node:fs';
import { RACES } from './races.mjs';
const DIR = 'raw/wiki_results_src';
const META = JSON.parse(fs.readFileSync(`${DIR}/meta.json`));
const OVR = fs.existsSync('raw/wiki_results_overrides.json') ? JSON.parse(fs.readFileSync('raw/wiki_results_overrides.json')) : {};

function generalSection(wt) {
  const m = wt.match(/^==\s*General election\s*==\s*$/im);
  if (!m) return null;
  const rest = wt.slice(m.index + m[0].length);
  const next = rest.search(/^==[^=].*==\s*$/m);
  return next === -1 ? rest : rest.slice(0, next);
}
// split a template body into |key=value params, respecting nested {{ }} and [[ ]]
function params(body) {
  const out = {}; let depth = 0, cur = '', parts = [];
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{' || two === '[[') { depth++; cur += two; i++; continue; }
    if (two === '}}' || two === ']]') { depth--; cur += two; i++; continue; }
    if (body[i] === '|' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += body[i];
  }
  parts.push(cur);
  for (const p of parts.slice(1)) { const k = p.indexOf('='); if (k > 0) out[p.slice(0, k).trim().toLowerCase()] = p.slice(k + 1).trim(); }
  return out;
}
function templates(text) { // top-level {{...}} templates in order
  const out = []; let i = 0;
  while ((i = text.indexOf('{{', i)) !== -1) {
    let depth = 0, j = i;
    for (; j < text.length; j++) {
      if (text.startsWith('{{', j)) { depth++; j++; } else if (text.startsWith('}}', j)) { depth--; j++; if (depth === 0) break; }
    }
    out.push(text.slice(i + 2, j - 1)); i = j + 1;
  }
  return out;
}
const clean = (s) => (s || '').replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/\{\{[^{}]*\}\}/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<[^>]+>/g, '').trim();
const num = (s) => { const v = parseFloat(clean(s).replace(/[,%\s]/g, '')); return Number.isFinite(v) ? v : null; };
function partyCode(p) {
  const s = clean(p).toLowerCase();
  if (/republican/.test(s)) return 'GOP';
  if (/democratic.farmer.labor|^democratic|democratic party/.test(s)) return 'DEM';
  if (/independent|nonpartisan/.test(s)) return 'IND';
  return s ? s.replace(/ party.*$/, '').toUpperCase().slice(0, 12) : 'UNK';
}

const out = { source: 'Wikipedia general-election results tables (CC BY-SA 4.0), current revision of each race page', fetchedAt: META.fetchedAt, races: {}, issues: [] };
for (const race of RACES) {
  const pg = META.pages[race.id];
  const rec = { st: race.st, office: race.office, wiki: pg?.title, revid: pg?.revid || null, revTimestamp: pg?.timestamp || null, candidates: [], callStatus: 'none', eevp: null, notes: [] };
  if (!pg?.revid) { rec.notes.push('page missing'); out.races[race.id] = rec; out.issues.push([race.id, 'page missing']); continue; }
  const wt = fs.readFileSync(`${DIR}/${race.id}.wikitext`, 'utf8');
  const gen = generalSection(wt);
  if (!gen) { rec.notes.push('no "General election" section'); out.issues.push([race.id, 'no General election section']); }
  const b = gen ? gen.search(/\{\{\s*Election box begin/i) : -1;
  if (gen && b === -1) { rec.notes.push('no results box in General election section'); out.issues.push([race.id, 'no results box']); }
  if (b !== -1) {
    const e = gen.indexOf('{{Election box end', b);
    const block = gen.slice(b, e === -1 ? undefined : e);
    for (const t of templates(block)) {
      const name = t.split('|')[0].trim().toLowerCase();
      if (!/^election box (winning )?candidate/.test(name)) continue;
      const p = params(t);
      rec.candidates.push({ name: clean(p.candidate), party: partyCode(p.party), partyRaw: clean(p.party), votes: num(p.votes), share: num(p.percentage), winner: name.startsWith('election box winning') });
    }
    const winners = rec.candidates.filter((c) => c.winner);
    rec.callStatus = winners.length === 1 ? 'called' : 'uncalled';
    if (!rec.candidates.length) out.issues.push([race.id, 'results box has no candidates']);
    // recompute shares from votes when every candidate has votes (Wikipedia percentages are rounded)
    const tot = rec.candidates.reduce((a, c) => a + (c.votes || 0), 0);
    if (rec.candidates.length && rec.candidates.every((c) => c.votes)) for (const c of rec.candidates) c.shareFromVotes = (100 * c.votes) / tot;
    rec.totalVotes = tot || null;
  }
  // Infobox: nomineeN/candidateN, partyN, popular_voteN, percentageN, reporting, after_election.
  // Used when the results box below has no vote counts yet (editors fill the infobox first).
  const ibStart = wt.search(/\{\{\s*Infobox election/i);
  if (ibStart !== -1) {
    const ib = params(templates(wt.slice(ibStart))[0] || '');
    const ibc = [];
    for (let k = 1; k <= 6; k++) {
      const nm = ib['nominee' + k] ?? ib['candidate' + k];
      if (!nm) continue;
      ibc.push({ name: clean(nm), party: partyCode(ib['party' + k]), partyRaw: clean(ib['party' + k]), votes: num(ib['popular_vote' + k] || ''), share: num(ib['percentage' + k] || ''), bold: /'''/.test(nm) });
    }
    rec.reporting = num(ib.reporting || '');
    rec.declaredWinner = clean(ib.after_election || '') || null;
    let boxHasVotes = rec.candidates.length && rec.candidates.every((c) => c.votes);
    // the results box sometimes lags the infobox (Montana): keep whichever has more votes counted
    const sum = (a) => a.reduce((s, c) => s + (c.votes || 0), 0);
    if (boxHasVotes && sum(ibc) > sum(rec.candidates)) { boxHasVotes = false; rec.notes.push(`results box (${sum(rec.candidates)} votes) behind infobox (${sum(ibc)}); used infobox`); }
    if (!boxHasVotes && ibc.some((c) => c.share !== null)) {
      rec.candidates = ibc; rec.basis = 'infobox percentages';
    } else if (boxHasVotes) rec.basis = 'results box votes';
    // a race is called when the infobox names the winner (after_election matches a nominee) or bolds one
    const w = ibc.filter((c) => c.bold || (rec.declaredWinner && c.name && rec.declaredWinner.includes(c.name.split(' ').slice(-1)[0])));
    if (w.length === 1) { rec.callStatus = 'called'; rec.winnerName = w[0].name; }
    else if (rec.candidates.some((c) => c.share !== null)) rec.callStatus = 'uncalled';
  }
  // a "reporting = 0" placeholder next to real vote shares means the editor didn't fill it in
  if (rec.reporting === 0 && rec.candidates.some((c) => c.share)) rec.reporting = null;
  rec.eevp = rec.reporting ?? null;
  const o = OVR[race.id];
  if (o) { Object.assign(rec, o.set || {}); rec.notes.push('override: ' + o.note); }
  if (rec.basis !== 'infobox percentages') for (const c of rec.candidates) c.share = c.shareFromVotes ?? c.share;
  rec.candidates.sort((a, b) => (b.votes || b.share || 0) - (a.votes || a.share || 0));
  out.races[race.id] = rec;
}
fs.writeFileSync('raw/results_wiki.json', JSON.stringify(out, null, 1));
const all = Object.entries(out.races);
console.log('called', all.filter(([, r]) => r.callStatus === 'called').length, '| uncalled', all.filter(([, r]) => r.callStatus === 'uncalled').map(([k]) => k).join(' '), '| no results', all.filter(([, r]) => r.callStatus === 'none').map(([k]) => k).join(' '));
for (const [id, msg] of out.issues) console.log('issue', id, msg);
