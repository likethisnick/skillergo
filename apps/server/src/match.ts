import { randomUUID } from 'node:crypto';
import {
  CONFIG,
  DEFAULT_SETTINGS,
  TICKS_PER_SNAPSHOT,
  World,
  encodeSnapshotBody,
  encodeTiles,
  otherTeam,
  sanitizeInput,
  type EntityId,
  type GameEvent,
  type InputCommand,
  type Loadout,
  type MatchEndReason,
  type MatchStartInfo,
  type ServerMessage,
  type TeamId,
} from '@skillergo/shared';
import type { UserRecord, UserStore } from './store';

/** Anything we can send messages to (a connected client). */
export interface Peer {
  send(message: ServerMessage): void;
  sendRaw(json: string): void;
}

export interface MatchEntrant {
  user: UserRecord;
  peer: Peer;
  loadout: Loadout;
}

interface Seat {
  user: UserRecord;
  team: TeamId;
  playerId: EntityId;
  peer: Peer | null;
  /** Inputs waiting to be applied, one per tick. */
  queue: InputCommand[];
  /** Sequence number of the last applied input (sent back so the client can replay the rest). */
  ack: number;
  /** Server time (ms) when the player dropped, null while connected. */
  droppedAt: number | null;
}

/** A disconnected player gets this long to come back before the match is given to the opponent. */
const RECONNECT_GRACE_MS = 30_000;
/** More queued inputs than this = the client runs ahead; the oldest are merged away. */
const MAX_QUEUED_INPUTS = 6;
/** Seconds the finished match keeps running so both sides see the result. */
const AFTER_MATCH_SECONDS = 6;

/**
 * One ranked 1v1: the Versus map with a human on each side instead of the AI.
 * The server owns the World; clients only send inputs and receive snapshots.
 */
export class Match {
  readonly id = randomUUID();
  readonly world: World;
  readonly seats: Seat[];
  private events: GameEvent[] = [];
  private ended = false;
  private endTicks = 0;
  finished = false;

  constructor(a: MatchEntrant, b: MatchEntrant, private readonly store: UserStore) {
    this.world = new World({ mode: 'versus', settings: DEFAULT_SETTINGS });
    // Random sides: the blue base is not better, but it should not always be the same person.
    const [blue, red] = Math.random() < 0.5 ? [a, b] : [b, a];
    this.seats = [this.seat(blue, 'blue'), this.seat(red, 'red')];
    for (const seat of this.seats) seat.peer?.send({ t: 'matchStart', match: this.startInfo(seat, false) });
    console.log(`[match ${this.id.slice(0, 8)}] ${blue.user.name} (blue) vs ${red.user.name} (red)`);
  }

  private seat(entrant: MatchEntrant, team: TeamId): Seat {
    const player = this.world.addPlayer(entrant.loadout, { team });
    return { user: entrant.user, team, playerId: player.id, peer: entrant.peer, queue: [], ack: 0, droppedAt: null };
  }

  /** The result is decided (the match may still run a few seconds for the victory screen). */
  get over(): boolean {
    return this.ended;
  }

  hasUser(userId: string): boolean {
    return this.seats.some((s) => s.user.id === userId);
  }

  // ------------------------------------------------------------- simulation

  /** One fixed simulation step (CONFIG.tickRate per second). */
  tick(): void {
    if (this.finished) return;
    for (const seat of this.seats) this.applyNextInput(seat);
    this.world.step(1 / CONFIG.tickRate);
    for (const ev of this.world.drainEvents()) this.events.push(ev);

    if (!this.ended) {
      if (this.world.winner) this.end(this.world.winner, 'nexus');
      else this.checkDropped();
    } else if (++this.endTicks >= AFTER_MATCH_SECONDS * CONFIG.tickRate) {
      this.finished = true;
    }

    if (this.world.tick % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot();
  }

  private applyNextInput(seat: Seat): void {
    if (seat.peer === null) {
      // Gone: the character stands still until its player is back (or the match is given away).
      const p = this.world.players.get(seat.playerId);
      if (p) this.world.setInput(seat.playerId, { ...p.input, moveX: 0, moveY: 0, fire: false, ability: false });
      return;
    }
    const queue = seat.queue;
    if (queue.length === 0) return; // Late packet: keep the previous input one more tick.
    if (queue.length > MAX_QUEUED_INPUTS) {
      // Drop the oldest, but keep short button taps so an ability press is never lost.
      const dropped = queue.splice(0, queue.length - MAX_QUEUED_INPUTS);
      const next = queue[0][1];
      if (dropped.some(([, input]) => input.ability)) next.ability = true;
      if (dropped.some(([, input]) => input.fire)) next.fire = true;
    }
    const [seq, input] = queue.shift() as InputCommand;
    this.world.setInput(seat.playerId, input);
    seat.ack = seq;
  }

  private broadcastSnapshot(): void {
    const body = JSON.stringify(encodeSnapshotBody(this.world, this.events));
    this.events = [];
    for (const seat of this.seats) {
      // The body is shared; only `ack` differs per player.
      seat.peer?.sendRaw(`{"t":"s","ack":${seat.ack},${body.slice(1)}`);
    }
  }

  // ------------------------------------------------------------------ inputs

  receiveInputs(userId: string, raw: unknown): void {
    const seat = this.seatOf(userId);
    if (!seat || !Array.isArray(raw)) return;
    for (const item of raw.slice(0, 30)) {
      if (!Array.isArray(item) || typeof item[0] !== 'number') continue;
      const input = sanitizeInput(item[1]);
      if (!input) continue;
      seat.queue.push([Math.floor(item[0]), input]);
    }
    // Never let a flooding client grow memory.
    if (seat.queue.length > 120) seat.queue.splice(0, seat.queue.length - MAX_QUEUED_INPUTS);
  }

  // ------------------------------------------------------------ connections

  /** A player (re)connects: he gets the full match info and then snapshots as usual. */
  attach(userId: string, peer: Peer): void {
    const seat = this.seatOf(userId);
    if (!seat) return;
    const wasDropped = seat.droppedAt !== null;
    seat.peer = peer;
    seat.droppedAt = null;
    seat.queue = [];
    // The new client counts inputs from 1 again.
    seat.ack = 0;
    peer.send({ t: 'matchStart', match: this.startInfo(seat, true) });
    if (wasDropped) this.notifyOpponent(seat, true);
  }

  detach(userId: string, peer: Peer): void {
    const seat = this.seatOf(userId);
    if (!seat || seat.peer !== peer) return;
    seat.peer = null;
    seat.queue = [];
    if (this.ended) return;
    seat.droppedAt = Date.now();
    this.notifyOpponent(seat, false);
  }

  /** "Leave match" in the menu: an instant loss. */
  surrender(userId: string): void {
    const seat = this.seatOf(userId);
    if (!seat || this.ended) return;
    this.forfeit(otherTeam(seat.team), 'surrender');
  }

  private checkDropped(): void {
    const now = Date.now();
    const expired = this.seats.filter((s) => s.droppedAt !== null && now - s.droppedAt >= RECONNECT_GRACE_MS);
    if (expired.length === 0) return;
    if (expired.length === this.seats.length || this.seats.every((s) => s.peer === null)) {
      // Nobody is left: close without a result.
      console.log(`[match ${this.id.slice(0, 8)}] abandoned`);
      this.ended = true;
      this.finished = true;
      return;
    }
    this.forfeit(otherTeam(expired[0].team), 'forfeit');
  }

  private notifyOpponent(seat: Seat, connected: boolean): void {
    for (const other of this.seats) {
      if (other !== seat) other.peer?.send({ t: 'opponent', connected, graceSeconds: RECONNECT_GRACE_MS / 1000 });
    }
  }

  // ----------------------------------------------------------------- ending

  /** Ends the match without a fallen nexus: the result goes through the World like a normal victory. */
  private forfeit(winner: TeamId, reason: MatchEndReason): void {
    this.world.winner = winner;
    this.world.emit({ type: 'victory', team: winner, reason: 'forfeit' });
    this.end(winner, reason);
  }

  private end(winner: TeamId, reason: MatchEndReason): void {
    if (this.ended) return;
    this.ended = true;
    const S = this.world.server;
    for (const seat of this.seats) {
      const won = seat.team === winner;
      const before = seat.user.rating;
      seat.user.rating = Math.max(0, before + (won ? S.ratingWin : -S.ratingLoss));
      if (won) seat.user.wins++;
      else seat.user.losses++;
      seat.peer?.send({
        t: 'matchEnd',
        result: {
          won, reason, rating: seat.user.rating, delta: seat.user.rating - before,
          wins: seat.user.wins, losses: seat.user.losses,
        },
      });
    }
    this.store.changed();
    const names = this.seats.map((s) => `${s.user.name} ${s.user.rating}`).join(' / ');
    console.log(`[match ${this.id.slice(0, 8)}] ${winner} wins (${reason}) · ${names}`);
  }

  // ----------------------------------------------------------------- helpers

  private seatOf(userId: string): Seat | undefined {
    return this.seats.find((s) => s.user.id === userId);
  }

  private startInfo(seat: Seat, resumed: boolean): MatchStartInfo {
    const map = this.world.map;
    return {
      matchId: this.id,
      you: seat.playerId,
      team: seat.team,
      players: this.seats.map((s) => ({ id: s.playerId, team: s.team, name: s.user.name, rating: s.user.rating })),
      server: this.world.server,
      settings: this.world.settings,
      map: { width: map.width, height: map.height, tileSize: map.tileSize, tiles: encodeTiles(map.tiles) },
      resumed,
    };
  }
}
