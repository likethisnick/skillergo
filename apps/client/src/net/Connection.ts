import {
  PROTOCOL_VERSION,
  buildFingerprint,
  type AuthProvider,
  type ClientMessage,
  type PublicUser,
  type ServerMessage,
} from '@skillergo/shared';
import { loadToken, saveToken } from './authToken';
import { gameSocketUrl } from './serverUrl';

/**
 * connecting - opening the socket / waiting for "welcome";
 * online     - connected (signed in or not, see `user`);
 * offline    - no connection, retrying (a sleeping Fly machine takes a few seconds to wake up);
 * mismatch   - the server runs another build of the game: reload the page;
 * replaced   - the same account connected from another tab.
 */
export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'mismatch' | 'replaced';

const PING_INTERVAL_MS = 1000;
const MAX_RETRY_MS = 8000;

/**
 * The one WebSocket to the game server. Lives for the whole page (menu and matches),
 * says hello with the login token, measures ping and reconnects on its own.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  user: PublicUser | null = null;
  providers: AuthProvider[] = [];
  guestAllowed = false;
  online = 0;
  /** Smoothed round trip time in milliseconds. */
  ping: number | null = null;
  /** Last error text from the server (shown in the online panel). */
  error: string | null = null;

  private ws: WebSocket | null = null;
  private retryMs = 1000;
  private retryTimer = 0;
  private readonly messageListeners = new Set<(message: ServerMessage) => void>();
  private readonly changeListeners = new Set<() => void>();
  private readonly fingerprint = buildFingerprint();

  constructor() {
    this.open();
    window.setInterval(() => this.sendPing(), PING_INTERVAL_MS);
  }

  get isOnline(): boolean {
    return this.status === 'online';
  }

  /** Subscribes to every server message; returns the unsubscribe function. */
  onMessage(listener: (message: ServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  /** Called whenever status, user, ping or online count change. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  send(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** Opens a fresh connection (after signing in or out, or "play here" after another tab took over). */
  reconnect(): void {
    this.close();
    this.retryMs = 1000;
    this.open();
  }

  signOut(): void {
    saveToken(null);
    this.user = null;
    this.reconnect();
  }

  playAsGuest(name: string): void {
    this.error = null;
    this.send({ t: 'guest', name });
  }

  // ---------------------------------------------------------------- internals

  private open(): void {
    window.clearTimeout(this.retryTimer);
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(gameSocketUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, fp: this.fingerprint, token: loadToken() });
    };
    ws.onmessage = (e: MessageEvent) => {
      if (typeof e.data !== 'string') return;
      let message: ServerMessage;
      try {
        message = JSON.parse(e.data) as ServerMessage;
      } catch {
        return;
      }
      this.handle(message);
      for (const listener of this.messageListeners) listener(message);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ping = null;
      if (this.status === 'mismatch' || this.status === 'replaced') {
        this.emitChange();
        return;
      }
      this.setStatus('offline');
      this.scheduleRetry();
    };
  }

  private close(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.close();
    }
  }

  private scheduleRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(MAX_RETRY_MS, this.retryMs * 2);
  }

  private handle(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        this.user = message.user;
        this.providers = message.providers;
        this.guestAllowed = message.guest;
        this.online = message.online;
        this.retryMs = 1000;
        this.setStatus('online');
        break;
      case 'token':
        saveToken(message.token);
        this.user = message.user;
        this.emitChange();
        break;
      case 'authFailed':
        // Expired or unknown login: forget it, the player signs in again.
        saveToken(null);
        this.user = null;
        break;
      case 'pong': {
        const rtt = performance.now() - message.c;
        if (rtt >= 0 && rtt < 10_000) this.ping = this.ping === null ? rtt : this.ping * 0.7 + rtt * 0.3;
        this.online = message.online;
        this.emitChange();
        break;
      }
      case 'matchEnd':
        if (this.user) {
          this.user = { ...this.user, rating: message.result.rating, wins: message.result.wins, losses: message.result.losses };
          this.emitChange();
        }
        break;
      case 'kicked':
        this.status = 'replaced';
        this.emitChange();
        break;
      case 'mismatch':
        this.status = 'mismatch';
        this.emitChange();
        break;
      case 'error':
        this.error = message.message;
        this.emitChange();
        break;
      default:
        break;
    }
  }

  private sendPing(): void {
    this.send({ t: 'ping', c: performance.now() });
  }

  private setStatus(status: ConnectionStatus): void {
    this.status = status;
    this.emitChange();
  }

  private emitChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}
