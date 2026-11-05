// Every 2026 Senate and governor race, with its Polymarket key and Wikipedia page.
export const UA = 'belvedere-labs-election-research/0.2 (data analysis script)';
const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const SENATE = 'AL AK AR CO DE FL GA ID IL IA KS KY LA ME MA MI MN MS MT NE NH NJ NM NC OH OK OR RI SC SD TN TX VA WV WY'.split(' ');
const GOV = 'AL AK AZ AR CA CO CT FL GA HI ID IL IA KS ME MD MA MI MN NE NV NH NM NY OH OK OR PA RI SC SD TN TX VT WI WY'.split(' ');
const SPECIAL = new Set(['FL', 'OH']); // 2026 Senate specials
export const RACES = [
  ...SENATE.map((st) => ({
    id: 'SENATE' + st, st, stateName: STATES[st], office: 'Senate',
    // Nebraska and Montana: the main non-Republican challenger was an independent (Osborn, Bodnar), so the
    // independent is the "Democratic-aligned" side (Polymarket's "Will an independent win?" market).
    aligned: st === 'NE' || st === 'MT' ? 'I' : 'D',
    poly: `SENATE${st}-26`,
    wiki: SPECIAL.has(st) ? `2026_United_States_Senate_special_election_in_${STATES[st].replace(/ /g, '_')}` : `2026_United_States_Senate_election_in_${STATES[st].replace(/ /g, '_')}`,
  })),
  ...GOV.map((st) => ({
    id: 'GOV' + st, st, stateName: STATES[st], office: 'Governor',
    aligned: 'D', poly: `GOVPARTY${st}-26`,
    wiki: `2026_${STATES[st].replace(/ /g, '_')}_gubernatorial_election`,
  })),
];
export const byId = Object.fromEntries(RACES.map((r) => [r.id, r]));

// Snapshot dates: days before Election Day (h=1 is Nov 2). Cutoff = 23:59:59 ET that day.
export const H_SNAP = [1, 7, 14, 21, 30, 45, 60, 90, 120, 150, 180, 240];
export function cutoffISO(h) {
  const d = new Date(Date.UTC(2026, 10, 3) - h * 864e5); // that calendar day
  const est = d >= new Date(Date.UTC(2026, 10, 1)) || d < new Date(Date.UTC(2026, 2, 8)); // EST outside DST
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59) + (est ? 5 : 4) * 3600e3).toISOString();
}
export const dayOf = (h) => new Date(Date.UTC(2026, 10, 3) - h * 864e5).toISOString().slice(0, 10);
