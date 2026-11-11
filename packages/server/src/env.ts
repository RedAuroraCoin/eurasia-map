/** Bindings declared in wrangler.jsonc. Kept in one place so the Worker entry stays readable. */
export interface Env {
  /** The built client, uploaded together with the Worker. */
  ASSETS: Fetcher;
  /** One Durable Object instance per room code. */
  ROOM: DurableObjectNamespace;
}
