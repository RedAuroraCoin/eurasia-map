# Stage 4 contract — the two-player room

Decisions and wire format for the authoritative room. Everything here is fixed before the code
exists, because these are the parts that are expensive to change once two clients are talking.

Scope: the room server, its protocol and its rules. The client for it is Stage 5.

---

## 1. Decisions that had to be made first

### 1.1 Time model: free flow, server ordered

Both players act whenever they want. The server applies commands in the order it receives them and
answers each with the new state. There is no turn state, no deadline, no "waiting for opponent".

Why not turns: the game already runs on shared clocks — income accrues per UTC calendar day, and
hurricanes live on a wall-clock schedule that both players must see simultaneously. A turn machine
would sit on top of that and contradict it: whose turn is it while a hurricane is in flight?

What replaces turns is a **rate limit**, not a turn order:

| Limit | Value | Why |
| --- | --- | --- |
| Burst | 8 commands / 2 s | a fast player can place a few cells quickly |
| Sustained | 40 commands / minute | ~1 cell per 1.5 s, well above human clicking |
| Hard cap | 200 messages / 10 s | abuse guard; exceeding it closes the socket |

A rate-limited command is answered with `reject: rate_limited`; it is not queued and not applied.

### 1.2 Match lifecycle: no end condition yet

```
created ──(2nd player joins)──▶ live ──(both gone 30 min)──▶ dormant
   │                              │                              │
   └──(nobody joins 30 min)──▶ dormant ◀──(7 days idle)──▶ deleted
```

- A room is **live** while both seats have been claimed. It never enters a "finished" state in
  protocol version 1: the brief defines the score (cells owned) but no win condition, and inventing
  one now would be a rule the player never agreed to.
- `dormant` keeps everything: state, wallets, kings. A player who returns finds the same seat.
- Deletion is by storage alarm after 7 days without a connection.
- `resign` is in the protocol but not yet in the engine: it lands with the room, marks a seat as
  resigned and does nothing else. When a win condition is agreed, it becomes the trigger for the
  result row and the room's terminal state.

### 1.3 Command vocabulary: intent only, additive later

The server accepts exactly the commands the engine already has:

| `k` | Payload | Effect |
| --- | --- | --- |
| `claim` | `cell` | build on an adjacent cell; places the king on the first one |
| `move` | `cell` | step the king onto own adjacent land |
| `unclaim` | `cell` | demolish an own cell (not the king's square) |
| `resign` | — | mark the seat resigned (no room end yet) |

Everything later — units, build queues, technologies — is a **new `k`** with a new payload. Old
clients never send it, new clients do, and the version gate below keeps a mixed pair apart. No
transport change, no message-shape change: this is why the piece list is not a blocker.

---

## 2. Transport

One WebSocket per player: `GET /api/room/<code>` with `Upgrade: websocket`. Same origin as the
page. The Durable Object for the room is addressed by the code.

- Max message: 2 KB. Larger → close `1009`.
- Text frames, JSON, one message per frame. No binary.
- `Origin` must match the deployed host (or `localhost` in dev); otherwise `403` before the upgrade.
- No cookies, no accounts. Identity is a device secret (§4).

## 3. Messages

All messages are JSON objects with a `t` field. Times are ms since epoch, server clock.

### Client → server

```jsonc
{ "t": "hello", "proto": 1, "secret": "<hex 32 bytes>", "nick": "…" }
{ "t": "cmd",   "id": 17, "cmd": { "k": "claim", "cell": 231 } }
{ "t": "ping",  "at": 1730000000000 }
```

`cmd` carries **no slot**: the server decides the slot from the seat the connection owns. A client
cannot act for the other side, and cannot name its own wallet.

### Server → client

```jsonc
{ "t": "welcome", "proto": 1, "seat": 0, "rev": 42, "state": { … }, "serverTime": 1730000000000 }
{ "t": "state",   "rev": 43, "state": { … }, "events": [ … ], "ack": 17 }
{ "t": "reject",  "id": 17, "code": "taken", "rev": 43 }
{ "t": "error",   "code": "refresh" | "room_full" | "room_gone" | "rate_limited" }
{ "t": "pong",    "at": 1730000000000, "serverTime": 1730000000000 }
```

- `state` is the whole `GameState` (save format v2), not a delta. It is at most ~800 small objects;
  sending all of it avoids a second, divergent merge path and makes reconnect identical to update.
- `rev` is monotonic per room. A client that sees a gap must not guess: it reconnects and takes a
  fresh `welcome`.
- `ack` echoes the `id` of the command that produced this state, so the client can match its own
  optimistic UI to a confirmation.
- `reject.code` is the engine's own `ErrorCode` (`taken`, `no_coins`, `not_adjacent`, …), so the
  client has one vocabulary for failures whether it is playing alone or online.

## 4. Identity and seats

- A device secret is 32 random bytes (`crypto.getRandomValues`), kept in `localStorage` and mirrored
  in a cookie (the mirror survives a storage clear).
- The server stores only `SHA-256(secret)` → seat. It never sees the raw secret after the first
  connection.
- **Two seats, two secrets.** The invite link carries the room code and nothing else. The first two
  distinct secrets to connect take seats 0 and 1; a third gets `room_full`. A returning secret gets
  its seat back; its old socket is closed with `bye` (`1000`) so a stale tab cannot hold a seat.
- Reconnect: send `hello` again. The reply is a full `welcome`, so restoration is the same code path
  as joining.

## 5. What the server computes, and what it never takes from a client

| Server decides | Client may only ask |
| --- | --- |
| who owns which cell | "build on cell 231" |
| every coin balance and income | nothing — `coins` is never read from a message |
| where each king is | "step to cell 187" |
| hurricane seed, path, timing, damage | nothing |
| rate limits, seat assignment, room membership | nothing |
| the clock used for income days and hurricanes | its local clock, for display only |

The client sends intent; the server runs `reduce(state, cmd, ctx)` from `@eurasia/shared` and
answers with the resulting state. The same reducer that single-player uses, which is why a rule
change cannot mean two different games.

Clock sync: the client keeps `serverTime - localTime` from `ping`/`pong` (a 10 s interval) and
renders hurricanes against it. Drift below ~150 ms is invisible; above that the funnel and the
damage disagree, so the client re-syncs on every state message.

## 6. Conflicts

Two players claim the same free cell "at the same instant":

1. Commands arrive in some order — there is no tie, only an order.
2. The first one the reducer applies wins the cell.
3. The second gets `reject: taken` with the current `rev` and sees the cell already owned.

The same rule covers the two kings stepping onto the same free cell, because building is how a king
advances. No lock, no negotiation, no client-side arbitration.

## 7. Persistence and versioning

- Room state lives in the Durable Object's SQLite storage: one row with `schema_version` and the
  JSON `GameState`. SQLite, not KV: a room is small and needs atomic read-modify-write.
- `schema_version` migrates forward only, at construction, before the first request is served.
  A room whose schema is newer than the code refuses to serve and returns `room_gone` rather than
  corrupting a match — the same rule the local save already follows.
- `GameState.v` (save format, currently 2) is separate from `PROTOCOL_VERSION` (1) and from
  `schema_version` (1). They change for different reasons and must not be conflated.
- Protocol gate: `hello.proto < PROTOCOL_MIN` → `error: refresh` and close. A client that is too old
  is told to reload, never served a state it would misread.

## 8. Idle, hurricanes and alarms

- Hurricanes run only while at least one player is connected. Five minutes with no connections
  resets the schedule (per the brief), so a returning player does not walk into a hurricane that
  started without them.
- The server issues a deterministic plan per hurricane (seed, side, start time, control points) and
  stores it; damage is resolved once, from a storage alarm at the plan's end. Clients animate against
  the synced clock. No tick loop, which is what keeps the free tier viable.
- Budget: a claim costs ~3 Durable Object requests (read, apply, confirm). At 100k requests/day that
  is ~33k actions/day per project — roughly thirty times a real session.

## 9. What this contract deliberately does not decide

- Win condition, scoring beyond "cells owned", and the shape of a result row.
- Any piece beyond the king, their costs, abilities or tech tree.
- Fog of war.
- Spectators.

All of them are additive: a new command `k`, a new field, a new state. None requires a new message
type or a new transport.

## 10. How it will be verified

- Engine rules: already covered by the shared reducer tests (171 at the time of writing).
- Room, with two real WebSocket clients against a real Durable Object (`vitest-pool-workers`):
  - both seats taken in order; a third connection is refused;
  - a simultaneous claim of one cell → exactly one `state`, one `reject: taken`;
  - reconnect with the same secret restores the same seat and the same cells;
  - a client with `proto: 0` is told to refresh;
  - a burst above the hard cap closes the socket;
  - a command that the rules reject leaves `rev` advancing but the state unchanged.
- The same tests run against `wrangler dev` locally, so a two-tab game can be played on `localhost`
  before anything is deployed.
