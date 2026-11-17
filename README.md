# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/merkas7757/bounty/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/merkas7757/bounty/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Every protocol DefiLlama tracks that still records no token, ranked by what its launch would be
worth. Implied value is TVL times the market multiple the protocol's own category already pays,
adjusted for momentum, maturity and chain breadth, with a value band taken from the spread of the
comparables themselves. Each of the 200 rows carries a farm plan derived from its own record: the
category picks the position, the size picks the capital, and the age picks the holding window.

## What is in the box

```
main.ts              reads the snapshot, scores the board, refuses a board the gate would reject,
                     lays out board.json, data.js, dashboard/, screenshots/ and dossier.json
lib/model.ts         the model: comps, growth, maturity, breadth, bands, farm plans (radar-2)
vendor/makefun-board.ts   the kit's dossier builder
dashboard/           the offline page: board, a detail view per protocol, comps, model, live tokens
screenshots/         the board, a detail view, a filtered view
```

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input input/snapshot.json
```

The grader mounts the snapshot at `/input` and collects `/output`; `MAKEFUN_OUTPUT_DIR` stands in
for `/output` outside the container. Open `out/dashboard/index.html` in a browser: no network, no
build step, no framework — every figure on the page is in `out/data.js`.

## The model

```
implied  = TVL × comps × growth × maturity × breadth
comps    = median(mcap / TVL) of the category's live tokens (p25..p75 gives the band)
growth   = 1 + clamp(Δ7d, -60, 120)/100 × 0.35
maturity = 0.65 + min(age, 1095)/1095 × 0.35
breadth  = 1 + (min(chains, 6) − 1) × 0.005
```

A category needs at least three live comparables to set its own multiple; below that the row is
priced on the snapshot-wide median, and the dashboard says so on the row's detail view. No protocol
is special-cased: one function scores all 200 rows, and the board refuses to publish a ranking whose
rows are out of order or whose farm plans are too thin.

## Licence

MIT. The snapshot is DefiLlama's data, fetched once by the bounty's house and sealed for every run.

## Rebuilding the screenshots

The three images in `screenshots/` are the page rendered at 1600 px wide, with no scrollbars:

```sh
chrome --headless=new --window-size=1600,1150 --screenshot=screenshots/1-board.png \
  "file://$PWD/out/dashboard/index.html#/board"
```

The detail view is `#/p/<slug>` and a filtered view is `#/board?cat=Lending&sort=change&dir=desc`, so
every screenshot is a URL the page itself supports, not a special build.

