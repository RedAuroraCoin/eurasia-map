# Eurasia Map — Stage 0: architecture decision pack

Status: **awaiting your sign-off**. Nothing under "Stages" is implemented before you answer the four
questions in §12.

Scope of this document: options, recommendation, rationale, and the verified facts behind them.
Every claim marked *verified* was checked against the vendor's own documentation or the npm registry
on 2026-11-11; anything not marked is a judgement call.

---

## 1. Decision summary

| # | Item | Recommendation |
|---|------|----------------|
| 1 | Language / tooling | TypeScript 7.0.2, npm workspaces monorepo, Vite 8.3.7, Vitest 5.1, Playwright 1.65 |
| 2 | Rendering | three.js r187 (WebGL2), 3D diorama, three quality tiers |
| 3 | UI layer | Plain DOM + typed i18n dictionary; Preact only when the tech tree lands |
| 4 | Logic model | Pure reducer `(state, command, ctx) -> {state, events}`, seeded RNG, injected clock |
| 5 | Network / server | Cloudflare Workers + one Durable Object per room (SQLite), no tick loop |
| 6 | Identity | 128-bit device secret (localStorage + cookie mirror), SHA-256 server-side |
| 7 | Storage | localStorage (versioned envelope) on device; DO SQLite server-side |
| 8 | Testing | Vitest + fast-check, vitest-pool-workers two-client IT, Playwright two-context E2E, WS load script |
| 9 | Release | Two Workers (staging/prod), GitHub Actions, versioned deploys, instant rollback |
| 10 | Accounts / leaderboard | No separate service; append-only stats row at match end |

Target cost for two players: **$0/month**. The single paid upgrade, if it is ever needed, is Workers
Paid at $5/month.

---

## 2. Item 1 — Language and build tooling

| Option | Pros | Cons | Risk | Cost |
|---|---|---|---|---|
| **A. TypeScript 7 + npm workspaces + Vite (rec.)** | One language end to end; the rules module is literally the same file on client, server and in tests; the protocol is a type, so client/server drift becomes a compile error; one lockfile with exact pins; Vite 8 dev server with HMR is a single command | A build step exists; TS 7 is the new native compiler (4 months old); local Node must be ≥22.12 (this box has 18.19.1) | Low | $0 |
| B. Plain JS ES modules, no build (what `pw0` is today) | Zero tooling; edit and reload | No types → the exact failure mode this project must avoid (client and server disagreeing about the shape of a message); no dead-code elimination; renaming a field is a grep | Medium — grows into unmaintainability | $0 |
| C. Two stacks (e.g. SvelteKit + Node service) | Best-in-class UI ergonomics | Two runtimes, two build configs, two dependency trees; breaks "one language, few moving parts" | Low value, high upkeep | $0 + attention |

**Why A.** The brief puts maintainability first, and the hardest maintenance problem here is a
protocol shared by three consumers. Types solve it for free. TS 7.0.2 is the current `latest`
(published 2026-07-08, Apache-2.0, native compiler binaries per platform). If any tool in the chain
misbehaves on TS 7, the fallback pin is 5.9.3 — a one-line change.

### Repository layout

```
eurasia/
  package.json            # workspaces, "save-exact": true, engines.node >=22.12
  package-lock.json       # committed
  tsconfig.base.json
  packages/
    shared/               # pure TS: rules, balance, rng, protocol, map types, i18n keys
      src/engine/         # reducer, systems, commands, events
      src/protocol/       # message types + runtime validation (zod)
      src/balance.ts      # every number in the game
    client/               # Vite app: three.js scene, DOM UI, input, save/migrate
      src/render/
      src/ui/
      src/i18n/ru.ts      # all user-facing strings, one file
    server/               # Worker entry + Durable Object Room class
      src/room/
      wrangler.jsonc
  tools/terrain/          # Python: DEM + polygons -> game-ready grid (build-time only)
  data/                   # committed generated masks + elevation + attribution
  tests/                  # e2e (Playwright), load (Node + ws)
  docs/
```

**Dependency rule (enforced by an ESLint `no-restricted-imports` rule):**
`shared` imports nothing from the repo. `client` and `server` may import `shared`. `client` never
imports `server`, `server` never imports `client`, and neither imports `three`. This is what makes
the rules testable and portable to a future native or bot client.

---

## 3. Item 2 — Rendering

| Option | Pros | Cons | Risk | Cost |
|---|---|---|---|---|
| **A. three.js r187, WebGL2 (rec.)** | Real relief, real lighting, the hurricane look the brief describes is achievable; huge ecosystem; ~170 KB gzip for the modules we use; instancing handles the cell count trivially | Manual scene graph; no editor; shadows and particles must be budgeted by hand | Low | $0 |
| B. PixiJS 8 (2D) | Cheapest possible fill rate; excellent on old phones; simple sprite pipeline | Kills the terrain relief, the daylight rig and the 3D hurricane; the brief's visual identity would have to be rebuilt as fake isometrics | Medium — product regression | $0 |
| C. Babylon.js | Terrain, water, PBR and particles built in; strong playground | ~2× the bundle; larger API surface for the same 12 draw calls; fewer targeted answers when something is slow | Low, but more code to maintain | $0 |

**Why A.** The cost is dominated by fragment shading, not by cell count. 800 cells is a small scene:
one instanced mesh, one terrain geometry, one sea plane. A 2019 mid-range phone holds ~30 fps at
device pixel ratio 1.0 with shadows off.

### How it is built (draw-call budget)

- **Terrain** — one static `BufferGeometry` (up to 44×36 quads), vertices displaced by elevation,
  vertex colours green→brown→grey→white, `flatShading` for the diorama look. 1 draw call.
- **Cells** — one `InstancedMesh` of prisms for claimable land; per-instance colour for ownership.
  1 draw call for all 800.
- **Buildings** — one `InstancedMesh` of boxes, per-instance `scale.y` animated by the growth curve,
  per-instance colour for the night-glow emissive channel. 1 draw call.
- **Sea** — one plane, 96×96 segments, custom shader: 3 gerstner-ish sines for waves, colour ramp by
  depth from a precomputed depth texture, foam band where depth → 0. 1 draw call.
- **Hurricane** — dome mesh with a scrolling layered-noise shader + an `eye`, one funnel cone, one
  `Points` system (~600 particles) for dust and debris, one ground ring. 3–4 draw calls.
- **Total ≈ 12 draw calls, one render pass**, no post-processing, `ACESFilmicToneMapping`.

**Quality tiers** (auto-selected by a 40-line probe of `devicePixelRatio`, `renderer.info` and a
2-second frame-time warm-up, plus a manual override in settings):
`high` shadows on, DPR 2, particles 600 · `medium` shadows off, DPR 1.5, particles 300 ·
`low` DPR 1, flat lighting, no water displacement, particles 0, `prefers-reduced-motion` forces this
plus no waves. **The 2D fallback is not needed**: the low tier is the fallback, and it keeps the map
readable.

---

## 4. Item 3 — The interface around the scene

The panel is ~8 controls, two counters and a message line. This is small enough that a framework is a
liability today and an asset in Stage 7 (tech tree = nested lists, unit rosters, build queues).

| Option | Pros | Cons | Risk | Cost |
|---|---|---|---|---|
| **A. DOM + TS + a 60-line store (rec.)** | Zero framework tax; CSS custom properties give light/dark for free; the whole UI is inspectable in devtools; a11y is native | Manual DOM updates; a "render(state)" function must be disciplined | Low | $0 |
| B. Preact 11 | ~4 KB, JSX, hooks; trivial migration of any component | Introduces a virtual DOM and a second rendering model for 8 controls | Low | $0 |
| C. SvelteKit | Compiles away; great for the strategy UI later | A meta-framework for one page; SSR is useless here; coupling the build to the router | Medium | $0 |

**Why A, and the exit ramp.** Each UI block is a pure function `render(props) -> HTMLElement` with an
explicit `update(state)`. The migration trigger is written down: *when a screen owns more than two
dynamic lists, port `ui/` to Preact and keep the same props*. Expected to fire at Stage 7, not before.

Accessibility, built in from the first commit rather than retrofitted:
- `<canvas tabindex="0" role="application">`; arrows move a cursor, `Enter`/`Space` claim, `Esc`
  clears; the cursor cell is announced through a visually hidden `aria-live="polite"` region.
- All controls are real `<button>`/`<input>` elements with labels; no click-only affordances.
- `prefers-reduced-motion: reduce` stops waves, particles, the day/night drift and the claim pop-up.
- `prefers-color-scheme` picks the initial theme; the manual switch persists and wins.
- Errors are text in the message line, not toasts that vanish, with a code (`E_NO_COINS`,
  `E_CELL_TAKEN`, `E_STALE`, `E_OFFLINE`).

---

## 5. Item 4 — The game-logic model

| Option | Pros | Cons | Risk | Cost |
|---|---|---|---|---|
| **A. Pure reducer + seeded RNG + injected clock (rec.)** | Same code in browser, Worker and tests; replays and hash-equality tests come free; trivially fuzzable | Requires discipline: no `Date.now()`, no `Math.random()`, no DOM in `shared` (enforced by lint) | Low | $0 |
| B. ECS library (bitECS) | Data-oriented, scales to units later | Indirection for 800 cells; debugging needs tooling; overkill now | Low value | $0 |
| C. Class-based model with its own timers | Familiar | Untestable without a clock mock; non-deterministic; the exact thing that makes the server untrustworthy | High | — |

**The contract:**

```ts
type Ctx = { nowMs: number; rand: Rng; ids: IdGen };          // no ambient time, no ambient entropy
type Reduce = (state: GameState, cmd: Command, ctx: Ctx) => Result; // {ok, state, events} | {ok:false, code}
```

Rules:
1. `state` is plain JSON (no `Map`, no `Date`, no class instances). It is what we save, send and hash.
2. All randomness comes from named streams: `rand.stream('weather')`, `rand.stream('growth')`. Adding
   a system therefore cannot shift another system's sequence — critical when we add units later.
3. Coins are integers. No floating-point money, ever.
4. Time arrives as a parameter. The only place `Date.now()` appears is `client/main.ts` and the DO's
   `now()`; both are injected downward.
5. Every accepted command appends to the command log: `{seq, at, player, cmd}`. `snapshot(seed, log)`
   must equal the live state — that is a test, and it is also the replay format and the bot harness.
6. `balance.ts` is the only file with numbers; it is validated by a zod schema at build time so that
   the future editable data files cannot load half-broken.

---

## 6. Item 5 — Network and server for the two-player mode

| Option | Pros | Cons | Risk | Cost |
|---|---|---|---|---|
| **A. Cloudflare Workers + Durable Object per room (rec.)** | One deploy target for static assets, WebSocket and state; the DO *is* the trusted side — a single-threaded actor, so a claim race is impossible by construction; SQLite storage with alarms for timers; no database to operate, no connection pool, no cold DB; global anycast | Vendor lock-in on the DO storage and alarm API; Workers Free caps CPU at 10 ms/request | Low; the lock-in is ~150 lines behind an interface | $0 (verified limits below) |
| B. Supabase Postgres + Realtime + RPC (what `pw0` uses) | Existing code; SQL; RLS; dashboard | Free projects **pause after 1 week of inactivity**; no server-side timer except pg_cron (1-minute granularity), so hurricane authority would end up client-driven = forgeable; the rules would live in plpgsql — a second language, untestable with the same code as the client | Medium-high against the brief's anti-cheat requirement | $0, but pausing is a real failure mode |
| C. Node + Colyseus on Fly/Railway/Render | Best-in-class room framework; in-memory timers; full Node | Free tiers have largely disappeared and free instances sleep when idle — an in-memory room dies with the process; a second host is needed for static; you now operate a server | Medium | ~$3–5/mo, unverified per provider |

### Why A, concretely

The hurricane requirement ("both players see the same hurricane at the same time", "outcomes not
forgeable") is normally solved with a server tick loop. On Workers Free a tick loop is unaffordable:
**WebSocket messages are billed as Durable Object requests, 100,000/day.** So the design avoids loops
entirely:

1. The server issues a **weather plan**: `{id, seed, side, startAt, durationMs, controlPoints[],
   radius}`. It is deterministic and about 200 bytes.
2. Both clients animate it locally from the same seed, offset by a **clock sync** (`ping/pong`, the
   median of 5 samples, applied to `nowMs`). They agree within latency, which the brief allows.
3. The server resolves **damage once**, at `startAt + resolveAt`, from an alarm. One request per
   hurricane. The client's opinion of what was hit is never trusted or even sent.
4. Day boundaries (income) use the same trick: one alarm at 00:00 UTC per room, not a timer per
   player.

**Request budget** (the number that decides whether this stays $0):
one claim = 1 inbound message + 1 broadcast fan-out to 2 sockets ≈ **3 requests**. 100,000/day
therefore supports ≈33,000 game actions per day — roughly 30× a realistic two-player session. No
heartbeat is used at all (`WebSocket` Hibernation keeps the socket alive without billing duration).

| Verified limit (Workers/DO Free) | Value | When it would bite |
|---|---|---|
| DO requests | 100,000/day | >33k actions/day in one day (~9 hours of continuous clicking) |
| DO duration | 13,000 GB-s/day | ~28 hours of continuous play (0.128 GB × s) |
| CPU per request | 10 ms | Never — a claim is <1 ms; terrain generation is build-time only |
| Row writes | 100,000/day | Saves are per-mutation; 33k actions ≪ 100k |
| SQL storage | 5 GB | ~50k rooms of 100 KB; cleanup deletes idle rooms anyway |

### Protocol

```ts
// C -> S
{t:'hello', proto:1, room:'7KQ4M2XP9A', secret:'<128-bit hex>', nick:'...'}
{t:'claim', idx, rev}            // rev = the state revision the click was based on
// S -> C
{t:'welcome', proto:1, seat:'p1', rev:42, state:{...}}
{t:'diff', rev:43, cells:[[idx,'p1',bornAt]], coins:{p1:118,p2:95}, weather:{...}}
{t:'reject', idx, code:'taken'|'no_coins'|'stale'|'rate'}
{t:'reload', minProto:2}         // outdated client: show "refresh the page", stop the loop
```

- **Exactly one winner on a race**: the DO serialises handlers; the loser gets `reject: taken`.
- **Revision numbers** make stale clicks explicit instead of silently wrong.
- **Rate limit**: token bucket per connection, 10 msg/s burst 20; 100 violations → close.
- **Origin allow-list**: `Origin` is checked on the WebSocket upgrade. CORS does not protect
  WebSockets, so this is a server-side check, not a header.
- **Room creation**: `POST /api/room`, code generated server-side, 3/min per IP
  (`CF-Connecting-IP`), 2 people max — a third connection is rejected at `hello`, not after joining.
- **Cleanup**: an alarm at `lastSeen + 24h` marks the room dead and deletes storage; empty rooms do
  not accumulate.
- **Idle restart**: no activity for 5 minutes → the weather schedule resets on the next event, as
  specified.

### Versioning and migrations

`proto` is an integer in the first frame; mismatch → `{t:'reload'}` and the client shows a modal
instead of half-working. State migrations live in the DO and run inside `blockConcurrencyWhile`
before the first WebSocket is accepted, keyed by a `schema_version` row in a `meta` table
(forward-only, additive; the last two versions are always still readable). Deployment never touches
state destructively — that is what makes "saved room state survives game updates" true rather than
hoped for.

---

## 7. Item 6 — Identification without accounts

| Option | Pros | Cons | Risk |
|---|---|---|---|
| **A. 128-bit secret in localStorage + cookie mirror (rec.)** | Works with no backend and no third party; survives tab close, private mode within a session; the cookie covers the case where localStorage is partitioned | Lost when the user clears site data — unavoidable without an account, and acceptable | Low |
| B. URL token per seat | Survives everything, including a device change if the link is kept | The link is the credential; anyone who sees a screenshot of the URL takes the seat | High |
| C. Cookie only | Simple | Safari caps script-written cookies at 7 days, so the seat silently dies | Medium |

**Design:** `playerId` is a random 128-bit hex string generated on first visit, kept as
`em:<id>` in localStorage and a `SameSite=Lax; Secure; max-age=1y` cookie. The server stores only
`sha256(secret)` in the room. **The invite link contains the room code only** — never a seat
credential — so forwarding it cannot hand over cells. A returning player is matched by hash to their
seat; an unknown secret in a full room is rejected with a clear message, not seated as a third
player.

**Nickname:** ≤24 characters, NFC-normalised, stripped of C0/C1 controls, zero-width and bidi
characters, rendered exclusively via `textContent` (never `innerHTML`), and length-checked in
grapheme clusters. The server re-validates. No email, no IP storage, no fingerprinting.

**Room code:** 10 characters from a Crockford base32 alphabet with `I`, `L`, `O`, `U` removed
(32 symbols, 50 bits) — unguessable at room scale, and readable over the phone.

---

## 8. Item 7 — Data storage and schema versions

| Layer | Choice | Why not the alternative |
|---|---|---|
| Device (single-player) | `localStorage`, one key `eurasia.save`, envelope `{v:3, ...}` | IndexedDB is async, ~5× the code, and buys nothing at 20–40 KB. Revisit if we keep replay logs. |
| Room (server) | DO SQLite: `meta`, `state` (one JSON blob), `cells`, `events` | A normalised cell table is nice to have, but the blob is the thing we hash and migrate; `cells` exists only for cheap queries. |

**Migration chain** on both sides: `migrate(v)` → `migrate(v+1)` → … applied on load; a save from a
*newer* version is never silently dropped — it is refused with an explanation and a "start over"
button. Protocol and save versions are separate numbers on purpose: they change for different reasons.

---

## 9. Item 8 — Testing

| Level | Tool | What it proves |
|---|---|---|
| Unit | Vitest 5.1 | rules: cost, refund, income across day boundaries, growth curve, building height, reset |
| Property | fast-check 4.10 | "coins never negative", "claim→unclaim returns to the same state", "replay(seed, log) hash equals live hash" |
| Integration | `@cloudflare/vitest-pool-workers` 0.23 | two real WebSocket clients against a real DO: same-cell race → exactly one winner; reconnect restores the seat; third player rejected; version mismatch → reload |
| Determinism | golden hash | same seed + same log = same state hash, on every commit |
| E2E | Playwright 1.65, two browser contexts | the loop a human does: create → share → join → race → reload → reconnect |
| Load | small Node + `ws` script | 200 rooms × 2 clients, p95 message latency, no cross-room leakage |
| Fuzz | custom | malformed frames, oversized payloads, 10k msg/min, unicode nicknames, expired revs |

I deliberately do not use the `k6` npm wrapper (it is a 0.0.0 stub); a 120-line `ws` harness is
enough at this scale and adds no dependency.

Every rule change ships with its test. A protocol or save-format change bumps a version and a
migration — without exception, as the brief requires.

---

## 10. Item 9 — Release

- **Two Workers**: `eurasia-staging` and `eurasia-prod` — same code, different config, separate DO
  namespaces. Staging is where the two-phone test happens before promotion. Preview deploys per PR
  get their own URL and DO namespace from the branch name.
- **CI (GitHub Actions)**: `npm ci` → typecheck → lint → unit → build → E2E (headless Chromium) →
  deploy staging on `main` → prod on a tag. One workflow file, four minutes.
- **Rollout**: `wrangler versions upload` + `wrangler versions deploy` (10% → 100%) so a bad build can
  be stopped mid-flight; `wrangler rollback` restores the previous version in seconds.
- **Migration safety**: DO migrations are forward-only and additive, run on first open after deploy,
  and are guarded by `blockConcurrencyWhile`. A rollback never needs to un-migrate because old code
  still reads old fields.
- **Logs**: Workers Logs + `wrangler tail` for an incident; the client posts failures to `/api/error`
  with a 200/day per-room cap (free-tier friendly), no PII, no nicknames in logs.
- **Secrets**: ideally none. The only one that could appear is an alerting webhook.

---

## 11. Item 10 — A separate accounts/leaderboard service

Not now, and not by accident: `playerId` is opaque and already stable across rooms, and the room
writes one append-only `result` row (`playerId`, `nicknameSnapshot`, `cells`, `at`) when a match
ends. That row is the entire input a future leaderboard needs, and reading it does not require
touching the game loop.

| Option | Verdict |
|---|---|
| **A. No service; stats rows written by the room (rec.)** | Zero extra moving parts today, and the seam is real |
| B. Supabase/D1 from day one | Only worth it if you want SQL aggregation across players — not needed for two players |
| C. Dedicated service now | Premature; adds a deployment, a secret and a failure mode for no user-visible feature |

Rule if it ever grows: the room never calls out on the hot path; writes go through a Queue or at
match end.

---

## 12. Questions (four; answering 1 and 2 unblocks everything)

1. **The existing prototype.** `pw0` already contains exactly the three masks you specify — 28×22
   with 300 land cells, 35×29 with 500, 44×36 with 800 — plus an elevation grid and a working
   three.js hurricane. Do we (a) rebuild in a new monorepo and port those assets, or (b) keep the
   Supabase backend and restructure around it? I recommend (a); the masks and the visual code are
   directly reusable, the transport is not.
2. **Cloudflare.** Do you have an account, and is a `https://<name>.workers.dev` link acceptable, or
   do you want a custom domain (≈$10/year, unrelated to Cloudflare)? No card is needed for the free
   plan.
3. **Commercial plans** (ads, donations, paid anything)? Not a problem for Cloudflare either way, but
   it rules Vercel out permanently (Hobby is non-commercial only, verified) and changes what "free
   tier" can be relied on.
4. **Terrain preprocessing in Python** — `numpy` + `rasterio` + `pyshp` in `tools/terrain/`, run once
   per data change, output committed to `data/`. It is the only non-TypeScript code in the repo. OK,
   or do you want it all in Node (weaker GIS libraries, more code)?

---

## 13. What I verified today (2026-11-11)

| Claim | Where |
|---|---|
| `three@0.187.0` (MIT), `@types/three@0.187.0`, `vite@8.3.7` (MIT, engines `^20.19 \|\| >=22.12`), `typescript@7.0.2` (Apache-2.0, published 2026-07-08), `vitest@5.1.0`, `@playwright/test@1.65.0`, `wrangler@4.160.0`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers@0.23.0`, `zod@4.6.7`, `fast-check@4.10.2`, `@supabase/supabase-js@2.119.0` | npm registry, `latest` dist-tag |
| Workers Free: 100,000 requests/day, 10 ms CPU/request, 128 MB, 100 Workers, 20,000 static files per version | developers.cloudflare.com/workers/platform/limits |
| Durable Objects Free: SQLite backend only; 100,000 requests/day, 13,000 GB-s/day, 5M row reads/day, 100,000 row writes/day, 5 GB storage; SQLite storage billing started 2026-01-07; WebSocket messages and alarm invocations count as requests | developers.cloudflare.com/durable-objects/platform/pricing |
| Static assets are deployed with the Worker (single deploy unit) | developers.cloudflare.com/workers/static-assets |
| Supabase Free: 500 MB DB, 5 GB egress, 2 active projects, **projects paused after 1 week of inactivity** | supabase.com/pricing |
| Vercel Hobby is restricted to **non-commercial, personal use** | vercel.com/docs/plans/hobby |
| Natural Earth is **public domain**, commercial use allowed, attribution not required | naturalearthdata.com/about/terms-of-use |
| ETOPO 2022 (NOAA/NCEI) 60″ GeoTIFF is served directly over HTTPS with no login (`HTTP/2 200`, 466 MB, `content-type: image/tiff`) | ncei.noaa.gov product page + a `HEAD` request to the file |
| This dev box runs Node 18.19.1 → **must be upgraded to 22 LTS** before Stage 1 (Vite 8 requires ≥22.12) | `node -v` |

Not verified in this pass, and therefore not relied on: provider terms for Fly/Railway/Render (I only
need them if option C wins), and the exact price of a custom domain at your registrar.

---

## 14. After sign-off — Stage 1 deliverables

1. Repo skeleton with the workspace layout above, `engines`, exact pins, ESLint/Prettier, CI green.
2. `balance.ts` with every number from the brief, plus the zod schema.
3. `tools/terrain/`: Natural Earth land polygons + ETOPO 2022 → 300/500/800 masks and a per-cell
   elevation grid, reproducible with one command, with a visual check (rendered PNG) and a numeric
   check (IoU against the reference outline, elevation percentiles per range).
4. `shared/engine` with the claim/refund/income reducer and its first tests.
5. A "hello world" Worker that serves the assets and opens a DO room — no game logic yet.

Then Stage 2 as specified. Report format after each stage: done / how verified (exact commands) /
what was not verified (including "opened in a real browser and on a phone: yes/no") / risks / next.
