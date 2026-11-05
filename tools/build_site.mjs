// Build the static page: tools/ledger.src.html + raw/data.json -> midterm-ledger/index.html.
// The data is inlined, so the page works at /midterm-ledger, /midterm-ledger/ or /midterm-ledger/index.html
// with no extra requests. The data bundle stays in raw/ (not committed); only the page is published.
// Run from the repo root: node tools/build_site.mjs
import fs from 'node:fs';
const src = fs.readFileSync('tools/ledger.src.html', 'utf8');
const data = fs.readFileSync('raw/data.json', 'utf8').replace(/</g, '\\u003c');
const cut = src.indexOf('</style>') + '</style>'.length;
const headPart = src.slice(0, cut), bodyPart = src.slice(cut).replace('__DATA__', () => data);
const TITLE = 'Midterm Forecast Ledger | Belvedere Labs';
const DESC = 'How prediction markets and polls stacked up in the 2026 US midterms: daily Polymarket prices and poll averages, checked against the results in Senate and governor races.';
const URL = 'https://www.belvederelabs.ai/midterm-ledger';
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESC}">
<link rel="canonical" href="${URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESC}">
<meta property="og:url" content="${URL}">
<meta name="twitter:card" content="summary">
${headPart}
</head>
<body>
${bodyPart}
</body>
</html>
`;
fs.writeFileSync('midterm-ledger/index.html', html);
console.log('wrote midterm-ledger/index.html', (html.length / 1024).toFixed(0) + 'KB');
