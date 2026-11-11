#!/usr/bin/env python3
"""
Reproducible terrain preparation: open GIS data in, game-ready grid out.

    python3 tools/terrain/prepare.py            # generate everything
    python3 tools/terrain/prepare.py --refresh  # re-download the sources first
    python3 tools/terrain/prepare.py --only 800 # one size, for iteration

Inputs (downloaded into ~/.cache/eurasia, never committed):
  * Natural Earth 1:50m land polygons          — public domain
  * ETOPO 2022 v1 60" surface elevation        — NOAA/NCEI, U.S. Government work

Outputs (committed):
  * packages/shared/src/map/data.ts            — typed grid: mask + elevation
  * data/mask-<size>.txt                       — human-readable mask
  * data/preview-<size>.png                    — visual check
  * data/report.json                           — numeric checks
  * data/sources.json                          — URLs, sizes, sha256, licences

The projection is deliberately not a real map projection: the brief asks for a
stylised grid, so the bounding box is simply squeezed onto rows x columns. What
matters is that the mask and the elevation come from the *same* mapping, which
is why both are computed here, in one pass, from one bbox.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import tifffile
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
OUT_TS = ROOT / "packages" / "shared" / "src" / "map" / "data.ts"
CACHE = Path.home() / ".cache" / "eurasia"

# ETOPO grid geometry (fixed by the product, not by us)
PPD = 60.0  # pixels per degree, 60 arc-second grid
LAT_TOP, LON_LEFT = 90.0, -180.0

LAND_PX = (0.55, 0.62, 0.36)
SEA_PX = (0.11, 0.31, 0.53)


# --------------------------------------------------------------------------- io


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size > 0:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    print(f"  downloading {url}")
    with urllib.request.urlopen(url) as response, tmp.open("wb") as out:
        total = int(response.headers.get("content-length") or 0)
        done = 0
        started = time.time()
        while True:
            chunk = response.read(1 << 20)
            if not chunk:
                break
            out.write(chunk)
            done += len(chunk)
            if total and done % (16 << 20) < (1 << 20):
                pct = 100 * done / total
                print(
                    f"    {done >> 20:4d}/{total >> 20} MB  {pct:5.1f}%  "
                    f"{done / max(1, time.time() - started) / 1e6:4.1f} MB/s",
                    flush=True,
                )
    tmp.replace(target)


def ensure_sources(config: dict, refresh: bool) -> dict[str, Path]:
    CACHE.mkdir(parents=True, exist_ok=True)
    land_zip = CACHE / "ne_50m_land.zip"
    dem = CACHE / "etopo2022_60s.tif"

    if refresh:
        land_zip.unlink(missing_ok=True)
        dem.unlink(missing_ok=True)

    download(config["sources"]["land"]["url"], land_zip)
    download(config["sources"]["elevation"]["url"], dem)

    sources = {}
    for key, path in (("land", land_zip), ("elevation", dem)):
        sources[key] = {
            "name": config["sources"][key]["name"],
            "url": config["sources"][key]["url"],
            "license": config["sources"][key]["license"],
            "bytes": path.stat().st_size,
            "sha256": sha256(path),
        }
    return {"land_zip": land_zip, "dem": dem, "manifest": sources}


# ------------------------------------------------------------------- rasterise


def rasterise_land(land_zip: Path, config: dict, size: dict, supersample: int) -> np.ndarray:
    """Coverage fraction of land per grid cell, in [0, 1].

    Point-in-polygon rather than a scanline fill: Natural Earth rings at this
    scale are self-intersecting in places, and PIL's polygon fill silently drops
    whole regions when they are. Shapely's union keeps the coastline honest, and
    testing a regular sample grid gives an area fraction rather than a yes/no.
    """
    import shapefile  # pyshp
    from shapely import contains_xy
    from shapely.geometry import shape as to_shape
    from shapely.ops import unary_union
    from shapely.validation import make_valid

    bbox = config["bbox"]
    rows, cols = size["rows"], size["cols"]
    width, height = cols * supersample, rows * supersample
    lon_span = bbox["lon1"] - bbox["lon0"]
    lat_span = bbox["lat1"] - bbox["lat0"]

    with zipfile.ZipFile(land_zip) as archive:
        archive.extractall(CACHE / "ne_50m_land")

    reader = shapefile.Reader(str(CACHE / "ne_50m_land" / "ne_50m_land.shp"))
    polygons = []
    # `shape(record.__geo_interface__)` is the important part: it keeps each
    # record's outer ring and its holes together. Building one polygon per ring
    # instead turns every lake into an island and every hole into land.
    for record in reader.shapes():
        geometry = to_shape(record.__geo_interface__)
        if geometry.is_empty:
            continue
        if not geometry.is_valid:
            geometry = make_valid(geometry)
        min_lon, min_lat, max_lon, max_lat = geometry.bounds
        if max_lon < bbox["lon0"] or min_lon > bbox["lon1"]:
            continue
        if max_lat < bbox["lat0"] or min_lat > bbox["lat1"]:
            continue
        polygons.append(geometry)

    land = unary_union(polygons)

    xs = bbox["lon0"] + (np.arange(width) + 0.5) / width * lon_span
    ys = bbox["lat1"] - (np.arange(height) + 0.5) / height * lat_span
    grid_x, grid_y = np.meshgrid(xs, ys)
    inside = contains_xy(land, grid_x, grid_y)

    coverage = inside.reshape(rows, supersample, cols, supersample).astype(np.float32).mean(axis=(1, 3))
    print(
        f"  {len(polygons)} polygons unioned, {width}x{height} samples "
        f"({supersample}x supersample)"
    )
    return coverage


def neighbours(index: int, rows: int, cols: int) -> list[int]:
    row, col = divmod(index, cols)
    out = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            if dr == 0 and dc == 0:
                continue
            r, c = row + dr, col + dc
            if 0 <= r < rows and 0 <= c < cols:
                out.append(r * cols + c)
    return out


def select_mask(coverage: np.ndarray, rows: int, cols: int, land_target: int) -> np.ndarray:
    """Top-N cells by coverage, with isolated specks swapped for connected cells.

    The count is exact by construction: we remove and re-add the same number, so
    '300 land cells' stays true no matter how the coastline falls.
    """
    order = np.argsort(-coverage.ravel(), kind="stable").tolist()
    chosen = set(order[:land_target])

    for _ in range(8):
        isolated = [i for i in chosen if not any(n in chosen for n in neighbours(i, rows, cols))]
        if not isolated:
            break
        chosen -= set(isolated)
        for candidate in order:
            if len(chosen) >= land_target:
                break
            if candidate in chosen:
                continue
            if any(n in chosen for n in neighbours(candidate, rows, cols)):
                chosen.add(candidate)
        for candidate in order:  # pad if the connected set ran out (near-empty maps)
            if len(chosen) >= land_target:
                break
            chosen.add(candidate)

    mask = np.zeros(rows * cols, dtype=bool)
    mask[list(chosen)] = True
    return mask.reshape(rows, cols)


# --------------------------------------------------------------------- elevation


def sample_elevation(dem_path: Path, config: dict, size: dict, mask: np.ndarray, step: int):
    """Mean elevation per cell, sampled from the same bbox as the mask."""
    bbox = config["bbox"]
    rows, cols = size["rows"], size["cols"]

    r0 = int(round((LAT_TOP - bbox["lat1"]) * PPD))
    r1 = int(round((LAT_TOP - bbox["lat0"]) * PPD))
    c0 = int(round((bbox["lon0"] - LON_LEFT) * PPD))
    c1 = int(round((bbox["lon1"] - LON_LEFT) * PPD))

    window = tifffile.imread(str(dem_path), selection=(slice(r0, r1, step), slice(c0, c1, step)))
    window = np.asarray(window, dtype=np.float32)
    print(f"  DEM window {window.shape[1]}x{window.shape[0]} px (1 px = {step / PPD:.3f} deg)")

    lats = LAT_TOP - (r0 + np.arange(window.shape[0]) * step) / PPD
    lons = LON_LEFT + (c0 + np.arange(window.shape[1]) * step) / PPD

    dlon = (bbox["lon1"] - bbox["lon0"]) / cols
    dlat = (bbox["lat1"] - bbox["lat0"]) / rows

    elevation = np.zeros((rows, cols), dtype=np.int32)
    for row in range(rows):
        lat_a = bbox["lat1"] - row * dlat
        lat_b = lat_a - dlat
        ri = np.nonzero((lats <= lat_a) & (lats >= lat_b))[0]
        if ri.size == 0:
            ri = np.array([int(np.argmin(np.abs(lats - (lat_a + lat_b) / 2)))])
        for col in range(cols):
            lon_a = bbox["lon0"] + col * dlon
            lon_b = lon_a + dlon
            ci = np.nonzero((lons >= lon_a) & (lons <= lon_b))[0]
            if ci.size == 0:
                ci = np.array([int(np.argmin(np.abs(lons - (lon_a + lon_b) / 2)))])

            block = window[ri[0] : ri[-1] + 1, ci[0] : ci[-1] + 1]
            if mask[row, col]:
                values = block[block > 0]
            else:
                values = block[block < 0]
            if values.size == 0:
                values = block
            elevation[row, col] = int(round(float(values.mean())))
    return elevation


# ------------------------------------------------------------------------ checks


LANDMARKS = [
    ("Тибет", 88.0, 32.5, 3000, 5200),
    # a cell is ~4.7 x 2.6 degrees, so a Himalayan cell averages the range with
    # the Ganges plain: 8 000 m peaks and 200 m plains in one number
    ("Гималаи", 84.0, 28.5, 800, 4500),
    ("Алтай", 89.0, 48.0, 500, 3000),
    ("Иранское нагорье", 54.0, 31.0, 700, 2500),
    ("Западная Сибирь", 76.0, 60.0, -50, 300),
    ("Альпы", 10.0, 46.5, 400, 3500),
    ("Аравия", 45.0, 23.0, 0, 1200),
    ("Гоби", 105.0, 43.0, 700, 2000),
    ("Индо-Гангская низменность", 80.0, 26.0, -30, 400),
    ("Туранская низменность", 62.0, 43.0, -60, 400),
    ("Декан", 78.0, 18.0, 150, 1200),
    ("Северо-Восточная Сибирь", 128.0, 65.0, 100, 1500),
]


def landmark_cell(config: dict, size: dict, lon: float, lat: float) -> int:
    bbox = config["bbox"]
    dlon = (bbox["lon1"] - bbox["lon0"]) / size["cols"]
    dlat = (bbox["lat1"] - bbox["lat0"]) / size["rows"]
    col = int((lon - bbox["lon0"]) / dlon)
    row = int((bbox["lat1"] - lat) / dlat)
    col = min(max(col, 0), size["cols"] - 1)
    row = min(max(row, 0), size["rows"] - 1)
    return row * size["cols"] + col


def check_landmarks(config: dict, size: dict, mask: np.ndarray, elevation: np.ndarray) -> list[dict]:
    flat_mask = mask.ravel()
    flat_elev = elevation.ravel()
    out = []
    for name, lon, lat, low, high in LANDMARKS:
        cell = landmark_cell(config, size, lon, lat)
        value = int(flat_elev[cell])
        land = bool(flat_mask[cell])
        out.append(
            {
                "name": name,
                "lon": lon,
                "lat": lat,
                "cell": cell,
                "land": land,
                "elevation": value,
                "expected": [low, high],
                "ok": land and low <= value <= high,
            }
        )
    return out


# ------------------------------------------------------------------------ output


def render_preview(entry: dict, path: Path, scale: int = 14) -> None:
    import map_colors

    rows, cols = entry["rows"], entry["cols"]
    image = Image.new("RGB", (cols * scale, rows * scale), (12, 16, 24))
    draw = ImageDraw.Draw(image)
    for row in range(rows):
        for col in range(cols):
            index = row * cols + col
            elevation = entry["elev"][index]
            land = entry["mask"][index] == "#"
            rgb = map_colors.color(land, elevation)
            x, y = col * scale, row * scale
            draw.rectangle([x, y, x + scale - 1, y + scale - 1], fill=rgb)
    image.save(path)


def format_ts(config: dict, entries: list[dict]) -> str:
    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Source: tools/terrain/prepare.py (Natural Earth 1:50m land + ETOPO 2022 60\").",
        "// Regenerate with: npm run data",
        "import type { MapConfig, MapEntry } from './types';",
        "",
        "export const MAP_CONFIG: MapConfig = " + json.dumps(config_shape(config), indent=2) + ";",
        "",
        "export const MAP_DATA: readonly MapEntry[] = [",
    ]
    for entry in entries:
        rows, cols = entry["rows"], entry["cols"]
        mask = entry["mask"]
        lines.append("  {")
        lines.append(f"    size: {entry['size']},")
        lines.append(f"    rows: {rows},")
        lines.append(f"    cols: {cols},")
        lines.append(f"    land: {entry['land']},")
        lines.append("    mask: [")
        for row in range(rows):
            lines.append(f"      '{mask[row * cols : (row + 1) * cols]}',")
        lines.append("    ].join(''),")
        lines.append("    elev: [")
        values = entry["elev"]
        for i in range(0, len(values), cols):
            chunk = ", ".join(str(v) for v in values[i : i + cols])
            lines.append(f"      {chunk},")
        lines.append("    ],")
        lines.append("  },")
    lines.append("];")
    lines.append("")
    return "\n".join(lines)


def config_shape(config: dict) -> dict:
    return {
        "bbox": config["bbox"],
        "sizes": {k: {"rows": v["rows"], "cols": v["cols"], "land": v["land"]} for k, v in config["sizes"].items()},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate game-ready map and terrain data")
    parser.add_argument("--refresh", action="store_true", help="re-download the source datasets")
    parser.add_argument("--only", default=None, help="generate one size only (300, 500 or 800)")
    parser.add_argument("--supersample", type=int, default=8, help="rasterisation factor")
    parser.add_argument("--step", type=int, default=8, help="DEM decimation, in 60\" pixels")
    args = parser.parse_args()

    config = json.loads((DATA / "maps.config.json").read_text(encoding="utf-8"))
    sizes = {k: v for k, v in config["sizes"].items() if args.only in (None, k)}
    if not sizes:
        print(f"no such size: {args.only}", file=sys.stderr)
        return 2

    print("sources")
    paths = ensure_sources(config, args.refresh)
    (DATA / "sources.json").write_text(
        json.dumps(paths["manifest"], indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    entries = []
    report = {"generated_from": paths["manifest"], "maps": {}}

    for size_key, size in sizes.items():
        size["land"] = int(size["land"])
        print(f"\n== {size_key} land cells on {size['cols']}x{size['rows']}")
        coverage = rasterise_land(paths["land_zip"], config, size, args.supersample)
        mask = select_mask(coverage, size["rows"], size["cols"], size["land"])

        # Shape overlap check: how well the cleaned mask still matches the
        # rasterised coastline at cell resolution.
        reference = coverage >= 0.5
        intersection = int(np.logical_and(mask, reference).sum())
        union = int(np.logical_or(mask, reference).sum())
        iou = intersection / union if union else 0.0

        elevation = sample_elevation(paths["dem"], config, size, mask, args.step)

        rows, cols = size["rows"], size["cols"]
        mask_text = "\n".join(
            "".join("#" if mask[r, c] else "." for c in range(cols)) for r in range(rows)
        )
        (DATA / f"mask-{size_key}.txt").write_text(mask_text + "\n", encoding="utf-8")

        landmarks = check_landmarks(config, size, mask, elevation)
        land_elev = elevation[mask]
        entry = {
            "size": int(size_key),
            "rows": rows,
            "cols": cols,
            "land": int(mask.sum()),
            "mask": mask_text.replace("\n", ""),
            "elev": elevation.ravel().tolist(),
        }
        entries.append(entry)

        render_preview(entry, DATA / f"preview-{size_key}.png")

        report["maps"][size_key] = {
            "rows": rows,
            "cols": cols,
            "land": int(mask.sum()),
            "land_target": size["land"],
            "shape_iou": round(iou, 4),
            "land_elevation_m": {
                "min": int(land_elev.min()),
                "p50": int(np.percentile(land_elev, 50)),
                "p95": int(np.percentile(land_elev, 95)),
                "max": int(land_elev.max()),
                "mean": int(land_elev.mean()),
            },
            "sea_elevation_m": {
                "min": int(elevation[~mask].min()) if (~mask).any() else 0,
                "p50": int(np.percentile(elevation[~mask], 50)) if (~mask).any() else 0,
            },
            "landmarks": landmarks,
        }

        print(mask_text)
        print(f"  land {int(mask.sum())} / target {size['land']}   shape IoU {iou:.3f}")
        bad = [l for l in landmarks if not l["ok"]]
        for item in landmarks:
            mark = "ok " if item["ok"] else "!! "
            print(f"  {mark}{item['name']:28s} {item['elevation']:6d} m  (want {item['expected']})")
        if bad:
            print(f"  {len(bad)} landmark(s) outside the expected band")

    OUT_TS.write_text(format_ts(config, entries), encoding="utf-8")
    (DATA / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_TS.relative_to(ROOT)} and data/report.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
