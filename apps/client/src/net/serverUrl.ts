/**
 * Where the online game server lives.
 * - VITE_GAME_SERVER_URL (Vercel env variable or apps/client/.env.local) wins;
 * - `npm run dev` talks to a local server on port 8080 of the same host (works from a phone on LAN too);
 * - otherwise the production server below.
 */
const PRODUCTION_SERVER = 'https://skillergo-server.fly.dev';

export function gameServerUrl(): string {
  const fromEnv = import.meta.env.VITE_GAME_SERVER_URL;
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  if (import.meta.env.DEV) return `${location.protocol}//${location.hostname}:8080`;
  return PRODUCTION_SERVER;
}

export function gameSocketUrl(): string {
  return `${gameServerUrl().replace(/^http/, 'ws')}/ws`;
}

/** Full-page redirect target for "Sign in with ..."; the server sends the player back to this page. */
export function loginUrl(provider: string): string {
  const back = `${location.origin}${location.pathname}`;
  return `${gameServerUrl()}/auth/${provider}?${new URLSearchParams({ return: back })}`;
}
