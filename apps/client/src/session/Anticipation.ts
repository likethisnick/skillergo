import {
  BOSS_KINDS,
  CONFIG,
  circleInCone,
  segmentCircleHit,
  type Body,
  type Enemy,
  type EntityId,
  type GameEvent,
  type Player,
  type Projectile,
  type TeamId,
} from '@skillergo/shared';
import type { SnapshotView } from '../net/SnapshotView';

/** Unconfirmed local damage is forgotten after this long (the server did not agree). */
const PENDING_DAMAGE_MS = 1000;
/** A mob we "killed" locally comes back if the server still has it after this long. */
const REVIVE_AFTER_MS = 900;
/** An orb we "picked up" locally comes back if the server still has it after this long. */
const ORB_REVIVE_AFTER_MS = 700;
/** A bullet we "cut" locally comes back if the server still has it after this long. */
const CUT_REVIVE_AFTER_MS = 500;
/** New enemy bullets glide from the muzzle to their look-ahead position over this time. */
const LEAD_RAMP_SECONDS = 0.12;
/** Look-ahead never exceeds this (a very bad connection would make bullets jump around). */
const MAX_LEAD_SECONDS = 0.2;

const O = CONFIG.orb;
const SWORD = CONFIG.weapons.sword;
const BOSSES: readonly string[] = BOSS_KINDS;

/**
 * Purely visual anticipation of what the server is about to decide, so our own actions look
 * instant. The server still decides everything: damage, cut bullets, pickups and deaths.
 * When it disagrees (rare), the picture quietly corrects itself.
 *
 * - our hits show damage numbers and lower HP bars right away; a finishing hit pops the mob;
 * - enemy bullets are drawn where they will be when our input reaches the server, so dodging,
 *   cutting them with the sword and getting hit match what we see;
 * - XP orbs fly to where we really are and vanish on touch.
 */
export class Anticipation {
  private readonly pendingDamage = new Map<EntityId, { damage: number; at: number }[]>();
  private readonly deadMobs = new Map<EntityId, number>();
  private readonly cutBullets = new Map<EntityId, number>();
  private readonly bulletSeen = new Map<EntityId, number>();
  private readonly pulledOrbs = new Map<EntityId, { x: number; y: number; speed: number }>();
  private readonly takenOrbs = new Map<EntityId, number>();
  /** Local "+XP" texts already shown, waiting for the server's pickup events. */
  private pickupTexts: number[] = [];
  /** Server hits of ours that came before our own bullet reached the target on screen. */
  private readonly earlyHits = new Map<EntityId, { damage: number; at: number }[]>();
  /** Things the server kept after we guessed otherwise: no more guessing about them. */
  private readonly distrust = new Set<EntityId>();
  /** Local events produced since the last frame (numbers, pops, sparks). */
  private out: GameEvent[] = [];

  constructor(private readonly me: EntityId) {}

  /** Drops what was already shown locally from the server's events. */
  filterServerEvents(events: GameEvent[]): GameEvent[] {
    const now = performance.now();
    this.pickupTexts = this.pickupTexts.filter((at) => now - at < 1500);
    return events.filter((ev) => {
      switch (ev.type) {
        case 'hit':
          if (ev.sourceId !== this.me) return true;
          if (this.confirmDamage(ev.targetId, ev.damage)) return false;
          this.remember(this.earlyHits, ev.targetId, ev.damage, now);
          return true;
        case 'kill':
          return !this.deadMobs.has(ev.targetId);
        case 'bulletCut':
        case 'shotgun':
          return ev.playerId !== this.me;
        case 'pickup':
          if (ev.playerId !== this.me || this.pickupTexts.length === 0) return true;
          this.pickupTexts.shift();
          return false;
        default:
          return true;
      }
    });
  }

  /** A mob or building that is already gone on our screen: our bullets fly through it. */
  isGone(id: EntityId): boolean {
    return this.deadMobs.has(id);
  }

  /** Our bullet, sword or shotgun hit a mob on our screen. */
  hitMob(enemy: Readonly<Enemy>, damage: number, x: number, y: number): void {
    const amount = Math.round(damage);
    if (this.distrust.has(enemy.id)) return;
    // The server already reported this very hit: it is on screen, nothing to anticipate.
    const early = this.earlyHits.get(enemy.id);
    const i = early ? early.findIndex((d) => Math.abs(d.damage - amount) <= 1) : -1;
    if (early && i >= 0) {
      early.splice(i, 1);
      return;
    }
    this.remember(this.pendingDamage, enemy.id, amount, performance.now());
    this.out.push({ type: 'hit', targetId: enemy.id, sourceId: this.me, x, y, damage: amount });
  }

  private remember(map: Map<EntityId, { damage: number; at: number }[]>, id: EntityId, damage: number, at: number): void {
    const list = map.get(id) ?? [];
    list.push({ damage, at });
    map.set(id, list);
  }

  /** Every hostile mob inside a swing / blast cone takes the hit. */
  hitMobsInCone(view: SnapshotView, p: Readonly<Player>, angle: number, arc: number, range: number, damage: number): void {
    for (const e of view.enemies.values()) {
      if (e.team === p.team || this.deadMobs.has(e.id)) continue;
      if (!circleInCone(p.x, p.y, angle, arc, range, e.x, e.y, e.radius)) continue;
      if (!view.map.lineOfSight(p.x, p.y, e.x, e.y)) continue;
      this.hitMob(e, damage, e.x, e.y);
    }
  }

  /**
   * Adjusts the view drawn this frame and adds the local events to `events`.
   * `newest` holds the latest server state of every mob (fresher than the drawn one).
   * `lead` is how far ahead enemy bullets are drawn (blending delay + half the ping).
   */
  apply(
    view: SnapshotView,
    newestMobs: ReadonlyMap<EntityId, Enemy>,
    newestBullets: ReadonlyMap<EntityId, Projectile>,
    newestOrbs: ReadonlyMap<EntityId, unknown>,
    dt: number,
    lead: number,
    swing: { angle: number; age: number } | null,
    events: GameEvent[],
  ): void {
    const now = performance.now();
    const me = view.players.get(this.me);
    const team: TeamId = me?.team ?? 'blue';
    this.expire(now, newestMobs, newestBullets, newestOrbs);
    this.applyMobs(view, newestMobs, now);
    this.applyBullets(view, me, team, lead, swing, now);
    if (me?.alive) this.applyOrbs(view, me, dt, now);
    for (const ev of this.out) events.push(ev);
    this.out = [];
  }

  // ----------------------------------------------------------------- mobs

  private confirmDamage(targetId: EntityId, damage: number): boolean {
    const list = this.pendingDamage.get(targetId);
    if (!list) return false;
    const i = list.findIndex((d) => Math.abs(d.damage - damage) <= 1);
    if (i < 0) return false;
    list.splice(i, 1);
    if (list.length === 0) this.pendingDamage.delete(targetId);
    return true;
  }

  private applyMobs(view: SnapshotView, newestMobs: ReadonlyMap<EntityId, Enemy>, now: number): void {
    for (const [id, e] of view.enemies) {
      if (this.deadMobs.has(id)) {
        view.enemies.delete(id);
        continue;
      }
      const pending = this.pendingDamage.get(id);
      if (!pending) continue;
      let sum = 0;
      for (const d of pending) sum += d.damage;
      const fresh = newestMobs.get(id);
      const hp = Math.max(0, Math.min(e.hp, fresh?.hp ?? e.hp) - sum);
      if (hp > 0) {
        view.enemies.set(id, { ...e, hp, hitFlash: Math.max(e.hitFlash, 0.06) });
        continue;
      }
      // A finishing blow: pop it now, the server's kill will be skipped.
      this.deadMobs.set(id, now);
      view.enemies.delete(id);
      this.out.push({ type: 'kill', targetId: id, killerId: this.me, x: e.x, y: e.y, kind: e.kind });
    }
  }

  // -------------------------------------------------------------- bullets

  private applyBullets(
    view: SnapshotView, me: Readonly<Player> | undefined, team: TeamId, lead: number,
    swing: { angle: number; age: number } | null, now: number,
  ): void {
    const L = Math.max(0, Math.min(MAX_LEAD_SECONDS, lead));
    const cutting = !!me && me.alive && me.weapon === 'sword' && swing !== null && swing.age < SWORD.swingTime;
    for (const [id, pr] of view.projectiles) {
      if (id < 0 || pr.team === team) continue; // our own predicted bullets and friendly fire
      if (this.cutBullets.has(id)) {
        view.projectiles.delete(id);
        continue;
      }
      const trusted = !this.distrust.has(id);
      const seen = this.bulletSeen.get(id) ?? now;
      this.bulletSeen.set(id, seen);
      const k = Math.min(1, (now - seen) / 1000 / LEAD_RAMP_SECONDS);
      const ahead = this.lookAhead(view, me, team, pr, L * k);
      if (!ahead) {
        view.projectiles.delete(id); // it has already hit something of ours by now
        continue;
      }
      const shown = { ...pr, x: ahead.x, y: ahead.y };
      if (cutting && trusted && me && swing && this.inSwing(view, me, swing.angle, shown)) {
        this.cutBullets.set(id, now);
        view.projectiles.delete(id);
        this.out.push({ type: 'bulletCut', playerId: this.me, x: shown.x, y: shown.y });
        continue;
      }
      view.projectiles.set(id, shown);
    }
  }

  /** Where the bullet will be `t` seconds later, or null if it hits something of our team first. */
  private lookAhead(
    view: SnapshotView, me: Readonly<Player> | undefined, team: TeamId, pr: Readonly<Projectile>, t: number,
  ): { x: number; y: number } | null {
    let x = pr.x + pr.vx * t;
    let y = pr.y + pr.vy * t;
    if (t <= 0) return { x, y };
    const throughWalls = pr.source === 'sniper' || BOSSES.includes(pr.source);
    if (!throughWalls) {
      const wallT = view.map.raycast(pr.x, pr.y, x, y);
      if (wallT !== null) {
        x = pr.x + (x - pr.x) * wallT;
        y = pr.y + (y - pr.y) * wallT;
      }
    }
    const blocked = (body: Readonly<Body>): boolean =>
      segmentCircleHit(pr.x, pr.y, x, y, body.x, body.y, body.radius + pr.radius);
    if (me && me.alive && me.invulnerableTimer <= 0 && blocked(me)) return null;
    for (const e of view.enemies.values()) if (e.team === team && blocked(e)) return null;
    if (pr.source !== 'sniper') {
      for (const b of view.towers.values()) if (b.team === team && blocked(b)) return null;
      for (const b of view.nexuses.values()) if (b.team === team && b.hp > 0 && blocked(b)) return null;
    }
    return { x, y };
  }

  private inSwing(view: SnapshotView, me: Readonly<Player>, angle: number, pr: Readonly<Projectile>): boolean {
    return BOSSES.includes(pr.source) === false
      && circleInCone(me.x, me.y, angle, SWORD.arc, SWORD.range, pr.x, pr.y, pr.radius)
      && view.map.lineOfSight(me.x, me.y, pr.x, pr.y);
  }

  // ----------------------------------------------------------------- orbs

  private applyOrbs(view: SnapshotView, me: Readonly<Player>, dt: number, now: number): void {
    for (const [id, orb] of view.orbs) {
      if (this.takenOrbs.has(id)) {
        view.orbs.delete(id);
        continue;
      }
      if (orb.denyTeam === me.team || orb.kind === 'power' || this.distrust.has(id)) continue;
      if (orb.kind === 'heal' && me.hp >= me.maxHp) {
        this.pulledOrbs.delete(id);
        continue;
      }
      let pull = this.pulledOrbs.get(id);
      if (!pull) {
        const d = Math.hypot(orb.x - me.x, orb.y - me.y);
        if (d > O.magnetRadius || this.opponentIsCloser(view, me, orb.x, orb.y, d, orb.denyTeam)) continue;
        pull = { x: orb.x, y: orb.y, speed: O.magnetStartSpeed };
        this.pulledOrbs.set(id, pull);
      }
      pull.speed += O.magnetAcceleration * dt;
      const dx = me.x - pull.x;
      const dy = me.y - pull.y;
      const dist = Math.hypot(dx, dy);
      const step = pull.speed * dt;
      if (dist <= me.radius || dist <= step) {
        this.takenOrbs.set(id, now);
        this.pulledOrbs.delete(id);
        view.orbs.delete(id);
        if (orb.kind === 'xp') {
          this.out.push({ type: 'pickup', playerId: this.me, xp: orb.xp });
          this.pickupTexts.push(now);
        }
        continue;
      }
      pull.x += (dx / dist) * step;
      pull.y += (dy / dist) * step;
      view.orbs.set(id, { ...orb, x: pull.x, y: pull.y });
    }
  }

  /** The enemy player would grab this orb first: leave it to the server. */
  private opponentIsCloser(view: SnapshotView, me: Readonly<Player>, x: number, y: number, d: number, deny: TeamId | null): boolean {
    for (const p of view.players.values()) {
      if (p.id === this.me || !p.alive || p.team === deny || p.team === me.team) continue;
      if (Math.hypot(p.x - x, p.y - y) < d) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ bookkeeping

  /** Forgets old guesses; brings back whatever the server kept alive. */
  private expire(
    now: number,
    newestMobs: ReadonlyMap<EntityId, Enemy>,
    newestBullets: ReadonlyMap<EntityId, Projectile>,
    newestOrbs: ReadonlyMap<EntityId, unknown>,
  ): void {
    expireList(this.pendingDamage, now, PENDING_DAMAGE_MS);
    expireList(this.earlyHits, now, 250);
    const revived = (id: EntityId): void => {
      this.distrust.add(id);
      this.pendingDamage.delete(id);
    };
    reviveOrForget(this.deadMobs, newestMobs, now, REVIVE_AFTER_MS, revived);
    reviveOrForget(this.cutBullets, newestBullets, now, CUT_REVIVE_AFTER_MS, revived);
    reviveOrForget(this.takenOrbs, newestOrbs, now, ORB_REVIVE_AFTER_MS, revived);
    for (const id of this.bulletSeen.keys()) if (!newestBullets.has(id)) this.bulletSeen.delete(id);
    for (const id of this.pulledOrbs.keys()) if (!newestOrbs.has(id)) this.pulledOrbs.delete(id);
    for (const id of this.distrust) {
      if (!newestMobs.has(id) && !newestBullets.has(id) && !newestOrbs.has(id)) this.distrust.delete(id);
    }
  }
}

function expireList(map: Map<EntityId, { at: number }[]>, now: number, ms: number): void {
  for (const [id, list] of map) {
    const alive = list.filter((d) => now - d.at < ms);
    if (alive.length === 0) map.delete(id);
    else if (alive.length !== list.length) map.set(id, alive);
  }
}

/**
 * A guess stays while the server still shows the thing only for a short grace period
 * (then it comes back, and `revived` is called); once the server confirms (the thing is
 * gone), the guess is forgotten a bit later.
 */
function reviveOrForget(
  guesses: Map<EntityId, number>, server: ReadonlyMap<EntityId, unknown>, now: number, grace: number,
  revived: (id: EntityId) => void,
): void {
  for (const [id, at] of guesses) {
    const age = now - at;
    if (server.has(id) && age > grace) {
      guesses.delete(id);
      revived(id);
    } else if (!server.has(id) && age > 3000) {
      guesses.delete(id);
    }
  }
}
