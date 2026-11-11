import { PROTOCOL_VERSION, isRoomCode } from '@eurasia/shared';
import type { Env } from './env';

export { Room } from './room';

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init?.headers ?? {}) },
  });

/**
 * One Worker serves everything: the static client, the health endpoint and the
 * room API. No CORS headers are needed because the page and the API share an
 * origin — and that is also why the WebSocket upgrade (Stage 4) will verify
 * `Origin` instead of relying on CORS, which does not cover WebSockets.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return json({ ok: true, protocol: PROTOCOL_VERSION, now: new Date().toISOString() });
    }

    const match = /^\/api\/room\/([0-9A-Z]{10})$/.exec(url.pathname);
    if (match) {
      const code = match[1];
      if (code === undefined || !isRoomCode(code)) {
        return json({ ok: false, error: 'bad_code' }, { status: 400 });
      }
      const stub = env.ROOM.get(env.ROOM.idFromName(code));
      return stub.fetch(new Request(new URL('/ping', url), request));
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
