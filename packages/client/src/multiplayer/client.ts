import {
  PROTOCOL_VERSION,
  type GameState,
  type GameEvent,
  type StormPlan,
  type Command,
  isRoomCode,
  generateRoomCode,
} from '@eurasia/shared';
import { browserStorage } from '../state/save';

/**
 * Device secret for identity. 32 random bytes, stored in localStorage + cookie mirror.
 * The server stores only SHA-256(secret); it never sees the raw secret.
 */
const SECRET_KEY = 'eurasia.secret';

/** Generate or load the device secret. */
function getDeviceSecret(): string {
  const storage = browserStorage();
  let secret = storage.getItem(SECRET_KEY);
  if (!secret) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    secret = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    storage.setItem(SECRET_KEY, secret);
    // Mirror in a cookie for cross-tab persistence
    document.cookie = `${SECRET_KEY}=${secret}; Path=/; SameSite=Lax; Max-Age=31536000`;
  }
  return secret;
}

/** Connection state machine. */
export type MultiplayerStatus =
  | 'idle'
  | 'connecting'
  | 'waiting' // connected, waiting for opponent
  | 'playing'
  | 'reconnecting'
  | 'error';

export interface MultiplayerCallbacks {
  onStatusChange: (status: MultiplayerStatus, info?: string) => void;
  onState: (state: GameState, events: readonly GameEvent[], ack: number) => void;
  onReject: (id: number, code: string, rev: number) => void;
  onWelcome: (seat: 0 | 1, rev: number, state: GameState) => void;
  onError: (code: string) => void;
  onStorms: (plans: readonly StormPlan[]) => void;
}

/**
 * Multiplayer client: WebSocket connection, reconnection, protocol handling.
 * All state is authoritative from the server; this client only sends intents.
 */
export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private secret: string;
  private callbacks: MultiplayerCallbacks;
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private pendingCommands = new Map<number, Command>();
  private nextCommandId = 1;
  private seat: 0 | 1 | null = null;
  private roomCode: string;
  private status: MultiplayerStatus = 'idle';

  constructor(roomCode: string, callbacks: MultiplayerCallbacks) {
    this.roomCode = roomCode;
    this.secret = getDeviceSecret();
    this.callbacks = callbacks;
    this.url = `${location.origin}/api/room/${roomCode}?proto=${PROTOCOL_VERSION}`;
  }

  /** Current connection status. */
  getStatus(): MultiplayerStatus {
    return this.status;
  }

  /** The local player's seat (0 or 1), null until welcome. */
  getSeat(): 0 | 1 | null {
    return this.seat;
  }

  /** The room code. */
  getRoomCode(): string {
    return this.roomCode;
  }

  /** Connect to the room. */
  connect(): void {
    if (this.ws) return;
    this.setStatus('connecting');
    this.openSocket();
  }

  /** Disconnect cleanly. */
  disconnect(): void {
    this.clearReconnectTimer();
    if (this.ws) {
      this.ws.close(1000, 'user disconnect');
      this.ws = null;
    }
    this.setStatus('idle');
  }

  /** Send a command to the server. */
  sendCommand(cmd: Command): number {
    const id = this.nextCommandId++;
    this.pendingCommands.set(id, cmd);
    this.send({ t: 'cmd', id, cmd });
    return id;
  }

  /** Claim a cell. */
  claim(cell: number): number {
    return this.sendCommand({ k: 'claim', cell, slot: this.seat ?? 0 });
  }

  /** Unclaim a cell. */
  unclaim(cell: number): number {
    return this.sendCommand({ k: 'unclaim', cell, slot: this.seat ?? 0 });
  }

  /** Move the king. */
  move(cell: number): number {
    return this.sendCommand({ k: 'move', cell, slot: this.seat ?? 0 });
  }

  /** Resign. */
  resign(): number {
    return this.sendCommand({ k: 'resign' } as unknown as Command);
  }

  /** Keep-alive ping. */
  ping(): void {
    this.send({ t: 'ping', at: Date.now() });
  }

  private openSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = 'arraybuffer';
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (event) => this.onMessage(event.data);
      this.ws.onclose = (event) => this.onClose(event);
      this.ws.onerror = () => {
        // onclose will fire after error
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private onOpen(): void {
    this.reconnectAttempts = 0;
    this.send({ t: 'hello', proto: PROTOCOL_VERSION, secret: this.secret });
  }

  private onMessage(data: ArrayBuffer | string): void {
    if (typeof data !== 'string') return;
    let msg: { t: string; [key: string]: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    switch (msg.t) {
      case 'welcome':
        this.onWelcome(
          msg as unknown as { seat: 0 | 1; rev: number; state: GameState; serverTime: number },
        );
        break;
      case 'state':
        this.onState(
          msg as unknown as {
            rev: number;
            state: GameState;
            events: readonly GameEvent[];
            ack: number;
          },
        );
        break;
      case 'reject':
        this.onReject(msg as unknown as { id: number; code: string; rev: number });
        break;
      case 'error':
        this.onError(msg as unknown as { code: string });
        break;
      case 'pong':
        // Server time sync handled by callback if needed
        break;
      default:
        break;
    }
  }

  private onWelcome(msg: { seat: 0 | 1; rev: number; state: GameState; serverTime: number }): void {
    this.seat = msg.seat;
    this.setStatus('playing');
    this.callbacks.onWelcome(msg.seat, msg.rev, msg.state);
  }

  private onState(msg: {
    rev: number;
    state: GameState;
    events: readonly GameEvent[];
    ack: number;
  }): void {
    // Remove acknowledged command from pending
    if (msg.ack > 0) this.pendingCommands.delete(msg.ack);
    this.callbacks.onState(msg.state, msg.events, msg.ack);
  }

  private onReject(msg: { id: number; code: string; rev: number }): void {
    this.pendingCommands.delete(msg.id);
    this.callbacks.onReject(msg.id, msg.code, msg.rev);
  }

  private onError(msg: { code: string }): void {
    this.callbacks.onError(msg.code);
    switch (msg.code) {
      case 'refresh':
      case 'forbidden':
      case 'bad_secret':
      case 'room_full':
      case 'room_gone':
        this.disconnect();
        break;
      case 'rate_limited':
        // transient, will recover
        break;
      default:
        break;
    }
  }

  private onClose(_event: CloseEvent): void {
    this.ws = null;
    if (this.status === 'playing' || this.status === 'waiting') {
      this.setStatus('reconnecting');
      this.scheduleReconnect();
    } else if (this.status === 'connecting') {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000) + Math.random() * 500;
    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.status === 'reconnecting' || this.status === 'connecting') {
        this.openSocket();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: MultiplayerStatus, info?: string): void {
    this.status = status;
    this.callbacks.onStatusChange(status, info);
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
}

/** Create a room code and the invite URL. */
export function createInvite(roomCode?: string): { code: string; url: string } {
  const code =
    roomCode ??
    generateRoomCode((bytes: Uint8Array<ArrayBufferLike>) =>
      crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>),
    );
  const url = `${location.origin}${location.pathname}?room=${code}`;
  return { code, url };
}

/** Parse room code from URL. Returns null if not in a room. */
export function parseRoomFromUrl(): string | null {
  const params = new URLSearchParams(location.search);
  const code = params.get('room');
  return code && isRoomCode(code) ? code : null;
}
