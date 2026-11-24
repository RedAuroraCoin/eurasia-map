# Terrain preparation

Turns open GIS data into the grid the game actually ships. Build-time only: nothing here
runs in the browser or in the Worker.

## Run

```bash
python3 -m venv tools/terrain/.venv
tools/terrain/.venv/bin/pip install -r tools/terrain/requirements.txt
tools/terrain/.venv/bin/python tools/terrain/prepare.py                # every region
tools/terrain/.venv/bin/python tools/terrain/prepare.py --region europe # one region
tools/terrain/.venv/bin/python tools/terrain/prepare.py --only 800      # one size
```

`--only` regenerates the mask and the preview only: `data.ts` must always hold every region
at every size, so a partial run never writes it.

The first run downloads 466 MB (ETOPO 2022) and 450 KB (Natural Earth) into `~/.cache/eurasia`.
Override the cache with `EURASIA_CACHE=/path`.

## Pipeline

1. **Read `data/maps.config.json`** — one block per region, each with its own bounding box,
   grid sizes and land targets. One source of truth, also embedded in the generated
   TypeScript and asserted by a unit test. Eurasia is 205° x 92° (Iberia to Kamchatka),
   Europe 73° x 43° (the Atlantic to eastern Anatolia, Trondheim to the Sahara's edge); both
   ship 300, 500 and 800 land cells, so the rules never need to know which map is on the
   board.
2. **Rasterise the coastline** — Natural Earth 1:50m land polygons, unioned, sampled on an
   8× supersampled grid. Point-in-polygon, not a scanline fill: the rings self-intersect in
   places and a fill silently drops whole regions. Each record keeps its holes, so the
   Caspian stays water.
3. **Select cells** — rank by land coverage, take exactly N, then swap isolated specks for
   connected neighbours. The land count is exact by construction.
4. **Sample elevation** — ETOPO 2022 60″ windowed through its own TIFF tiles, averaged per
   cell over land (or sea, by the mask). Land and sea use the _same_ bbox, so a cell and its
   height always describe the same patch of ground.
5. **Write** — `data.ts` for the game, `data/mask-<region>-<n>.txt` for humans, a PNG
   preview per region and size, and `data/report.json` with the numeric checks.

## Checks

`data/report.json` records, per region and size: land count vs target, shape IoU against the
rasterised coastline, elevation percentiles, and a landmark table — Tibet, the Himalaya, the
Altai, the Iranian plateau, West Siberia, the Alps and five more for Eurasia; the Alps, the
Pyrenees, the Iberian meseta, the Po plain, the North European Plain, the Carpathians, the
Scandes, Rila, Iceland, the Anatolian plateau, the Taurus, the Tell Atlas and the Nile valley
for Europe. A landmark outside its band prints `!!` and is a signal to look at the mapping,
not to widen the band. The Apennines were dropped from the table rather than widened: at 300
cells Italy is one cell wide and the check keeps landing in the Tyrrhenian through rounding.

## Why Europe's grid is finer

The land count is fixed by the brief, so the grid size decides how much of the coastline
survives. Europe's frame — 25° W to 48° E, 29° N to 72° N — is 51% land, so 800 cells on a
52 x 30 board is very nearly the coastline itself (IoU 0.980). An earlier, denser frame that
stopped at 40° E and 36.5° N needed 800 cells out of 56 x 32; a first attempt at 51 x 29 had
to promote sea cells to reach the target and blurred Sicily and Denmark into blobs (IoU
0.844). The grids are sized against the rasterised land fraction of each bounding box, not by
eye.

Latest run:

| map     | cells | grid  | land | IoU   | p50   | p95    | max    |
| ------- | ----- | ----- | ---- | ----- | ----- | ------ | ------ |
| eurasia | 300   | 28×22 | 300  | 0.960 | 429 m | 1808 m | 4995 m |
| eurasia | 500   | 35×29 | 500  | 0.952 | 410 m | 1852 m | 5084 m |
| eurasia | 800   | 44×36 | 800  | 0.925 | 402 m | 1890 m | 5059 m |
| europe  | 300   | 32×19 | 300  | 0.977 | 225 m | 1192 m | 1910 m |
| europe  | 500   | 41×24 | 500  | 0.992 | 214 m | 1183 m | 2163 m |
| europe  | 800   | 52×30 | 800  | 0.980 | 215 m | 1214 m | 2088 m |

At 300 cells one cell is 7.3° × 4.2°, so the Gangetic cell averages the plain with the
Himalaya (876 m) and falls outside its band — expected at that resolution, not a bug.

## Licences

- Natural Earth — public domain, no attribution required, commercial use allowed.
- ETOPO 2022 (NOAA/NCEI) — U.S. Government work, public domain. Credited in the page footer
  anyway.

`data/sources.json` pins the exact URL, byte size and sha256 of every input actually used.
