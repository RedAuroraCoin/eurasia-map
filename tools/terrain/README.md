# Terrain preparation

Turns open GIS data into the grid the game actually ships. Build-time only: nothing here
runs in the browser or in the Worker.

## Run

```bash
python3 -m venv tools/terrain/.venv
tools/terrain/.venv/bin/pip install -r tools/terrain/requirements.txt
tools/terrain/.venv/bin/python tools/terrain/prepare.py          # everything
tools/terrain/.venv/bin/python tools/terrain/prepare.py --only 800
```

The first run downloads 466 MB (ETOPO 2022) and 450 KB (Natural Earth) into `~/.cache/eurasia`.
Override the cache with `EURASIA_CACHE=/path`.

## Pipeline

1. **Read `data/maps.config.json`** — bounding box, grid sizes, land targets. One source of
   truth, also embedded in the generated TypeScript and asserted by a unit test.
2. **Rasterise the coastline** — Natural Earth 1:50m land polygons, unioned, sampled on an
   8× supersampled grid. Point-in-polygon, not a scanline fill: the rings self-intersect in
   places and a fill silently drops whole regions. Each record keeps its holes, so the
   Caspian stays water.
3. **Select cells** — rank by land coverage, take exactly N, then swap isolated specks for
   connected neighbours. The land count is exact by construction.
4. **Sample elevation** — ETOPO 2022 60″ windowed through its own TIFF tiles, averaged per
   cell over land (or sea, by the mask). Land and sea use the *same* bbox, so a cell and its
   height always describe the same patch of ground.
5. **Write** — `data.ts` for the game, `data/mask-<n>.txt` for humans, a PNG preview, and
   `data/report.json` with the numeric checks.

## Checks

`data/report.json` records, per size: land count vs target, shape IoU against the rasterised
coastline, elevation percentiles, and a landmark table (Tibet, Himalaya, Altai, Iranian
plateau, West Siberia, Alps, Arabia, Gobi, the Gangetic plain, Turan, the Deccan, north-east
Siberia). A landmark outside its band prints `!!` and is a signal to look at the mapping, not
to widen the band.

Latest run:

| size | grid | land | IoU | p50 | p95 | max |
|---|---|---|---|---|---|---|
| 300 | 28×22 | 300 | 0.960 | 429 m | 1 808 m | 4 995 m |
| 500 | 35×29 | 500 | 0.952 | 410 m | 1 852 m | 5 084 m |
| 800 | 44×36 | 800 | 0.925 | 402 m | 1 890 m | 5 059 m |

At 300 cells one cell is 7.3° × 4.2°, so the Gangetic cell averages the plain with the
Himalaya (876 m) and falls outside its band — expected at that resolution, not a bug.

## Licences

- Natural Earth — public domain, no attribution required, commercial use allowed.
- ETOPO 2022 (NOAA/NCEI) — U.S. Government work, public domain. Credited in the page footer
  anyway.

`data/sources.json` pins the exact URL, byte size and sha256 of every input actually used.
