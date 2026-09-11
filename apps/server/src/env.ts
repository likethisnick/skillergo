import { randomBytes } from 'node:crypto';
import path from 'node:path';

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

/** Server settings, all from environment variables (Fly secrets / fly.toml [env]). */
export interface ServerEnv {
  production: boolean;
  port: number;
  /** Public base URL of this server, used for OAuth callbacks (https://<app>.fly.dev). */
  publicUrl: string;
  /** Pages allowed to connect and to receive login tokens. `*` matches any characters. */
  clientOrigins: string[];
  /** Folder for users.json (a Fly volume in production). */
  dataDir: string;
  /** Signs session tokens and OAuth state. Changing it logs everybody out. */
  sessionSecret: string;
  github: OAuthApp | null;
  google: OAuthApp | null;
  /** "Play as guest" without an account. On by default only outside production. */
  allowGuest: boolean;
}

export function loadEnv(): ServerEnv {
  const e = process.env;
  const production = e.NODE_ENV === 'production';
  const port = Number(e.PORT) || 8080;

  let sessionSecret = e.SESSION_SECRET ?? '';
  if (!sessionSecret) {
    if (production) throw new Error('SESSION_SECRET is not set (fly secrets set SESSION_SECRET=...)');
    sessionSecret = randomBytes(32).toString('hex');
    console.warn('[env] SESSION_SECRET is not set: using a random one, logins reset on restart.');
  }

  const app = (id: string | undefined, secret: string | undefined): OAuthApp | null =>
    id && secret ? { clientId: id, clientSecret: secret } : null;

  // Locally any page may connect (e.g. the Vite dev server opened from a phone on the LAN).
  const origins = (e.CLIENT_ORIGINS ?? (production ? '' : '*'))
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  return {
    production,
    port,
    publicUrl: (e.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    clientOrigins: origins,
    dataDir: path.resolve(e.DATA_DIR ?? 'data'),
    sessionSecret,
    github: app(e.GITHUB_CLIENT_ID, e.GITHUB_CLIENT_SECRET),
    google: app(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET),
    allowGuest: e.ALLOW_GUEST ? e.ALLOW_GUEST === '1' || e.ALLOW_GUEST === 'true' : !production,
  };
}

/** True when `origin` (scheme://host[:port]) matches one of the allowed patterns. */
export function isAllowedOrigin(env: ServerEnv, origin: string | undefined): boolean {
  if (!origin) return false;
  const clean = origin.replace(/\/+$/, '');
  return env.clientOrigins.some((pattern) => {
    if (pattern === '*') return true;
    const regex = new RegExp(`^${pattern.split('*').map(escapeRegex).join('[^/]*')}$`);
    return regex.test(clean);
  });
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
