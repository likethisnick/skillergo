import {
  CONFIG,
  EMPTY_INPUT,
  decodeEnemy,
  decodeOrb,
  decodePlayer,
  decodeProjectile,
  stepMovement,
  type Enemy,
  type EntityId,
  type GameEvent,
  type InputCommand,
  type MatchResult,
  type MatchStartInfo,
  type Nexus,
  type Orb,
  type Player,
  type PlayerInput,
  type Projectile,
  type RunSummary,
  type ServerMessage,
  type SnapshotMessage,
  type TeamId,
  type Tower,
} from '@skillergo/shared';
import type { Connection } from '../net/Connection';
import { SnapshotView } from '../net/SnapshotView';
import type { GameSession, NetOverlay } from './GameSession';

const STEP = 1 / CONFIG.tickRate;
/** The world is drawn this far behind the newest snapshot, so there is always a pair to blend between. */
const INTERP_DELAY = 0.1;
/** Corrections smaller than this are blended in smoothly; bigger ones (respawn, desync) snap. */
const MAX_SMOOTH_ERROR = 160;
/** How fast a prediction error melts away (per second). */
const SMOOTHING_RATE = 12;
/** After reconnecting, the server re-sends the match within this time if it still runs. */
const RESUME_TIMEOUT_MS = 3000;

/** One decoded server snapshot. */
interface Frame {
  time: number;
  ack: number;
  winner: TeamId | null;
  players: Map<EntityId, Player>;
  enemies: Map<EntityId, Enemy>;
  projectiles: Map<EntityId, Projectile>;
  orbs: Map<EntityId, Orb>;
  towers: Map<EntityId, Tower>;
  nexuses: Map<EntityId, Nexus>;
  events: GameEvent[];
  released: boolean;
}

/**
 * Online match. The server runs the World; this session
 * - turns frame inputs into fixed 60 Hz commands and sends them (the server applies one per tick);
 * - predicts the local player's movement with the shared movement code, so controls feel instant,
 *   and replays unconfirmed commands on top of every server state (smoothing small corrections);
 * - draws everything else a little in the past, blending between two snapshots;
 * - hands out simulation events when the drawn time reaches them.
 */
export class NetworkSession implements GameSession {
  readonly localPlayerId: EntityId;
  readonly matchId: string;
  readonly view: SnapshotView;
  result: MatchResult | null = null;

  private readonly names = new Map<EntityId, string>();
  private readonly ratings = new Map<EntityId, number>();
  private readonly overlay: NetOverlay;
  private frames: Frame[] = [];
  private newestArrival = 0;
  private renderTime = -1;

  private seq = 0;
  private accumulator = 0;
  private latestInput: PlayerInput = cloneInput(EMPTY_INPUT);
  private inputFresh = false;
  private outgoing: InputCommand[] = [];
  private pending: { seq: number; input: PlayerInput }[] = [];
  private predicted: Player | null = null;
  private smoothX = 0;
  private smoothY = 0;
  private opponentDroppedAt: number | null = null;
  private opponentGrace = 0;
  /** Set when our connection came back; cleared when the server re-sends this match. */
  private reconnectedAt: number | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly conn: Connection, info: MatchStartInfo) {
    this.matchId = info.matchId;
    this.localPlayerId = info.you;
    this.view = new SnapshotView(info);
    for (const p of info.players) {
      this.names.set(p.id, p.name);
      this.ratings.set(p.id, p.rating);
    }
    this.overlay = { ping: null, names: this.names, ratings: this.ratings, opponentGraceLeft: null, reconnecting: false };
    this.unsubscribe = conn.onMessage((m) => this.onMessage(m));
  }

  get net(): NetOverlay {
    this.overlay.ping = this.conn.ping;
    this.overlay.reconnecting = !this.conn.isOnline;
    this.overlay.opponentGraceLeft = this.opponentDroppedAt === null
      ? null
      : Math.max(0, this.opponentGrace - (performance.now() - this.opponentDroppedAt) / 1000);
    return this.overlay;
  }

  /** The match is decided (by the nexus, a surrender or a timeout). */
  get over(): boolean {
    return this.result !== null || this.view.winner !== null;
  }

  /** We reconnected but the match is gone (given to the opponent while we were away). */
  get lost(): boolean {
    return this.reconnectedAt !== null && !this.over && performance.now() - this.reconnectedAt > RESUME_TIMEOUT_MS;
  }

  /** Back in the same match after a reconnect: input numbering starts over. */
  resume(info: MatchStartInfo): void {
    this.reconnectedAt = null;
    for (const p of info.players) this.ratings.set(p.id, p.rating);
    this.seq = 0;
    this.pending = [];
    this.outgoing = [];
    this.predicted = null;
    this.frames = [];
    this.renderTime = -1;
  }

  /** "Leave match": counts as a loss. */
  surrender(): void {
    this.conn.send({ t: 'leave' });
  }

  sendInput(input: PlayerInput): void {
    this.latestInput = input;
    this.inputFresh = true;
  }

  update(frameDt: number): GameEvent[] {
    this.produceCommands(frameDt);
    return this.advanceView(frameDt);
  }

  summarize(): RunSummary | null {
    // Online runs are not written to the local history.
    return null;
  }

  dispose(): void {
    this.unsubscribe();
  }

  // ------------------------------------------------------------------- input

  private produceCommands(frameDt: number): void {
    // Without a fresh input this frame (dead, menu) the character just stands; press counters stay.
    const input = this.inputFresh
      ? this.latestInput
      : { ...this.latestInput, moveX: 0, moveY: 0, fire: false, ability: false };
    this.inputFresh = false;

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 8) {
      this.accumulator -= STEP;
      steps++;
      const cmd = cloneInput(input);
      this.seq++;
      this.outgoing.push([this.seq, cmd]);
      this.pending.push({ seq: this.seq, input: cmd });
      this.predictStep(this.predicted, cmd);
    }
    if (steps === 8) this.accumulator = 0;
    if (this.outgoing.length > 0) {
      if (this.conn.send({ t: 'input', cmds: this.outgoing })) this.outgoing = [];
      else if (this.outgoing.length > 30) this.outgoing.splice(0, this.outgoing.length - 30);
    }
    if (this.pending.length > 300) this.pending.splice(0, this.pending.length - 300);
  }

  private predictStep(p: Player | null, input: PlayerInput): void {
    if (!p || !p.alive || this.view.winner) return;
    p.input = input;
    stepMovement(this.view, p, STEP);
  }

  // ---------------------------------------------------------------- messages

  private onMessage(m: ServerMessage): void {
    switch (m.t) {
      case 's':
        this.onSnapshot(m);
        break;
      case 'opponent':
        this.opponentDroppedAt = m.connected ? null : performance.now();
        this.opponentGrace = m.graceSeconds;
        break;
      case 'matchEnd':
        this.result = m.result;
        this.opponentDroppedAt = null;
        break;
      case 'welcome':
        // A new connection: if the match still runs, "matchStart" follows right away.
        this.reconnectedAt = performance.now();
        break;
      default:
        break;
    }
  }

  private onSnapshot(m: SnapshotMessage): void {
    const last = this.frames[this.frames.length - 1];
    if (last && m.time <= last.time) return; // Out of order or duplicate.
    const frame: Frame = {
      time: m.time,
      ack: m.ack,
      winner: m.winner,
      players: new Map(m.pl.map((w) => [w.id, decodePlayer(w)])),
      enemies: new Map(m.en.map((a) => [a[0], decodeEnemy(a)])),
      projectiles: new Map(m.pr.map((a) => [a[0], decodeProjectile(a)])),
      orbs: new Map(m.or.map((a) => [a[0], decodeOrb(a)])),
      towers: new Map(m.tw.map((t) => [t.id, t])),
      nexuses: new Map(m.nx.map((n) => [n.id, n])),
      events: m.ev,
      released: false,
    };
    this.frames.push(frame);
    if (this.frames.length > 60) this.frames.splice(0, this.frames.length - 60);
    this.newestArrival = performance.now();
    this.reconcile(m);
  }

  /** Server state of our own player + every command it has not applied yet = where we are now. */
  private reconcile(m: SnapshotMessage): void {
    const wire = m.pl.find((p) => p.id === this.localPlayerId);
    if (!wire) return;
    this.pending = this.pending.filter((c) => c.seq > m.ack);
    const base = decodePlayer(wire);
    for (const c of this.pending) this.predictStep(base, c.input);

    const prev = this.predicted;
    if (prev && prev.alive && base.alive) {
      const dx = prev.x + this.smoothX - base.x;
      const dy = prev.y + this.smoothY - base.y;
      if (dx * dx + dy * dy < MAX_SMOOTH_ERROR * MAX_SMOOTH_ERROR) {
        this.smoothX = dx;
        this.smoothY = dy;
      } else {
        this.smoothX = 0;
        this.smoothY = 0;
      }
    } else {
      this.smoothX = 0;
      this.smoothY = 0;
    }
    this.predicted = base;
  }

  // ------------------------------------------------------------------- view

  private advanceView(frameDt: number): GameEvent[] {
    const frames = this.frames;
    if (frames.length === 0) return [];
    const newest = frames[frames.length - 1];

    // Drawn time follows "newest snapshot minus a small delay", advancing smoothly with the local clock.
    const target = newest.time + (performance.now() - this.newestArrival) / 1000 - INTERP_DELAY;
    if (this.renderTime < 0 || Math.abs(target - this.renderTime) > 0.5) this.renderTime = target;
    else this.renderTime += frameDt + (target - this.renderTime) * Math.min(1, frameDt * 2);
    const time = Math.min(this.renderTime, newest.time);

    let ai = 0;
    while (ai + 1 < frames.length && frames[ai + 1].time <= time) ai++;
    const a = frames[ai];
    const b = frames[Math.min(ai + 1, frames.length - 1)];
    const k = b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 1;

    const events: GameEvent[] = [];
    for (const f of frames) {
      if (f.time > time) break;
      if (!f.released) {
        f.released = true;
        for (const ev of f.events) events.push(ev);
      }
    }
    if (ai > 0) frames.splice(0, ai);

    const view = this.view;
    view.time = a.time + (b.time - a.time) * k;
    view.winner = k >= 1 ? b.winner : a.winner;
    blend(view.enemies, a.enemies, b.enemies, k, true);
    blend(view.projectiles, a.projectiles, b.projectiles, k, false);
    blend(view.orbs, a.orbs, b.orbs, k, false);
    copyInto(view.towers, b.towers);
    copyInto(view.nexuses, b.nexuses);
    this.buildPlayers(a, b, k, newest, frameDt);
    return events;
  }

  private buildPlayers(a: Frame, b: Frame, k: number, newest: Frame, frameDt: number): void {
    const players = this.view.players;
    players.clear();
    for (const [id, pb] of b.players) {
      if (id === this.localPlayerId) continue;
      const pa = a.players.get(id);
      if (!pa || !pa.alive || !pb.alive) {
        players.set(id, pb);
        continue;
      }
      players.set(id, {
        ...pb,
        x: lerp(pa.x, pb.x, k),
        y: lerp(pa.y, pb.y, k),
        aim: lerpAngle(pa.aim, pb.aim, k),
        hook: { ...pb.hook, x: lerp(pa.hook.x, pb.hook.x, k), y: lerp(pa.hook.y, pb.hook.y, k) },
        beam: { ...pb.beam, endX: lerp(pa.beam.endX, pb.beam.endX, k), endY: lerp(pa.beam.endY, pb.beam.endY, k) },
      });
    }

    // Our own player: newest server state (HP, level, cooldowns) at the predicted position.
    const latest = newest.players.get(this.localPlayerId);
    if (!latest) return;
    const decay = Math.exp(-frameDt * SMOOTHING_RATE);
    this.smoothX *= decay;
    this.smoothY *= decay;
    const shown: Player = { ...latest };
    const p = this.predicted;
    if (p && p.alive && latest.alive) {
      shown.x = p.x + this.smoothX;
      shown.y = p.y + this.smoothY;
      shown.vx = p.vx;
      shown.vy = p.vy;
      shown.dashTimer = p.dashTimer;
      shown.dashDirX = p.dashDirX;
      shown.dashDirY = p.dashDirY;
      shown.dashCooldown = p.dashCooldown;
      shown.invulnerableTimer = p.invulnerableTimer;
      shown.aim = this.latestInput.aim;
    }
    // Our swings and hits are drawn as soon as we hear about them, not after the blending delay.
    const shift = this.view.time - newest.time;
    shown.lastAttackTime = latest.lastAttackTime + shift;
    shown.lastDamageTime = latest.lastDamageTime + shift;
    players.set(this.localPlayerId, shown);
  }
}

function cloneInput(input: Readonly<PlayerInput>): PlayerInput {
  return { ...input, upgrades: { ...input.upgrades } };
}

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

/** Fills `target` with the entities of `b`, moved to where they were at blend factor k between a and b. */
function blend<T extends { id: EntityId; x: number; y: number; aim?: number }>(
  target: Map<EntityId, T>, a: ReadonlyMap<EntityId, T>, b: ReadonlyMap<EntityId, T>, k: number, withAim: boolean,
): void {
  target.clear();
  for (const [id, eb] of b) {
    const ea = a.get(id);
    if (!ea || k >= 1) {
      target.set(id, eb);
      continue;
    }
    const e = { ...eb, x: lerp(ea.x, eb.x, k), y: lerp(ea.y, eb.y, k) };
    if (withAim && ea.aim !== undefined && eb.aim !== undefined) e.aim = lerpAngle(ea.aim, eb.aim, k);
    target.set(id, e);
  }
}

function copyInto<T>(target: Map<EntityId, T>, source: ReadonlyMap<EntityId, T>): void {
  target.clear();
  for (const [id, v] of source) target.set(id, v);
}
