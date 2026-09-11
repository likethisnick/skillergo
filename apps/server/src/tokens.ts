import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Small signed tokens: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Used for login sessions and for the OAuth `state` parameter. They cannot be forged
 * without the secret, and every payload carries an expiry time.
 */
export function signToken(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmac(body, secret)}`;
}

/** Returns the payload, or null when the token is malformed, tampered with or expired. */
export function verifyToken<T extends { exp: number }>(token: unknown, secret: string): T | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(hmac(body, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function hmac(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

export interface SessionPayload {
  uid: string;
  exp: number;
}

const SESSION_DAYS = 60;

export function issueSession(uid: string, secret: string): string {
  return signToken({ uid, exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000 }, secret);
}
