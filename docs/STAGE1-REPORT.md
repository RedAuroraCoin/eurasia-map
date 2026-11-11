# Stage 1 — report

Done: repository, build, automated checks, structure, balance file, map and terrain data with a
reproducible preparation script.

Repository: `github.com/RedAuroraCoin/eurasia-map` (private), branch `main`.

## What exists

| Area | What it is |
|---|---|
| `packages/shared` | Pure TypeScript. `balance.ts` (every number, zod-validated at import), `rng.ts` (xoshiro128** + named streams), `engine/` (claim / unclaim / income / growth reducer), `map/` (grid types, colour ramps, generated data), `protocol/` (version gate, room-code alphabet), `nickname.ts` |
| `packages/client` | Vite + TypeScript shell: 2D map preview, size switcher, theme switch, keyboard cell cursor, `i18n/ru.ts` with every user-facing string |
| `packages/server` | Cloudflare Worker: static assets, `/api/health`, `/api/room/<code>` → a real Durable Object with storage |
| `tools/terrain` | Python pipeline: Natural Earth 1:50m + ETOPO 2022 60″ → masks + elevation, one command, with checks |
| `data` | `maps.config.json` (source of truth), masks, previews, `report.json`, `sources.json` (URLs + sha256) |
| `.github/workflows/ci.yml` | typecheck → import gate → prettier → tests → build → generated-data check |

## Verified — commands actually run

```
node -v                                     v22.23.4  (installed to ~/.local/node22; the box had 18.19.1)
npm install                                 89 packages
npm run typecheck                           tsc -p shared && client && server — clean
npm run lint                                import boundaries ok (22 files) + prettier clean
npm test                                    6 files, 63 tests passed
npm run build                               vite 8.3.7 — 111 modules, 95.4 kB (32.5 kB gzip)
./tools/terrain/.venv/bin/python tools/terrain/prepare.py
                                            300/500/800 cells, IoU .960/.952/.925, all landmarks in band
npx wrangler dev --port 8787                Durable Object bound, local
  GET /api/health                           {"ok":true,"protocol":1,...}
  GET /api/room/7KQ4M2XP9A                  {"ok":true,"schema":1,"pings":1} then "pings":2 — DO storage works
  GET /                                    200, 652 B html
  GET /assets/index-*.js                   200, text/javascript, 95 370 B
git clone <repo> /tmp/eurasia-verify && npm ci && npm run check
                                            clean clone builds and tests from the committed tree
```

Terrain numbers (`data/report.json`):

| size | grid | land | shape IoU | p50 | p95 | max |
|---|---|---|---|---|---|---|
| 300 | 28×22 | 300 | 0.960 | 429 m | 1 808 m | 4 995 m |
| 500 | 35×29 | 500 | 0.952 | 410 m | 1 852 m | 5 084 m |
| 800 | 44×36 | 800 | 0.925 | 402 m | 1 890 m | 5 059 m |

Highest cell at every size is in the Tibetan plateau (lon 65–110, lat 25–45), verified by a unit
test rather than by eye.

## Not verified — and why

- **Opened in a real browser: no.** This machine has no Chromium and cannot install one: 13 shared
  libraries are missing (`libnspr4`, `libnss3`, `libatk*`, `libcairo`, `libpango`, `libxkbcommon`,
  …) and there is no `sudo`. Instead the client has a DOM smoke test (happy-dom) covering boot,
  panel structure, size switching, keyboard cursor and theme — it proves the wiring, not the pixels.
- **Opened on a phone: no.** Same reason. Touch handling (`pointerdown/move`, `touch-action`) is
  written but has not been exercised on a device.
- **Deployed to Cloudflare: no.** `wrangler whoami` → "You are not authenticated". Needs
  `wrangler login` on a machine with a browser, or a `CLOUDFLARE_API_TOKEN` secret.
- **CI on GitHub: not yet observed.** The workflow is committed; the first run will tell. A clean
  clone was checked locally with the same commands.
- **Landmarks at 300 cells:** 11 of 12. The Gangetic cell (7.3° × 4.2°) averages the plain with the
  Himalaya and reads 876 m. Expected at that resolution; documented rather than hidden by widening
  the band.

## Risks

1. **Free-tier request budget.** WebSocket messages count as Durable Object requests, 100 000/day.
   The event-based protocol (~3 requests per claim, no tick loop, no heartbeat) keeps a two-player
   session around 1–2 % of that. Any change that introduces per-frame traffic would break the
   assumption — this is the number to watch.
2. **10 ms CPU per request on the free plan.** Terrain generation is build-time only, and claim
   handling is arithmetic. Nothing today is close; a future pathfinding AI on the server would be.
3. **Vendor lock-in.** Confined to `packages/server` (~150 lines). `shared` has no Cloudflare import
   — enforced by the import gate, not by intention.
4. **TS 7.0.2** is four months old (native compiler). Fallback pin is 5.9.3, a one-line change.
5. **The 466 MB download** is the only step that needs network at build time; it is cached in
   `~/.cache/eurasia` and pinned by sha256 in `data/sources.json`.

## Next: Stage 2 — single-player

Map at full quality, claiming with coins and refunds, daily income on visit, 30-day building growth
with the pop-up, day/night, terrain and sea, local saving with a versioned envelope, the panel.
Playwright arrives with the first interaction worth automating, and with it the browser check this
stage could not do.
