import {
  CONFIG,
  EMPTY_INPUT,
  MAX_SHIELD_ARC,
  abilityScaling,
  attackSpeedMultiplier,
  decodeEnemy,
  decodeOrb,
  decodePlayer,
  decodeProjectile,
  rayCircleDistance,
  segmentCircleHit,
  shieldCovers,
  shotgunCone,
  stepMovement,
  weaponDamageMultiplier,
  type Body,
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
import { Anticipation } from './Anticipation';
import type { GameSession, NetOverlay } from './GameSession';

const STEP = 1 / CONFIG.tickRate;
const EPS = 1e-6;
const W = CONFIG.weapons;
const A = CONFIG.abilities;

/** Bounds of the adaptive blending delay (seconds behind the server). */
const MIN_INTERP_DELAY = 0.03;
const MAX_INTERP_DELAY = 0.15;
/** Extra safety on top of the measured network jitter. */
const INTERP_MARGIN = 0.008;
/** Snapshots remembered for the clock estimate (~2 s at 60 per second). */
const CLOCK_SAMPLES = 120;
/** Corrections smaller than this are blended in smoothly; bigger ones (respawn, desync) snap. */
const MAX_SMOOTH_ERROR = 160;
/** How fast a prediction error melts away (per second). */
const SMOOTHING_RATE = 12;
/** After reconnecting, the server re-sends the match within this time if it still runs. */
const RESUME_TIMEOUT_MS = 3000;

/** One decoded server snapshot. */
interface Frame {
  time: number;
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

/** Our own bullet, drawn the moment we fire (the server's copy of it is hidden). */
interface Ghost {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  /** Damage the server's copy of this bullet deals (for the anticipated damage number). */
  damage: number;
}

/**
 * Online match. The server runs the World; this session hides the network delay:
 * - frame input becomes fixed 60 Hz commands (the server applies one per tick);
 * - our movement, shots, sword swings and beam are predicted locally with the shared rules,
 *   so they react instantly; server corrections of our position are blended in;
 * - everything else is drawn slightly in the past, blending between snapshots; the delay adapts
 *   to the measured network jitter (a stable connection gets ~35-50 ms);
 * - our own hits (damage numbers) show as soon as the server confirms them.
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
  private renderTime = -1;
  /** Local seconds minus server seconds, measured over the least delayed snapshots. */
  private clockOffset = 0;
  private clockSamples: number[] = [];
  private interpDelay = 0.06;
  /** Our own events (hits, level ups), shown right away instead of after the blending delay. */
  private instantEvents: GameEvent[] = [];

  private seq = 0;
  private accumulator = 0;
  private latestInput: PlayerInput = cloneInput(EMPTY_INPUT);
  private inputFresh = false;
  /** LMB state of the last produced command (drives the predicted beam). */
  private firing = false;
  private outgoing: InputCommand[] = [];
  private pending: { seq: number; input: PlayerInput }[] = [];
  private predicted: Player | null = null;
  private smoothX = 0;
  private smoothY = 0;
  private ghosts: Ghost[] = [];
  private nextGhostId = -1;
  private localSwing: { angle: number; at: number } | null = null;
  /** Where our predicted bullets hit walls recently (to skip the server's duplicate spark). */
  private ghostWallHits: { x: number; y: number; at: number }[] = [];
  /** Visual anticipation of hits, kills, pickups and cut bullets (see Anticipation.ts). */
  private readonly anticipation: Anticipation;
  /** Effects of our own predicted actions (shotgun blast), shown this frame. */
  private localEvents: GameEvent[] = [];
  /** The last command the server has applied (its RMB state matters for press detection). */
  private ackedInput: PlayerInput | null = null;
  private newest: Frame | null = null;

  private opponentDroppedAt: number | null = null;
  private opponentGrace = 0;
  /** Set when our connection came back; cleared when the server re-sends this match. */
  private reconnectedAt: number | null = null;
  private readonly unsubscribe: () => void;

  constructor(private readonly conn: Connection, info: MatchStartInfo) {
    this.matchId = info.matchId;
    this.localPlayerId = info.you;
    this.view = new SnapshotView(info);
    this.anticipation = new Anticipation(info.you);
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
    this.clockSamples = [];
    this.renderTime = -1;
    this.ghosts = [];
    this.newest = null;
    this.ackedInput = null;
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
    const events = this.anticipation.filterServerEvents(this.advanceView(frameDt));
    for (const ev of this.localEvents) events.push(ev);
    this.localEvents = [];
    this.updateGhosts(frameDt, events);
    const newest = this.newest;
    if (newest) {
      const swing = this.localSwing ? { angle: this.localSwing.angle, age: (performance.now() - this.localSwing.at) / 1000 } : null;
      // Enemy bullets are drawn where they will be when our current input reaches the server.
      const lead = this.interpDelay + (this.conn.ping ?? 0) / 2000;
      this.anticipation.apply(this.view, newest.enemies, newest.projectiles, newest.orbs, frameDt, lead, swing, events);
    }
    return events;
  }

  summarize(): RunSummary | null {
    // Online runs are not written to the local history.
    return null;
  }

  dispose(): void {
    this.unsubscribe();
  }

  // ------------------------------------------------------------ prediction

  private produceCommands(frameDt: number): void {
    // Without a fresh input this frame (dead, menu) the character just stands; press counters stay.
    const input = this.inputFresh
      ? this.latestInput
      : { ...this.latestInput, moveX: 0, moveY: 0, fire: false, ability: false };
    this.inputFresh = false;
    this.firing = input.fire;

    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 8) {
      this.accumulator -= STEP;
      steps++;
      const cmd = cloneInput(input);
      this.seq++;
      this.outgoing.push([this.seq, cmd]);
      this.pending.push({ seq: this.seq, input: cmd });
      this.predictStep(this.predicted, cmd, true);
    }
    if (steps === 8) this.accumulator = 0;
    if (this.outgoing.length > 0) {
      if (this.conn.send({ t: 'input', cmds: this.outgoing })) this.outgoing = [];
      else if (this.outgoing.length > 30) this.outgoing.splice(0, this.outgoing.length - 30);
    }
    if (this.pending.length > 300) this.pending.splice(0, this.pending.length - 300);
  }

  /**
   * One tick of our own player, in the same order as the server (move, aim, weapon, ability).
   * `live` is false while replaying already predicted commands: then nothing is spawned again.
   */
  private predictStep(p: Player | null, input: PlayerInput, live: boolean): void {
    if (!p || !p.alive || this.view.winner) return;
    p.input = input;
    stepMovement(this.view, p, STEP);
    p.aim = input.aim;
    this.predictWeapon(p, input, live);
    this.predictAbility(p, input, live);
  }

  private predictWeapon(p: Player, input: PlayerInput, live: boolean): void {
    p.attackCooldown = Math.max(0, p.attackCooldown - STEP);
    if (p.weapon === 'beam' || !input.fire || p.attackCooldown > EPS) return;
    const cooldown = p.weapon === 'gun' ? W.gun.cooldown : W.sword.cooldown;
    p.attackCooldown = cooldown / attackSpeedMultiplier(p);
    if (!live) return;
    if (p.weapon === 'gun') {
      this.spawnGhost(p);
      return;
    }
    this.localSwing = { angle: p.aim, at: performance.now() };
    const damage = this.view.server.swordDamage * weaponDamageMultiplier(p);
    this.anticipation.hitMobsInCone(this.view, p, p.aim, W.sword.arc, W.sword.range, damage);
  }

  /** Shield and shotgun react on the press (the hook stays server-driven). Mirrors tryUseAbility. */
  private predictAbility(p: Player, input: PlayerInput, live: boolean): void {
    p.abilityCooldown = Math.max(0, p.abilityCooldown - STEP);
    const pressed = input.ability && !p.prevAbilityHeld;
    p.prevAbilityHeld = input.ability;
    if (pressed && p.abilityUnlocked && p.abilityCooldown <= EPS && p.ability !== 'hook') {
      const s = abilityScaling(p);
      if (p.ability === 'shield') {
        const duration = A.shield.duration * s.power;
        p.shieldTimer = duration;
        p.shieldArc = Math.min(MAX_SHIELD_ARC, A.shield.arc * s.radius);
        p.abilityCooldown = duration + A.shield.cooldown * s.cooldown;
        p.abilityCooldownTotal = A.shield.cooldown * s.cooldown;
      } else {
        const cone = shotgunCone(p, this.view.server);
        p.abilityCooldown = A.shotgun.cooldown * s.cooldown;
        p.abilityCooldownTotal = p.abilityCooldown;
        if (live) {
          this.localEvents.push({ type: 'shotgun', playerId: p.id, x: p.x, y: p.y, angle: p.aim, range: cone.range, arc: cone.arc });
          this.anticipation.hitMobsInCone(this.view, p, p.aim, cone.arc, cone.range, cone.damage);
        }
      }
    }
    p.shieldTimer = Math.max(0, p.shieldTimer - STEP);
  }

  /** Same spawn point, speed and range as the server's fireGun. */
  private spawnGhost(p: Player): void {
    const C = W.gun;
    const offset = p.radius + C.projectileRadius;
    const speed = this.view.server.bulletSpeed * this.view.server.playerBulletSpeedMultiplier;
    this.ghosts.push({
      id: this.nextGhostId--,
      x: p.x + Math.cos(p.aim) * offset,
      y: p.y + Math.sin(p.aim) * offset,
      vx: Math.cos(p.aim) * speed,
      vy: Math.sin(p.aim) * speed,
      radius: C.projectileRadius,
      life: C.range / speed,
      damage: this.view.server.gunDamage * weaponDamageMultiplier(p),
    });
  }

  /** Flies our bullets against what is on screen: they stop at walls and at the first hostile body. */
  private updateGhosts(dt: number, events: GameEvent[]): void {
    const view = this.view;
    const me = view.players.get(this.localPlayerId);
    const team = me?.team ?? 'blue';
    const now = performance.now();
    this.ghostWallHits = this.ghostWallHits.filter((h) => now - h.at < 1500);

    this.ghosts = this.ghosts.filter((g) => {
      const x0 = g.x;
      const y0 = g.y;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.life -= dt;
      const wallT = view.map.raycast(x0, y0, g.x, g.y);
      if (wallT !== null) {
        g.x = x0 + (g.x - x0) * wallT;
        g.y = y0 + (g.y - y0) * wallT;
      }
      const hit = firstHostileHit(view, team, g, x0, y0, (id) => this.anticipation.isGone(id));
      if (hit) {
        const mob = view.enemies.get(hit);
        if (mob) this.anticipation.hitMob(mob, g.damage, g.x, g.y);
        return false;
      }
      if (wallT !== null) {
        events.push({ type: 'wallHit', x: g.x, y: g.y });
        this.ghostWallHits.push({ x: g.x, y: g.y, at: now });
        return false;
      }
      return g.life > 0 && g.x >= 0 && g.y >= 0 && g.x <= view.width && g.y <= view.height;
    });

    // Our bullets are the ghosts: hide the server's copies of them.
    for (const [id, pr] of view.projectiles) {
      if (pr.ownerId === this.localPlayerId && pr.source === 'player') view.projectiles.delete(id);
    }
    for (const g of this.ghosts) {
      view.projectiles.set(g.id, {
        id: g.id, ownerId: this.localPlayerId, team, source: 'player',
        x: g.x, y: g.y, vx: g.vx, vy: g.vy, radius: g.radius,
        life: g.life, damage: 0, ignoresWalls: false, piercesBuildings: false, aimedAt: null,
      });
    }
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

    const delayed: GameEvent[] = [];
    for (const ev of m.ev) {
      if (this.isOwnEvent(ev)) this.instantEvents.push(ev);
      else delayed.push(ev);
    }
    this.frames.push({
      time: m.time,
      winner: m.winner,
      players: new Map(m.pl.map((w) => [w.id, decodePlayer(w)])),
      enemies: new Map(m.en.map((a) => [a[0], decodeEnemy(a)])),
      projectiles: new Map(m.pr.map((a) => [a[0], decodeProjectile(a)])),
      orbs: new Map(m.or.map((a) => [a[0], decodeOrb(a)])),
      towers: new Map(m.tw.map((t) => [t.id, t])),
      nexuses: new Map(m.nx.map((n) => [n.id, n])),
      events: delayed,
      released: false,
    });
    if (this.frames.length > 120) this.frames.splice(0, this.frames.length - 120);
    this.newest = this.frames[this.frames.length - 1];
    this.measureClock(m.time);
    this.reconcile(m);
  }

  /** Things only we care about and that we caused or felt: no reason to show them late. */
  private isOwnEvent(ev: GameEvent): boolean {
    const me = this.localPlayerId;
    switch (ev.type) {
      case 'hit':
      case 'towerHit':
      case 'nexusHit':
      case 'nexusImmune':
        return ev.sourceId === me;
      case 'playerHit':
      case 'levelUp':
      case 'upgrade':
      case 'pickup':
      case 'heal':
      case 'blocked':
        return ev.playerId === me;
      default:
        return false;
    }
  }

  /**
   * Keeps an estimate of the server clock and of how uneven packets arrive.
   * The least delayed snapshots define the clock; the spread of the others sets the blending delay.
   */
  private measureClock(serverTime: number): void {
    const sample = performance.now() / 1000 - serverTime;
    const samples = this.clockSamples;
    samples.push(sample);
    if (samples.length > CLOCK_SAMPLES) samples.shift();
    let min = Infinity;
    for (const s of samples) min = Math.min(min, s);
    this.clockOffset = min;
    const lateness = samples.map((s) => s - min).sort((a, b) => a - b);
    const p90 = lateness[Math.floor(lateness.length * 0.9)] ?? 0;
    const target = Math.max(MIN_INTERP_DELAY, Math.min(MAX_INTERP_DELAY, STEP + p90 + INTERP_MARGIN));
    // Grow fast (a stutter is worse than a bit more delay), shrink slowly.
    this.interpDelay += (target - this.interpDelay) * (target > this.interpDelay ? 0.3 : 0.02);
  }

  /** Server state of our own player + every command it has not applied yet = where we are now. */
  private reconcile(m: SnapshotMessage): void {
    const wire = m.pl.find((p) => p.id === this.localPlayerId);
    if (!wire) return;
    const applied = this.pending.filter((c) => c.seq <= m.ack);
    if (applied.length > 0) this.ackedInput = applied[applied.length - 1].input;
    this.pending = this.pending.filter((c) => c.seq > m.ack);
    const base = decodePlayer(wire);
    // The server detects RMB presses against the last input it applied.
    base.prevAbilityHeld = this.ackedInput?.ability ?? false;
    for (const c of this.pending) this.predictStep(base, c.input, false);

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
    const events: GameEvent[] = this.instantEvents;
    this.instantEvents = [];
    if (frames.length === 0) return events;
    const newest = frames[frames.length - 1];

    // Drawn time = estimated server time minus the adaptive delay, advancing smoothly with the local clock.
    const target = performance.now() / 1000 - this.clockOffset - this.interpDelay;
    if (this.renderTime < 0 || Math.abs(target - this.renderTime) > 0.25) this.renderTime = target;
    else this.renderTime += frameDt + (target - this.renderTime) * Math.min(1, frameDt * 4);
    const time = Math.min(this.renderTime, newest.time);

    let ai = 0;
    while (ai + 1 < frames.length && frames[ai + 1].time <= time) ai++;
    const a = frames[ai];
    const b = frames[Math.min(ai + 1, frames.length - 1)];
    const k = b.time > a.time ? Math.max(0, Math.min(1, (time - a.time) / (b.time - a.time))) : 1;

    const now = performance.now();
    for (const f of frames) {
      if (f.time > time) break;
      if (f.released) continue;
      f.released = true;
      for (const ev of f.events) {
        // Our predicted bullets already sparked on this wall.
        if (ev.type === 'wallHit' && this.ghostWallHits.some((h) => Math.abs(h.x - ev.x) < 40 && Math.abs(h.y - ev.y) < 40)) continue;
        events.push(ev);
      }
    }
    if (ai > 0) frames.splice(0, ai);
    this.ghostWallHits = this.ghostWallHits.filter((h) => now - h.at < 1500);

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
    const predicting = !!p && p.alive && latest.alive;
    if (p && predicting) {
      shown.x = p.x + this.smoothX;
      shown.y = p.y + this.smoothY;
      shown.vx = p.vx;
      shown.vy = p.vy;
      shown.dashTimer = p.dashTimer;
      shown.dashDirX = p.dashDirX;
      shown.dashDirY = p.dashDirY;
      shown.dashCooldown = p.dashCooldown;
      shown.invulnerableTimer = p.invulnerableTimer;
      shown.attackCooldown = p.attackCooldown;
      shown.abilityCooldown = p.abilityCooldown;
      shown.abilityCooldownTotal = p.abilityCooldownTotal;
      shown.shieldTimer = p.shieldTimer;
      shown.shieldArc = p.shieldArc;
      shown.aim = this.latestInput.aim;
    }
    // Hits on us are drawn as soon as we hear about them, not after the blending delay.
    const shift = this.view.time - newest.time;
    shown.lastAttackTime = latest.lastAttackTime + shift;
    shown.lastDamageTime = latest.lastDamageTime + shift;
    // Our sword swing starts the moment we attack.
    const swing = this.localSwing;
    if (swing && predicting) {
      const age = (performance.now() - swing.at) / 1000;
      if (age < 0.5) {
        shown.lastAttackTime = this.view.time - age;
        shown.lastAttackAngle = swing.angle;
      }
    }
    // Our beam follows the cursor right away.
    if (predicting && shown.weapon === 'beam') {
      shown.beam = predictBeam(this.view, shown, this.firing);
    }
    players.set(this.localPlayerId, shown);
  }
}

/**
 * Where our beam ends right now (as the server does it): it burns through every unit and
 * building, and stops only at a wall or at an enemy shield turned towards us.
 */
function predictBeam(view: SnapshotView, p: Player, firing: boolean): Player['beam'] {
  if (!firing) return { ...p.beam, active: false, targetId: null };
  const dirX = Math.cos(p.aim);
  const dirY = Math.sin(p.aim);
  const range = W.beam.range;
  const wallT = view.map.raycast(p.x, p.y, p.x + dirX * range, p.y + dirY * range);
  let reach = wallT === null ? range : range * wallT;
  let targetId: EntityId | null = null;
  for (const v of view.players.values()) {
    if (!v.alive || v.team === p.team || !shieldCovers(v, p.x, p.y)) continue;
    const t = rayCircleDistance(p.x, p.y, dirX, dirY, v.x, v.y, v.radius + A.shield.offset);
    if (t !== null && t < reach) {
      reach = t;
      targetId = v.id;
    }
  }
  return { ...p.beam, active: true, endX: p.x + dirX * reach, endY: p.y + dirY * reach, targetId };
}

/** The first hostile body along the bullet's path this frame (as the server picks the earliest one). */
function firstHostileHit(
  view: SnapshotView, team: TeamId, g: Ghost, x0: number, y0: number, gone: (id: EntityId) => boolean,
): EntityId | null {
  const dx = g.x - x0;
  const dy = g.y - y0;
  const lenSq = dx * dx + dy * dy || 1;
  let best: EntityId | null = null;
  let bestT = Infinity;
  forEachVisibleHostile(view, team, (id, body) => {
    if (gone(id) || !segmentCircleHit(x0, y0, g.x, g.y, body.x, body.y, body.radius + g.radius)) return;
    const t = ((body.x - x0) * dx + (body.y - y0) * dy) / lenSq;
    if (t < bestT) {
      bestT = t;
      best = id;
    }
  });
  return best;
}

/** Hostile bodies as they are drawn: mobs, the opponent (unless dashing), towers and standing nexuses. */
function forEachVisibleHostile(view: SnapshotView, team: TeamId, fn: (id: EntityId, body: Body) => void): void {
  for (const p of view.players.values()) {
    if (p.alive && p.team !== team && p.invulnerableTimer <= 0) fn(p.id, p);
  }
  for (const e of view.enemies.values()) if (e.team !== team) fn(e.id, e);
  for (const t of view.towers.values()) if (t.team !== team) fn(t.id, t);
  for (const n of view.nexuses.values()) if (n.team !== team && n.hp > 0) fn(n.id, n);
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
