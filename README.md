# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)

Every protocol DefiLlama tracks that still records no token, ranked by what its launch would be
worth: TVL times the market multiple its category already pays, adjusted for momentum, maturity and
chain breadth, with a value band taken from the comparables' own spread. Each row carries a farm plan
derived from its own record.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

`main.ts` reads the sealed snapshot, scores the board with `lib/model.ts`, writes `out/board.json`,
`out/data.js` and `out/dossier.json`, and copies `dashboard/` and `screenshots/` beside them. Open
`out/dashboard/index.html` in a browser: the board, a detail view for every protocol, the comps and
the model, all offline.

## The model

```
implied  = TVL × comps × growth × maturity × breadth
comps    = median(mcap / TVL) of the category's live tokens (p25..p75 gives the band)
growth   = 1 + clamp(Δ7d, -60, 120)/100 × 0.35
maturity = 0.65 + min(age, 1095)/1095 × 0.35
breadth  = 1 + (min(chains, 6) − 1) × 0.005
```

No protocol is special-cased. MIT licensed.
