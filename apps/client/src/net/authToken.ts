/** The login token is kept per browser. Storage may be unavailable (private mode), so every access is guarded. */
const TOKEN_KEY = 'skillergo.token';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore: the player will simply have to sign in again next time.
  }
}

/**
 * After "Sign in with ..." the server sends the player back with #sg_token=... (or #sg_error=...).
 * Takes it out of the address bar right away and returns what was there.
 */
export function takeLoginResult(): { token: string | null; error: string | null } {
  const hash = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const params = new URLSearchParams(hash);
  const token = params.get('sg_token');
  const error = params.get('sg_error');
  if (token || error) history.replaceState(null, '', `${location.pathname}${location.search}`);
  if (token) saveToken(token);
  return { token, error };
}
