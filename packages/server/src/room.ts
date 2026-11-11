import { PROTOCOL_VERSION } from '@eurasia/shared';

/**
 * Stage 1: a room that can be reached and remembers a counter.
 *
 * The real room (authoritative cells, weather plan, revision numbers) lands in
 * Stage 4; what matters now is that the Durable Object binding, its SQLite
 * storage and the staging deploy path are proven end to end.
 */

export const SCHEMA_VERSION = 1;

export class Room {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/ping')) {
      const schema = (await this.state.storage.get<number>('schema')) ?? 0;
      if (schema < SCHEMA_VERSION) {
        await this.state.storage.put('schema', SCHEMA_VERSION);
      }
      const pings = ((await this.state.storage.get<number>('pings')) ?? 0) + 1;
      await this.state.storage.put('pings', pings);

      return Response.json({
        ok: true,
        protocol: PROTOCOL_VERSION,
        schema: SCHEMA_VERSION,
        pings,
        now: Date.now(),
      });
    }

    return new Response('not found', { status: 404 });
  }
}
