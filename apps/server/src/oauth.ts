import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sanitizeName, type AuthProvider } from '@skillergo/shared';
import { isAllowedOrigin, type OAuthApp, type ServerEnv } from './env';
import type { UserStore } from './store';
import { issueSession, signToken, verifyToken } from './tokens';

/**
 * "Sign in with GitHub / Google" (OAuth 2.0 authorization code flow).
 *
 * 1. The game page opens  GET /auth/<provider>?return=<page url>
 * 2. We redirect to the provider with a signed `state` (+ a nonce cookie against CSRF).
 * 3. The provider redirects back to  GET /auth/<provider>/callback?code&state
 * 4. We swap the code for the profile, create/find the user and redirect to
 *    <page url>#sg_token=<session token>. The page keeps the token and uses it on the WebSocket.
 */

interface StatePayload {
  p: AuthProvider;
  r: string;
  n: string;
  exp: number;
}

interface Profile {
  id: string;
  name: string;
  avatar: string | null;
}

const NONCE_COOKIE = 'sg_oauth';
const STATE_MINUTES = 10;

export function enabledProviders(env: ServerEnv): AuthProvider[] {
  const list: AuthProvider[] = [];
  if (env.github) list.push('github');
  if (env.google) list.push('google');
  return list;
}

/** Handles /auth/* requests. Returns false when the path is not an auth route. */
export async function handleAuthRequest(
  env: ServerEnv, store: UserStore, req: IncomingMessage, res: ServerResponse, url: URL,
): Promise<boolean> {
  const match = /^\/auth\/(github|google)(\/callback)?$/.exec(url.pathname);
  if (!match) return false;
  const provider = match[1] as AuthProvider;
  const app = env[provider];
  if (!app) {
    sendText(res, 404, `${provider} login is not configured on this server`);
    return true;
  }
  if (match[2]) await finishLogin(env, store, provider, app, req, res, url);
  else startLogin(env, provider, app, res, url);
  return true;
}

function startLogin(env: ServerEnv, provider: AuthProvider, app: OAuthApp, res: ServerResponse, url: URL): void {
  const returnTo = url.searchParams.get('return') ?? '';
  if (!isSafeReturn(env, returnTo)) {
    sendText(res, 400, 'This page is not allowed to log in here (check CLIENT_ORIGINS).');
    return;
  }
  const nonce = randomBytes(16).toString('base64url');
  const state = signToken({ p: provider, r: returnTo, n: nonce, exp: Date.now() + STATE_MINUTES * 60_000 }, env.sessionSecret);
  const redirectUri = callbackUrl(env, provider);
  const target = provider === 'github'
    ? `https://github.com/login/oauth/authorize?${new URLSearchParams({
      client_id: app.clientId, redirect_uri: redirectUri, state, scope: '', allow_signup: 'true',
    })}`
    : `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
      client_id: app.clientId, redirect_uri: redirectUri, state, response_type: 'code', scope: 'openid profile', prompt: 'select_account',
    })}`;
  const secure = env.publicUrl.startsWith('https:') ? '; Secure' : '';
  res.writeHead(302, {
    Location: target,
    'Set-Cookie': `${NONCE_COOKIE}=${nonce}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${STATE_MINUTES * 60}${secure}`,
    'Cache-Control': 'no-store',
  });
  res.end();
}

async function finishLogin(
  env: ServerEnv, store: UserStore, provider: AuthProvider, app: OAuthApp,
  req: IncomingMessage, res: ServerResponse, url: URL,
): Promise<void> {
  const state = verifyToken<StatePayload>(url.searchParams.get('state'), env.sessionSecret);
  if (!state || state.p !== provider || !isSafeReturn(env, state.r)) {
    sendText(res, 400, 'Login link expired or invalid. Go back to the game and try again.');
    return;
  }
  const back = (hash: string): void => {
    res.writeHead(302, {
      Location: `${state.r.split('#')[0]}#${hash}`,
      'Set-Cookie': `${NONCE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0`,
      'Cache-Control': 'no-store',
    });
    res.end();
  };
  if (readCookie(req, NONCE_COOKIE) !== state.n) {
    back('sg_error=state');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    // The player pressed "Cancel" on the provider page.
    back('sg_error=cancelled');
    return;
  }
  try {
    const profile = provider === 'github'
      ? await githubProfile(env, app, code)
      : await googleProfile(env, app, code);
    const user = store.upsert(`${provider}:${profile.id}`, provider, profile.name, profile.avatar);
    console.log(`[auth] ${user.id} (${user.name}) signed in`);
    back(`sg_token=${encodeURIComponent(issueSession(user.id, env.sessionSecret))}`);
  } catch (err) {
    console.error(`[auth] ${provider} login failed`, err);
    back('sg_error=provider');
  }
}

async function githubProfile(env: ServerEnv, app: OAuthApp, code: string): Promise<Profile> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: callbackUrl(env, 'github'),
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!token.access_token) throw new Error(`github token: ${token.error ?? tokenRes.status}`);
  const userRes = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'skillergo-server' },
  });
  if (!userRes.ok) throw new Error(`github user: ${userRes.status}`);
  const u = (await userRes.json()) as { id: number; login: string; name?: string | null; avatar_url?: string };
  return {
    id: String(u.id),
    name: sanitizeName(u.name) ?? sanitizeName(u.login) ?? `Player ${u.id}`,
    avatar: u.avatar_url ?? null,
  };
}

async function googleProfile(env: ServerEnv, app: OAuthApp, code: string): Promise<Profile> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: app.clientId, client_secret: app.clientSecret, code,
      grant_type: 'authorization_code', redirect_uri: callbackUrl(env, 'google'),
    }),
  });
  const token = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!token.access_token) throw new Error(`google token: ${token.error ?? tokenRes.status}`);
  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userRes.ok) throw new Error(`google userinfo: ${userRes.status}`);
  const u = (await userRes.json()) as { sub: string; name?: string; given_name?: string; picture?: string };
  return {
    id: u.sub,
    name: sanitizeName(u.name) ?? sanitizeName(u.given_name) ?? 'Player',
    avatar: u.picture ?? null,
  };
}

function callbackUrl(env: ServerEnv, provider: AuthProvider): string {
  return `${env.publicUrl}/auth/${provider}/callback`;
}

/** The token goes back only to game pages we trust, never to an arbitrary URL. */
function isSafeReturn(env: ServerEnv, returnTo: string): boolean {
  try {
    const u = new URL(returnTo);
    return (u.protocol === 'https:' || u.protocol === 'http:') && isAllowedOrigin(env, u.origin);
  } catch {
    return false;
  }
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(text);
}
