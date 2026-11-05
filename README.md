# Midterm Forecast Ledger

An interactive look at how prediction markets and polls compared in the 2026 US midterms. It covers daily Polymarket prices and point-in-time poll averages, checked against the results in 30 Senate and governor races.

Target URL: **https://www.belvederelabs.ai/midterm-ledger**

It is a plain static page. There is no framework, no build step to deploy and no server code.

```
midterm-ledger/
  index.html     the page, with its data inlined (about 400 KB, no external scripts; fonts from Google Fonts)
tools/           scripts that pulled the data and rebuilt the page (not needed to deploy)
vercel.json      only used for option B below
```

Because the data is inlined, the page works at `/midterm-ledger`, `/midterm-ledger/` and `/midterm-ledger/index.html` with no relative-path issues. It loads nothing but Google Fonts. If belvederelabs.ai adds a Content-Security-Policy, allow `fonts.googleapis.com` and `fonts.gstatic.com`, and allow inline styles and scripts for this page.

## Option A (chosen): add it to the belvederelabs.ai repo

This is the same pattern as `forecast-explorer`.

1. Copy `midterm-ledger/index.html` into the site's `public/` folder at `public/midterm-ledger/index.html`.
2. Next.js serves files in `public/` as they are, but it won't serve `index.html` for a bare folder path. Wire up `/midterm-ledger` in one of two ways:

   **A1. Rewrite (smallest change).** In `next.config.js` (or `.ts`), add the following. If `rewrites()` already exists, for example with the forecast-explorer entry, add this entry to it.

   ```js
   async rewrites() {
     return [
       { source: "/midterm-ledger", destination: "/midterm-ledger/index.html" },
     ];
   },
   ```

   **A2. Wrap it in the site's layout.** Use this if you want the Belvedere Labs header and footer around the page. Create `app/midterm-ledger/page.tsx`, or the equivalent in `pages/`:

   ```tsx
   export const metadata = {
     title: "Midterm Forecast Ledger | Belvedere Labs",
     description: "How prediction markets and polls stacked up in the 2026 US midterms.",
   };

   export default function MidtermLedger() {
     return (
       <iframe
         src="/midterm-ledger/index.html"
         title="Midterm Forecast Ledger"
         style={{ width: "100%", height: "calc(100vh - 64px)", border: 0 }}
       />
     );
   }
   ```

3. Check that `/midterm-ledger` loads, then click a state, drag the date slider and switch between Senate and Governor.

## Option B: standalone Vercel project

Import this repo into Vercel with no framework preset and no build command. The output directory is the repo root. `vercel.json` redirects `/` to `/midterm-ledger/`. This is useful for previews before the page goes on belvederelabs.ai.

## Data and licensing

| What | Source | Terms |
|---|---|---|
| Daily market prices | Polymarket public APIs (Gamma events, CLOB price history) | Shown on the page for reference only and credited there. The repo doesn't ship a price dataset. |
| Wallet-size statistics | Polymarket public trade feed (makers and takers), purchases through Nov 2, 2026 | Only totals by wallet size are published. No wallet addresses are in this repo or on the page. |
| Poll averages | Wikipedia poll tables, rebuilt as they stood on each date from revision history | CC BY-SA 4.0 |
| Results | Each race's Wikipedia article, read on Nov 5, 2026, with the revision of each page recorded | CC BY-SA 4.0 |

The page credits its sources and says Belvedere Labs is not affiliated with or endorsed by Polymarket. It also notes that the page is informational only and not investment advice.

The results are unofficial counts as of Nov 5, 2026, and will change as states finish counting and certify.

## Updating after states certify

The markets have all resolved, so their prices won't change. Only the results need refreshing. Run these from the repo root with Node 18 or later, which needs no dependencies:

```bash
node tools/wiki_results_fetch.mjs    # current revision of every race page (2 API calls)
node tools/wiki_results_parse.mjs    # -> raw/results_wiki.json; prints anything it couldn't parse
node tools/analysis_poly.mjs         # -> raw/analysis_poly.json; prints the summary tables
node tools/build_data.mjs            # -> raw/data.json
node tools/build_site.mjs            # -> midterm-ledger/index.html
```

`raw/` is never committed. A rebuild also needs the market and poll inputs in `raw/` from the original pull (below). After refreshing, update the "Results as of" date in `tools/ledger.src.html` and the Results note in its Method section.

## Full pipeline (reference)

These scripts were run once to pull the market and poll history. They write to `raw/`.

- **Polymarket prices.**
  - Run `poly_all.mjs`. It finds each race's 2026 "winner" event and pulls daily prices for the Democratic, Republican and Independent markets, with how each resolved.
  - Nebraska and Montana use the Independent market.
  - California was priced per candidate, so its series follows Becerra's market from June 3, after the top-two primary.
  - Then run `poly_all_check.mjs`. It checks that each event is the 2026 one, that prices run to Election Day, and that resolutions agree with the results.
- **Polymarket wallets.** Run `MAKERS=1 node tools/poly_trades.mjs` (makers and takers), then `wallets_v2.mjs`.
- **Wikipedia polls.** Run `PACE=1000 node tools/wiki_snap.mjs`. It fetches each race's polling section as it stood at 1, 7, 14, 21, 30, 45, 60, 90, 120, 150, 180 and 240 days before the election. Wikipedia rate-limits heavy use, so keep the pace at about one request per second and run at most about three copies at once.

All scripts send a generic User-Agent (`tools/races.mjs`).
