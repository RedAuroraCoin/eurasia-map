import { PROTOCOL_VERSION, PROTOCOL_MIN } from '@eurasia/shared';
import {
  BALANCE,
  type GameState,
  type Command,
  type GameEvent,
  createInitialState,
  reduce,
  stormCells,
  planStorm,
  nextStormGap,
  hash01,
  getMap,
  type StormPlan,
  type MapSize,
} from '@eurasia/shared';

/**
 * The authoritative two-player room.
 *
 * One Durable Object per room code. State lives in SQLite storage and is
 * mutated only by this class, so every command is applied in the exact
 * order it is received.
 */
export const SCHEMA_VERSION = 2;

const MAX_MESSAGE_SIZE = 2048;
const RATE_LIMIT_WINDOW_MS = 2000;
const RATE_LIMIT_BURST = 8;
const HARD_CAP_MS = 10_000;
const HARD_CAP = 200;
const IDLE_ROOM_MS = 30 * 60 * 1000; // 30 min
const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type SecretHash = string;

interface StoredState {
  schema: number;
  /** Board size; the terrains differ per size, so the room must remember it. */
  size: MapSize;
  gameState: GameState;
  /** Seat 0 secret hash → seat 1 secret hash. Missing = empty. */
  seats: [SecretHash | null, SecretHash | null];
  /** Connection id (from WebSocket) → seat (0 or 1). -1 = not yet assigned. */
  connections: Record<string, -1 | 0 | 1>;
  /** Per-connection rate limit bucket. */
  buckets: Record<string, { count: number; windowStart: number }>;
  /** Per-connection hard cap bucket. */
  hardBuckets: Record<string, { count: number; windowStart: number }>;
  /** Revision number, monotonically increasing per state change. */
  rev: number;
  /** Storm plans currently alive, keyed by plan id (string from Object.entries). */
  storms: Record<string, StormPlan>;
  /** Next storm spawn timestamp (server clock). */
  nextStormAt: number;
  /** Monotonic storm id counter. */
  stormCounter: number;
  /** last active connection timestamp, for idle detection. */
  lastActive: number;
}

export class Room {
  /**
   * Live sockets, keyed by our own connection id.
   *
   * `state.getWebSockets()` returns fresh wrapper objects in workerd, so a
   * property attached to the accepted socket is gone by the time a later
   * request looks it up. This map is the only reliable handle.
   */
  private readonly sockets = new Map<string, WebSocket>();

  constructor(private readonly state: DurableObjectState) {
    this.state.blockConcurrencyWhile(async () => {
      const stored = (await this.state.storage.get<StoredState>('room')) ?? null;
      if (!stored) {
        await this.initRoom();
      } else if (stored.schema < SCHEMA_VERSION) {
        await this.migrate(stored);
      }
      await this.scheduleAlarms();
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get('upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    if (url.pathname.endsWith('/ping')) {
      const stored = await this.getStored();
      return Response.json({
        ok: true,
        protocol: PROTOCOL_VERSION,
        schema: SCHEMA_VERSION,
        rev: stored.rev,
        now: Date.now(),
      });
    }

    return new Response('not found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const proto = Number(url.searchParams.get('proto') ?? '0');
    if (proto < PROTOCOL_MIN) {
      return new Response(JSON.stringify({ t: 'error', code: 'refresh' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }

    const origin = request.headers.get('origin');
    if (!this.isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ t: 'error', code: 'forbidden' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    const connectionId = crypto.randomUUID();
    server.accept();
    this.sockets.set(connectionId, server);
    server.addEventListener('message', (event) => this.onMessage(connectionId, event.data));
    server.addEventListener('close', () => this.onClose(connectionId));
    server.addEventListener('error', () => this.onClose(connectionId));

    const stored = await this.getStored();
    stored.connections[connectionId] = -1;
    stored.buckets[connectionId] = { count: 0, windowStart: Date.now() };
    stored.hardBuckets[connectionId] = { count: 0, windowStart: Date.now() };
    await this.putStored(stored);

    return new Response(null, { status: 101, webSocket: client });
  }

  private isAllowedOrigin(origin: string | null): boolean {
    if (!origin) return false;
    try {
      const url = new URL(origin);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
      // In production, the Worker hostname is not directly accessible from DO storage
      // Allow any origin for now; tighten with a configured allowlist if needed
      return true;
    } catch {
      return false;
    }
  }

  private async checkRateLimit(connectionId: string): Promise<boolean> {
    const stored = await this.getStored();
    const now = Date.now();

    const burst = stored.buckets[connectionId];
    if (burst) {
      if (now - burst.windowStart > RATE_LIMIT_WINDOW_MS) {
        burst.count = 0;
        burst.windowStart = now;
      }
      if (burst.count >= RATE_LIMIT_BURST) return false;
      burst.count++;
    }

    const hard = stored.hardBuckets[connectionId];
    if (hard) {
      if (now - hard.windowStart > HARD_CAP_MS) {
        hard.count = 0;
        hard.windowStart = now;
      }
      if (hard.count >= HARD_CAP) return false;
      hard.count++;
    }

    await this.putStored(stored);
    return true;
  }

  private async onMessage(connectionId: string, data: unknown): Promise<void> {
    // The check is async: forgetting the await made the limit a no-op.
    if (!(await this.checkRateLimit(connectionId))) {
      this.send(connectionId, { t: 'error', code: 'rate_limited' });
      return;
    }

    if (typeof data !== 'string') return;
    if (data.length > MAX_MESSAGE_SIZE) {
      this.send(connectionId, { t: 'error', code: 'message_too_large' });
      return;
    }

    let msg: { t: string; [key: string]: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    const stored = await this.getStored();
    const seat = stored.connections[connectionId];

    switch (msg.t) {
      case 'hello':
        await this.handleHello(connectionId, msg);
        break;
      case 'cmd':
        if (seat === 0 || seat === 1) {
          await this.handleCommand(seat, connectionId, msg);
        }
        break;
      case 'ping':
        this.send(connectionId, {
          t: 'pong',
          at: msg.at,
          serverTime: Date.now(),
        });
        break;
      default:
        break;
    }
  }

  private async handleHello(
    connectionId: string,
    msg: { t: string; proto?: number; secret?: string },
  ): Promise<void> {
    const { proto = 0, secret } = msg;

    if (proto < PROTOCOL_MIN) {
      this.send(connectionId, { t: 'error', code: 'refresh' });
      this.close(connectionId, 1000);
      return;
    }

    if (!secret || typeof secret !== 'string' || secret.length !== 64) {
      this.send(connectionId, { t: 'error', code: 'bad_secret' });
      return;
    }

    const secretHash = await this.hashSecret(secret);
    const stored = await this.getStored();

    let seat: 0 | 1 | null = null;
    if (stored.seats[0] === secretHash) seat = 0;
    else if (stored.seats[1] === secretHash) seat = 1;

    if (seat === null) {
      if (stored.seats[0] === null) seat = 0;
      else if (stored.seats[1] === null) seat = 1;
    }

    if (seat === null) {
      this.send(connectionId, { t: 'error', code: 'room_full' });
      return;
    }

    stored.seats[seat] = secretHash;
    stored.connections[connectionId] = seat;

    for (const [cid, s] of Object.entries(stored.connections) as [string, -1 | 0 | 1][]) {
      if (cid !== connectionId && s === seat) {
        this.sockets.get(cid)?.close(1000, 'replaced');
        this.sockets.delete(cid);
        delete stored.connections[cid];
      }
    }

    stored.lastActive = Date.now();
    await this.putStored(stored);

    this.send(connectionId, {
      t: 'welcome',
      proto: PROTOCOL_VERSION,
      seat,
      rev: stored.rev,
      state: stored.gameState,
      serverTime: Date.now(),
    });

    if (stored.seats[0] && stored.seats[1] && stored.nextStormAt === 0) {
      stored.nextStormAt = Date.now() + BALANCE.hurricane.firstDelayMs;
      await this.putStored(stored);
      await this.scheduleAlarms();
    }
  }

  private async handleCommand(
    seat: 0 | 1,
    connectionId: string,
    msg: { t: string; id?: number; cmd?: Command },
  ): Promise<void> {
    const { id = 0, cmd } = msg;

    if (!cmd || typeof cmd !== 'object' || !cmd.k) {
      this.send(connectionId, { t: 'reject', id, code: 'unknown_command', rev: 0 });
      return;
    }

    if ('slot' in cmd) {
      delete (cmd as any).slot;
    }
    const fullCmd = { ...cmd, slot: seat } as Command;

    const stored = await this.getStored();
    const ctx = this.makeContext(stored.size);
    const result = reduce(stored.gameState, fullCmd, ctx);

    if (!result.ok) {
      this.send(connectionId, {
        t: 'reject',
        id,
        code: result.code,
        rev: stored.rev,
      });
      return;
    }

    stored.gameState = result.state;
    stored.rev++;

    if (result.events.length > 0) {
      await this.maybeProcessStormEvents(stored, result.events);
    }

    await this.putStored(stored);

    for (const [cid, s] of Object.entries(stored.connections) as [string, -1 | 0 | 1][]) {
      if (s === 0 || s === 1) {
        this.send(cid, {
          t: 'state',
          rev: stored.rev,
          state: stored.gameState,
          events: result.events,
          ack: id,
        });
      }
    }

    stored.lastActive = Date.now();
    await this.putStored(stored);
  }

  private async maybeProcessStormEvents(
    stored: StoredState,
    events: readonly GameEvent[],
  ): Promise<void> {
    let changed = false;

    for (const event of events) {
      if (event.t === 'storm' && event.hits > 0) {
        changed = true;
      }
    }

    if (stored.seats[0] && stored.seats[1]) {
      const now = Date.now();
      if (stored.nextStormAt === 0) stored.nextStormAt = now + BALANCE.hurricane.firstDelayMs;
      if (
        now >= stored.nextStormAt &&
        Object.keys(stored.storms).length < BALANCE.hurricane.maxActive
      ) {
        const numericSeed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
        const life =
          BALANCE.hurricane.lifeMinMs +
          Math.floor(
            hash01(numericSeed) * (BALANCE.hurricane.lifeMaxMs - BALANCE.hurricane.lifeMinMs),
          );
        const map = getMap(stored.size);
        const plan = planStorm({
          seed: numericSeed,
          id: ++stored.stormCounter,
          startAt: now,
          durationMs: life,
          rows: map.rows,
          cols: map.cols,
        });
        stored.storms[plan.id] = plan;
        stored.nextStormAt = now + nextStormGap(numericSeed);
        changed = true;
      }
    }

    const now = Date.now();
    for (const [id, plan] of Object.entries(stored.storms) as [string, StormPlan][]) {
      if (plan.damageAt <= now && now < plan.endsAt) {
        // Resolve damage
        const map = getMap(stored.size);
        const cells = stormCells(plan, map);
        const ctx = this.makeContext(stored.size);
        const result = reduce(stored.gameState, { k: 'damage', cells }, ctx);
        if (result.ok) {
          stored.gameState = result.state;
          stored.rev++;
          // Broadcast the damage to all connected clients
          for (const [cid, _s] of Object.entries(stored.connections) as [string, -1 | 0 | 1][]) {
            const conn = stored.connections[cid as string];
            if (conn === 0 || conn === 1) {
              this.send(cid, {
                rev: stored.rev,
                state: stored.gameState,
                events: result.events,
                ack: 0,
              });
            }
          }
        }
        delete stored.storms[id];
        changed = true;
      }
      if (plan.endsAt <= now) {
        delete stored.storms[id];
        changed = true;
      }
    }

    if (changed) {
      await this.putStored(stored);
      await this.scheduleAlarms();
    }
  }

  async alarm(): Promise<void> {
    const stored = await this.getStored();
    const now = Date.now();
    let changed = false;

    for (const [id, plan] of Object.entries(stored.storms) as [string, StormPlan][]) {
      if (plan.damageAt <= now && now < plan.endsAt) {
        const map = getMap(stored.size);
        const cells = stormCells(plan, map);
        const ctx = this.makeContext(stored.size);
        const result = reduce(stored.gameState, { k: 'damage', cells }, ctx);
        if (result.ok) {
          stored.gameState = result.state;
          stored.rev++;
          for (const [cid, _s] of Object.entries(stored.connections) as [string, -1 | 0 | 1][]) {
            const conn = stored.connections[cid as string];
            if (conn === 0 || conn === 1) {
              this.send(cid, {
                rev: stored.rev,
                state: stored.gameState,
                events: result.events,
                ack: 0,
              });
            }
          }
        }
        delete stored.storms[id];
        changed = true;
      }
      if (plan.endsAt <= now) {
        delete stored.storms[id];
        changed = true;
      }
    }

    if (now - stored.lastActive > ROOM_TTL_MS) {
      await this.state.storage.deleteAll();
      return;
    }
    if (now - stored.lastActive > IDLE_ROOM_MS) {
      // dormant: keep state, stop scheduling new storms
    }

    if (changed) {
      await this.putStored(stored);
      await this.scheduleAlarms();
    }
  }

  private async initRoom(): Promise<void> {
    const initialState = createInitialState(
      crypto.getRandomValues(new Uint32Array(1))[0] as number,
      Date.now(),
    );
    const room: StoredState = {
      schema: SCHEMA_VERSION,
      size: 500,
      gameState: initialState,
      seats: [null, null],
      connections: {},
      buckets: {},
      hardBuckets: {},
      rev: 0,
      storms: {},
      nextStormAt: 0,
      stormCounter: 0,
      lastActive: Date.now(),
    };
    await this.putStored(room);
    await this.scheduleAlarms();
  }

  private async migrate(stored: StoredState): Promise<void> {
    if (stored.schema < 2) {
      stored.schema = 2;
    }
    // Rooms created before the terrain fix stored no size; 500 is the default.
    if (!stored.size) stored.size = 500;
    await this.putStored(stored);
  }

  private makeContext(size: MapSize) {
    const map = getMap(size);
    return {
      nowMs: Date.now(),
      isLand: (cell: number) => cell >= 0 && cell < map.mask.length && map.mask[cell] === '#',
      cellCount: map.rows * map.cols,
      cols: map.cols,
    };
  }

  private async getStored(): Promise<StoredState> {
    return (
      (await this.state.storage.get<StoredState>('room')) ??
      (await this.initRoom(), this.getStored())
    );
  }

  private async putStored(stored: StoredState): Promise<void> {
    await this.state.storage.put('room', stored);
  }

  private async scheduleAlarms(): Promise<void> {
    const stored = await this.getStored();
    const now = Date.now();
    let next = Infinity;

    for (const plan of Object.values(stored.storms)) {
      if (plan.damageAt > now) next = Math.min(next, plan.damageAt);
      if (plan.endsAt > now) next = Math.min(next, plan.endsAt);
    }
    if (stored.nextStormAt > now) next = Math.min(next, stored.nextStormAt);

    if (next !== Infinity) {
      await this.state.storage.setAlarm(next);
    }
  }

  private send(connectionId: string, message: unknown): void {
    const ws = this.sockets.get(connectionId);
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
  }

  private close(connectionId: string, code: number, reason?: string): void {
    const websockets = this.state.getWebSockets();
    const ws = websockets.find((w) => (w as any).connectionId === connectionId);
    if (ws) ws.close(code, reason);
  }

  private onClose(connectionId: string): void {
    this.sockets.delete(connectionId);
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.getStored();
      const seat = stored.connections[connectionId];
      if (seat === 0 || seat === 1) {
        const websockets = this.state.getWebSockets();
        const ws = websockets.find((w) => (w as any).connectionId === connectionId);
        if (ws) ws.close(1000, 'replaced');
        delete stored.connections[connectionId];
        delete stored.buckets[connectionId];
        delete stored.hardBuckets[connectionId];
        await this.putStored(stored);
      }
    });
  }

  private async hashSecret(secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(secret);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
