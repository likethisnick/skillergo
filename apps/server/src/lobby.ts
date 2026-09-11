import { randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  CONFIG,
  PROTOCOL_VERSION,
  buildFingerprint,
  sanitizeLoadout,
  sanitizeName,
  type Loadout,
  type ServerMessage,
} from '@skillergo/shared';
import type { ServerEnv } from './env';
import { Match, type Peer } from './match';
import { enabledProviders } from './oauth';
import { publicUser, type UserRecord, type UserStore } from './store';
import { issueSession, verifyToken, type SessionPayload } from './tokens';

const FINGERPRINT = buildFingerprint();
/** A socket that has not said hello by then is dropped. */
const HELLO_TIMEOUT_MS = 10_000;
/** Protocol-level ping to detect dead connections (mobile networks, sleeping laptops). */
const HEARTBEAT_MS = 15_000;
const STEP_MS = 1000 / CONFIG.tickRate;
/** After a long stall (GC, overloaded VM) do not try to catch up more than this many ticks. */
const MAX_CATCH_UP_TICKS = 10;

/** One WebSocket connection. */
class Client implements Peer {
  user: UserRecord | null = null;
  greeted = false;
  alive = true;
  queuedWith: Loadout | null = null;

  constructor(readonly ws: WebSocket) {}

  send(message: ServerMessage): void {
    this.sendRaw(JSON.stringify(message));
  }

  sendRaw(json: string): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(json);
  }
}

/**
 * Everything between "a browser connected" and "a match runs": hello / auth,
 * the matchmaking queue (first two in line play each other), routing of inputs
 * and one fixed-rate loop that steps every running match.
 */
export class Lobby {
  private readonly clients = new Set<Client>();
  private readonly byUser = new Map<string, Client>();
  private readonly queue: Client[] = [];
  private readonly matches = new Set<Match>();
  private readonly matchOf = new Map<string, Match>();
  private lastTick = performance.now();
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(private readonly env: ServerEnv, private readonly store: UserStore) {
    this.timers.push(setInterval(() => this.update(), 4));
    this.timers.push(setInterval(() => this.heartbeat(), HEARTBEAT_MS));
  }

  get online(): number {
    let n = 0;
    for (const c of this.clients) if (c.greeted) n++;
    return n;
  }

  get runningMatches(): number {
    return this.matches.size;
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
  }

  // ------------------------------------------------------------ connections

  accept(ws: WebSocket): void {
    const client = new Client(ws);
    this.clients.add(client);
    const helloTimer = setTimeout(() => {
      if (!client.greeted) ws.close(4000, 'no hello');
    }, HELLO_TIMEOUT_MS);

    ws.on('pong', () => {
      client.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        this.handle(client, msg);
      } catch (err) {
        console.error('[lobby] message failed', err);
      }
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      this.drop(client);
    });
    ws.on('error', () => ws.terminate());
  }

  private handle(client: Client, msg: Record<string, unknown>): void {
    if (msg.t === 'hello') {
      this.hello(client, msg);
      return;
    }
    if (!client.greeted) return;
    switch (msg.t) {
      case 'ping':
        client.send({ t: 'pong', c: typeof msg.c === 'number' ? msg.c : 0, online: this.online });
        break;
      case 'input':
        if (client.user) this.matchOf.get(client.user.id)?.receiveInputs(client.user.id, msg.cmds);
        break;
      case 'guest':
        this.guestLogin(client, msg.name);
        break;
      case 'queue':
        this.enqueue(client, sanitizeLoadout(msg.loadout));
        break;
      case 'cancel':
        this.leaveQueue(client);
        client.send({ t: 'idle' });
        break;
      case 'leave':
        if (client.user) this.matchOf.get(client.user.id)?.surrender(client.user.id);
        break;
    }
  }

  private hello(client: Client, msg: Record<string, unknown>): void {
    if (client.greeted) return;
    if (msg.v !== PROTOCOL_VERSION || msg.fp !== FINGERPRINT) {
      client.send({ t: 'mismatch' });
      client.ws.close(4001, 'version mismatch');
      return;
    }
    client.greeted = true;
    const session = verifyToken<SessionPayload>(msg.token, this.env.sessionSecret);
    const user = session ? this.store.get(session.uid) : undefined;
    if (msg.token && !user) client.send({ t: 'authFailed' });
    if (user) this.bindUser(client, user);
    this.welcome(client);
    const match = user ? this.matchOf.get(user.id) : undefined;
    if (user && match && !match.over) match.attach(user.id, client);
  }

  private welcome(client: Client): void {
    client.send({
      t: 'welcome',
      user: client.user ? publicUser(client.user) : null,
      providers: enabledProviders(this.env),
      guest: this.env.allowGuest,
      online: this.online,
    });
  }

  /** One live connection per account: a new tab takes over from the old one. */
  private bindUser(client: Client, user: UserRecord): void {
    const previous = this.byUser.get(user.id);
    if (previous && previous !== client) {
      previous.send({ t: 'kicked', reason: 'replaced' });
      this.drop(previous);
      previous.ws.close(4002, 'replaced');
    }
    if (client.user && client.user.id !== user.id && this.byUser.get(client.user.id) === client) {
      this.byUser.delete(client.user.id);
      this.leaveQueue(client);
    }
    client.user = user;
    this.byUser.set(user.id, client);
    this.store.touch(user);
  }

  private guestLogin(client: Client, rawName: unknown): void {
    if (!this.env.allowGuest) {
      client.send({ t: 'error', message: 'Guest play is disabled on this server' });
      return;
    }
    const name = sanitizeName(rawName);
    if (!name) {
      client.send({ t: 'error', message: 'Name must be 2-20 characters' });
      return;
    }
    const user = this.store.upsert(`guest:${randomBytes(8).toString('hex')}`, 'guest', name, null);
    this.bindUser(client, user);
    client.send({ t: 'token', token: issueSession(user.id, this.env.sessionSecret), user: publicUser(user) });
  }

  private drop(client: Client): void {
    if (!this.clients.delete(client)) return;
    this.leaveQueue(client);
    const user = client.user;
    if (user && this.byUser.get(user.id) === client) {
      this.byUser.delete(user.id);
      this.matchOf.get(user.id)?.detach(user.id, client);
    }
  }

  private heartbeat(): void {
    for (const client of this.clients) {
      if (!client.alive) {
        client.ws.terminate();
        continue;
      }
      client.alive = false;
      client.ws.ping();
    }
  }

  // ------------------------------------------------------------ matchmaking

  private enqueue(client: Client, loadout: Loadout | null): void {
    const user = client.user;
    if (!user) {
      client.send({ t: 'error', message: 'Sign in to play online' });
      return;
    }
    if (!loadout) return;
    const running = this.matchOf.get(user.id);
    if (running && !running.over) {
      running.attach(user.id, client);
      return;
    }
    client.queuedWith = loadout;
    if (!this.queue.includes(client)) this.queue.push(client);
    this.matchmake();
    if (this.queue.includes(client)) client.send({ t: 'queued', waiting: this.queue.length });
  }

  private leaveQueue(client: Client): void {
    const i = this.queue.indexOf(client);
    if (i >= 0) this.queue.splice(i, 1);
    client.queuedWith = null;
  }

  /** Rating is not used yet: the first two players in line play each other. */
  private matchmake(): void {
    while (this.queue.length >= 2) {
      const a = this.queue.shift() as Client;
      const b = this.queue.shift() as Client;
      if (!a.user || !b.user || !a.queuedWith || !b.queuedWith) continue;
      const match = new Match(
        { user: a.user, peer: a, loadout: a.queuedWith },
        { user: b.user, peer: b, loadout: b.queuedWith },
        this.store,
      );
      a.queuedWith = null;
      b.queuedWith = null;
      this.matches.add(match);
      for (const seat of match.seats) this.matchOf.set(seat.user.id, match);
    }
  }

  // ------------------------------------------------------------------- loop

  private update(): void {
    const now = performance.now();
    let steps = Math.floor((now - this.lastTick) / STEP_MS);
    if (steps <= 0) return;
    if (steps > MAX_CATCH_UP_TICKS) {
      this.lastTick = now - STEP_MS;
      steps = 1;
    }
    for (let i = 0; i < steps; i++) {
      this.lastTick += STEP_MS;
      for (const match of this.matches) {
        try {
          match.tick();
        } catch (err) {
          // A bug in one match must not take the whole server down.
          console.error(`[match ${match.id.slice(0, 8)}] crashed`, err);
          match.finished = true;
        }
      }
    }
    for (const match of this.matches) {
      if (!match.finished) continue;
      this.matches.delete(match);
      for (const seat of match.seats) {
        if (this.matchOf.get(seat.user.id) === match) this.matchOf.delete(seat.user.id);
      }
    }
  }
}
