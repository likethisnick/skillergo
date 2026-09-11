import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { DEFAULT_SERVER_CONFIG, buildFingerprint } from '@skillergo/shared';
import { isAllowedOrigin, loadEnv } from './env';
import { Lobby } from './lobby';
import { enabledProviders, handleAuthRequest, sendText } from './oauth';
import { UserStore } from './store';

/**
 * Skillergo game server: one Node process with
 *   GET  /health          - health check for the host (Fly.io)
 *   GET  /auth/...        - GitHub / Google login (see oauth.ts)
 *   WS   /ws              - the game itself (see lobby.ts and match.ts)
 */
const env = loadEnv();
const store = new UserStore(env.dataDir, DEFAULT_SERVER_CONFIG.startRating);
const lobby = new Lobby(env, store);

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    sendText(res, 200, 'ok');
    return;
  }
  if (url.pathname === '/') {
    sendText(res, 200, `Skillergo game server · build ${buildFingerprint()} · ${lobby.online} online · ${lobby.runningMatches} matches`);
    return;
  }
  handleAuthRequest(env, store, req, res, url)
    .then((handled) => {
      if (!handled) sendText(res, 404, 'Not found');
    })
    .catch((err: unknown) => {
      console.error('[http] request failed', err);
      if (!res.headersSent) sendText(res, 500, 'Server error');
    });
});

const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 64 * 1024,
  // Snapshots repeat a lot between frames: compression makes them several times smaller.
  perMessageDeflate: { threshold: 512 },
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws' || !isAllowedOrigin(env, req.headers.origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => lobby.accept(ws));
});

server.listen(env.port, () => {
  console.log(`[server] listening on :${env.port} · build ${buildFingerprint()}`);
  console.log(`[server] public url ${env.publicUrl} · clients ${env.clientOrigins.join(', ') || '(none!)'}`);
  console.log(`[server] login: ${enabledProviders(env).join(', ') || 'none'}${env.allowGuest ? ' + guest' : ''} · ${store.size} users`);
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`[server] ${signal}: saving and shutting down`);
  lobby.stop();
  store.flush();
  for (const ws of wss.clients) ws.close(1001, 'server restart');
  server.close();
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
