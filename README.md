# Eurasia Map

A browser game on a stylised grid map of Eurasia, built to grow from a single-player
clicker into a small strategy game.

The architecture decisions behind this repository are in
[`docs/STAGE0-ARCHITECTURE.md`](docs/STAGE0-ARCHITECTURE.md).

## Stack

- **TypeScript** everywhere: the rules engine, the client and the Worker share one package.
- **three.js** for the scene (Stage 2), plain DOM for the interface.
- **Cloudflare Workers + Durable Objects** for the two-player mode (Stage 4): one object
  per room, so the authoritative side is a single actor and a claim race is impossible
  by construction.
- **$0/month** for two players: static assets, WebSocket and state all live on the free
  Workers plan.

## Layout

```
packages/shared   pure TypeScript: rules, balance, RNG, map data, protocol
packages/client   Vite app: three.js scene, DOM interface, saving
packages/server   Worker entry + the Durable Object that owns a room
tools/terrain     Python: open GIS data -> game-ready grid (build-time only)
data              generated masks, previews, report, source manifest
docs              architecture decisions
```

Dependency rule: `shared` imports nothing from the repo; `client` and `server` import
`shared`; neither imports the other. Enforced by `npm run lint`, not by convention.

The interface is English. Every string lives in `packages/client/src/i18n/`; `ru.ts` keeps the
original Russian translation, type-checked against the English dictionary, and `index.ts` picks the
locale in one line. `npm run lint` fails the build if Cyrillic text appears anywhere else.

## Commands

```bash
nvm use                # Node 22.12+ (Vite 8 requires it)
npm install
npm run dev            # client at http://localhost:5173
npm run check          # typecheck + lint + unit tests + build
npm test               # unit tests only
npm run data           # regenerate map/terrain data from the sources
npm run dev:server     # Worker + Durable Object locally (wrangler)
```

`npm run data` needs a one-time 466 MB download (ETOPO 2022) into `~/.cache/eurasia`.
It is not committed; `data/sources.json` records the URL, size and sha256 of what was used.

## Data

| Source                                                                                     | Licence                             | Used for                         |
| ------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------- |
| [Natural Earth](https://www.naturalearthdata.com/) 1:50m land                              | public domain                       | coastline, hence the cell masks  |
| [ETOPO 2022](https://www.ncei.noaa.gov/products/etopo-global-relief-model) 60″ (NOAA/NCEI) | U.S. Government work, public domain | elevation and sea depth per cell |

Both are fitted to the same bounding box, so a mask cell and its elevation always refer to
the same patch of ground. `data/report.json` records the numeric checks (land count, shape
IoU against the rasterised coastline, elevation percentiles, landmark elevations) and
`data/preview-<size>.png` is the visual check.

## Status

| Stage                              | State                              |
| ---------------------------------- | ---------------------------------- |
| 0. Decisions                       | done — choices confirmed           |
| 1. Skeleton, balance, terrain data | done — see `docs/STAGE1-REPORT.md` |
| 2. Single-player game              | done — see `docs/STAGE2-REPORT.md` |
| 3. Hurricanes                      | next                               |
| 4–7                                | not started                        |

Every rule change ships with a test; every protocol or save-format change bumps a version
and adds a migration.
