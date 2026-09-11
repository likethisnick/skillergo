import { LANES, depthInto, lanePath, territoryAt, type LaneId } from '../arena';
import { CONFIG } from '../config';
import { distance, distanceSq, length } from '../math/vec2';
import { forEachHostile, getTarget } from '../systems/targets';
import {
  UPGRADE_STATS,
  otherTeam,
  type Body,
  type EntityId,
  type Player,
  type PlayerInput,
  type TargetKind,
  type TeamId,
  type Tower,
  type UpgradeRanks,
} from '../types';
import type { World } from '../world';

type BotState = 'push' | 'defend' | 'retreat' | 'siege' | 'raid';

/** Engage and shooting ranges per weapon. */
const WEAPON_RANGE = {
  gun: { keep: 520, fire: 820 },
  beam: { keep: 400, fire: 500 },
  sword: { keep: 80, fire: 120 },
} as const;

/**
 * The AI opponent. It sees the world like a player and answers with the same
 * `PlayerInput` a human client sends, so a real player can replace it later
 * without touching the simulation.
 *
 * Behaviour:
 * - defend: an enemy player is on our half -> go and push him out;
 * - push: walk a lane just behind our own wave, kill what comes, hit towers our mobs tank;
 * - raid: when strong, go for the enemy farmers (lots of XP);
 * - siege: the lane's enemy towers are down -> attack the enemy nexus and its guardians;
 * - retreat: low HP -> back home to regenerate.
 * It never stands in an enemy tower's fire without mobs to tank it.
 */
export class BotBrain {
  private state: BotState = 'push';
  private lane: LaneId;
  private target: { kind: TargetKind; id: EntityId } | null = null;
  private thinkTimer = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private aimError = 0;
  private aimErrorTimer = 0;
  private lastAbility = false;
  private dashSeq = 0;
  private dashX = 0;
  private dashY = 0;
  private upgrades: UpgradeRanks = { weapon: 0, mobility: 0, ability: 0 };
  /** 0..1 from the difficulty slider: aim, dodging, decisions. */
  private readonly skill: number;

  constructor(world: World, _player: Player) {
    this.skill = Math.min(1, Math.max(0, (world.settings.difficulty - 1) / 29));
    this.lane = LANES[Math.floor(world.rng.next() * LANES.length)];
  }

  update(world: World, p: Player, dt: number): PlayerInput {
    const input: PlayerInput = {
      moveX: 0,
      moveY: 0,
      aim: p.aim,
      fire: false,
      ability: false,
      dashSeq: this.dashSeq,
      dashX: this.dashX,
      dashY: this.dashY,
      upgrades: { ...this.upgrades },
    };
    if (!p.alive || world.winner) return input;

    this.spendUpgrades(world, p);
    input.upgrades = { ...this.upgrades };

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.25;
      this.think(world, p);
    }

    const target = this.target ? getTarget(world, this.target.kind, this.target.id) : undefined;
    if (!target) this.target = null;

    this.move(world, p, target, input, dt);
    if (target) this.attack(world, p, target, input, dt);
    this.dodge(world, p, input);
    input.dashSeq = this.dashSeq;
    input.dashX = this.dashX;
    input.dashY = this.dashY;
    return input;
  }

  // ------------------------------------------------------------- decisions

  private think(world: World, p: Player): void {
    const arena = world.arena!;
    const hp = p.hp / p.maxHp;
    const enemy = [...world.players.values()].find((o) => o.team !== p.team);

    const foe = otherTeam(p.team);
    const openLane = LANES.find((lane) => towersLeft(world, foe, lane) === 0);
    if (this.state === 'retreat' ? hp < 0.85 : hp < 0.3) this.state = 'retreat';
    else if (enemy && enemy.alive && territoryAt(arena, enemy.x, enemy.y) === p.team) this.state = 'defend';
    else if (openLane && p.level >= 5 && hp > 0.5) {
      this.state = 'siege';
      this.lane = openLane;
    } else if (p.level >= 4 && hp > 0.75 && (!enemy || !enemy.alive || distance(p.x, p.y, enemy.x, enemy.y) > 1500) && !this.towerThreat(world, p)) {
      this.state = 'raid';
    } else this.state = 'push';

    // Occasionally switch lanes while pushing, like a player rotating; prefer lanes with fewer enemy towers.
    if (this.state === 'push' && world.rng.next() < 0.004) {
      const lanes = [...LANES].sort((a, b) => towersLeft(world, foe, a) - towersLeft(world, foe, b));
      this.lane = world.rng.next() < 0.6 ? lanes[0] : LANES[Math.floor(world.rng.next() * LANES.length)];
    }

    this.target = this.pickTarget(world, p, enemy);
  }

  private pickTarget(world: World, p: Player, enemy: Player | undefined): { kind: TargetKind; id: EntityId } | null {
    if (this.state === 'defend' && enemy && enemy.alive) return { kind: 'player', id: enemy.id };

    if (this.state === 'siege') {
      for (const n of world.nexuses.values()) {
        if (n.team === p.team || n.hp <= 0 && n.guardianId === null) continue;
        if (n.guardianId !== null && world.enemies.has(n.guardianId)) {
          if (distance(p.x, p.y, n.x, n.y) < 1800) return { kind: 'enemy', id: n.guardianId };
        } else if (distance(p.x, p.y, n.x, n.y) < 900) {
          return { kind: 'nexus', id: n.id };
        }
      }
    }

    // Nearest threat or prey. Players and farmers are worth more than mobs;
    // towers only while our mobs soak their shots (or they are almost down).
    const range = this.state === 'retreat' ? 500 : 750;
    let best: { kind: TargetKind; id: EntityId } | null = null;
    let bestScore = Infinity;
    forEachHostile(world, p.team, (kind, id, body) => {
      const d = distance(p.x, p.y, body.x, body.y) - (kind === 'tower' ? body.radius : 0);
      if (d > range || !world.map.lineOfSight(p.x, p.y, body.x, body.y)) return;
      let score = d;
      if (kind === 'player') score *= 0.6;
      const e = kind === 'enemy' ? world.enemies.get(id) : undefined;
      if (e?.role === 'farmer') score *= 0.5;
      if (e?.boss && p.level < 8) score *= 3; // avoid bosses while weak
      if (kind === 'tower') {
        const t = world.towers.get(id)!;
        if (!this.canHitTower(world, p, t)) return;
        score *= 0.9;
      }
      if (score < bestScore) {
        bestScore = score;
        best = { kind, id };
      }
    }, { players: true, enemies: true, buildings: true });
    return best;
  }

  /** Safe to shoot at this tower: our mobs are in its range, or it is nearly down and we are healthy. */
  private canHitTower(world: World, p: Player, t: Readonly<Tower>): boolean {
    if (t.targetKind === 'player' && t.targetId === p.id) return t.hp / t.maxHp < 0.2 && p.hp / p.maxHp > 0.5;
    return alliedMobsNear(world, p.team, t, world.server.towerRange) >= 1 || (t.hp / t.maxHp < 0.2 && p.hp / p.maxHp > 0.6);
  }

  /** An enemy tower that would shoot us where we stand (no mobs of ours to take its fire). */
  private towerThreat(world: World, p: Player): Readonly<Tower> | null {
    const range = world.server.towerRange + p.radius + 120;
    for (const t of world.towers.values()) {
      if (t.team === p.team || distanceSq(p.x, p.y, t.x, t.y) > range * range) continue;
      if (t.targetKind === 'player' && t.targetId === p.id) return t;
      if (!this.canHitTower(world, p, t) && alliedMobsNear(world, p.team, t, world.server.towerRange) === 0) return t;
    }
    return null;
  }

  private spendUpgrades(world: World, p: Player): void {
    const spent = this.upgrades.weapon + this.upgrades.mobility + this.upgrades.ability;
    const available = p.upgradePoints + (p.ranks.weapon + p.ranks.mobility + p.ranks.ability) - spent;
    if (p.upgradePoints <= 0 || available <= 0) return;
    // Mostly weapon, some mobility and ability.
    const roll = world.rng.next();
    const stat = roll < 0.5 ? 'weapon' : roll < 0.75 ? 'mobility' : 'ability';
    if (p.ranks[stat] < CONFIG.upgrades.maxRank) this.upgrades[stat]++;
    else this.upgrades[UPGRADE_STATS.find((s) => p.ranks[s] < CONFIG.upgrades.maxRank) ?? 'weapon']++;
  }

  // -------------------------------------------------------------- movement

  private move(world: World, p: Player, target: Body | undefined, input: PlayerInput, dt: number): void {
    const arena = world.arena!;
    const keep = WEAPON_RANGE[p.weapon].keep;

    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = world.rng.range(0.6, 1.6);
      this.strafeDir = world.rng.next() < 0.5 ? -1 : 1;
    }

    // Out of an enemy tower's fire first; keep shooting whatever is in range meanwhile.
    const threat = this.towerThreat(world, p);
    if (threat) {
      const d = distance(p.x, p.y, threat.x, threat.y) || 1;
      input.moveX = (p.x - threat.x) / d - ((p.y - threat.y) / d) * this.strafeDir * 0.3;
      input.moveY = (p.y - threat.y) / d + ((p.x - threat.x) / d) * this.strafeDir * 0.3;
      if (this.state === 'raid') this.state = 'push';
      return;
    }

    let goal: { x: number; y: number };
    if (this.state === 'retreat') {
      goal = arena.spawn[p.team];
    } else if (target) {
      const d = distance(p.x, p.y, target.x, target.y) || 1;
      const toX = (target.x - p.x) / d;
      const toY = (target.y - p.y) / d;
      if (d > keep + 60 || !world.map.lineOfSight(p.x, p.y, target.x, target.y)) {
        goal = { x: target.x, y: target.y };
      } else {
        // In range: back off if too close, otherwise circle to be harder to hit.
        const back = d < keep - 60 ? -1 : 0;
        input.moveX = toX * back - toY * this.strafeDir * 0.8;
        input.moveY = toY * back + toX * this.strafeDir * 0.8;
        return;
      }
    } else if (this.state === 'siege') {
      // Down the open lane to the enemy hub, then to the nexus.
      const path = lanePath(arena, this.lane, p.team);
      const n = arena.nexus[otherTeam(p.team)];
      const hub = path[path.length - 1];
      const nearHub = distance(p.x, p.y, hub.x, hub.y) < 900;
      goal = nearHub ? { x: n.x + (p.x - n.x) * 0.15, y: n.y + (p.y - n.y) * 0.15 } : this.nextLanePoint(p, path);
    } else if (this.state === 'raid') {
      const n = arena.nexus[otherTeam(p.team)];
      goal = { x: n.x + (p.x - n.x) * 0.15, y: n.y + (p.y - n.y) * 0.15 };
    } else {
      goal = this.laneFront(world, p);
    }

    const dir = this.pathTo(world, p, goal.x, goal.y);
    if (dir) {
      input.moveX = dir.x;
      input.moveY = dir.y;
    }
  }

  /** Where to stand while pushing: a little behind our frontmost mob on the lane. */
  private laneFront(world: World, p: Player): { x: number; y: number } {
    const arena = world.arena!;
    let front: { x: number; y: number } | null = null;
    let bestDepth = Infinity;
    for (const e of world.enemies.values()) {
      if (e.team !== p.team || e.role !== 'wave' || e.lane !== this.lane) continue;
      const depth = depthInto(p.team, e.x, e.y);
      if (depth < bestDepth) {
        bestDepth = depth;
        front = e;
      }
    }
    const path = lanePath(arena, this.lane, p.team);
    if (!front) {
      // No wave out: wait at the edge of our half on this lane.
      const mid = path[Math.floor(path.length / 2)];
      return { x: (path[0].x + mid.x) / 2, y: (path[0].y + mid.y) / 2 };
    }
    const home = path[0];
    const d = distance(front.x, front.y, home.x, home.y) || 1;
    return { x: front.x + ((home.x - front.x) / d) * 160, y: front.y + ((home.y - front.y) / d) * 160 };
  }

  /** The first lane waypoint that is still ahead of us (deeper into enemy ground). */
  private nextLanePoint(p: Player, path: readonly { x: number; y: number }[]): { x: number; y: number } {
    const myDepth = depthInto(p.team, p.x, p.y);
    for (const point of path) {
      if (depthInto(p.team, point.x, point.y) < myDepth - 150) return point;
    }
    return path[path.length - 1];
  }

  private pathTo(world: World, p: Player, gx: number, gy: number): { x: number; y: number } | null {
    const d = distance(p.x, p.y, gx, gy);
    if (d < 30) return null;
    if (world.map.lineOfSight(p.x, p.y, gx, gy)) return { x: (gx - p.x) / d, y: (gy - p.y) / d };
    return world.pathStepTo(gx, gy, p.x, p.y) ?? { x: (gx - p.x) / d, y: (gy - p.y) / d };
  }

  // ---------------------------------------------------------------- combat

  private attack(world: World, p: Player, target: Body, input: PlayerInput, dt: number): void {
    const d = distance(p.x, p.y, target.x, target.y);
    // Human-like aim: a steady error that changes a few times per second, smaller on higher difficulty.
    this.aimErrorTimer -= dt;
    if (this.aimErrorTimer <= 0) {
      this.aimErrorTimer = 0.35;
      const maxError = 0.04 + 0.3 * (1 - this.skill);
      this.aimError = world.rng.range(-maxError, maxError);
    }
    const bulletSpeed = world.server.bulletSpeed * world.server.playerBulletSpeedMultiplier;
    const lead = p.weapon === 'gun' ? (d / bulletSpeed) * (0.3 + 0.7 * this.skill) : 0;
    input.aim = Math.atan2(target.y + target.vy * lead - p.y, target.x + target.vx * lead - p.x) + this.aimError;

    const clear = world.map.lineOfSight(p.x, p.y, target.x, target.y);
    input.fire = clear && d <= WEAPON_RANGE[p.weapon].fire + target.radius;

    let wantAbility = false;
    if (p.abilityUnlocked && p.abilityCooldown <= 0 && clear) {
      const building = this.target?.kind === 'nexus' || this.target?.kind === 'tower';
      if (p.ability === 'hook') wantAbility = d > 200 && d < 600 && !building;
      else if (p.ability === 'shotgun') wantAbility = d < 280;
      else wantAbility = p.hp / p.maxHp < 0.7 && d < 700;
    }
    input.ability = wantAbility && !this.lastAbility;
    this.lastAbility = input.ability;
  }

  /** Dash sideways out of an incoming bullet's path, more often on higher difficulty. */
  private dodge(world: World, p: Player, input: PlayerInput): void {
    if (p.dashCooldown > 0) return;
    for (const pr of world.projectiles.values()) {
      if (pr.team === p.team) continue;
      const dx = p.x - pr.x;
      const dy = p.y - pr.y;
      const d = length(dx, dy);
      if (d > 220) continue;
      const speed = length(pr.vx, pr.vy) || 1;
      const closing = (dx * pr.vx + dy * pr.vy) / (d * speed);
      if (closing < 0.9) continue;
      if (world.rng.next() > 0.08 + 0.35 * this.skill) return; // missed the moment
      const side = world.rng.next() < 0.5 ? -1 : 1;
      this.dashX = (-pr.vy / speed) * side;
      this.dashY = (pr.vx / speed) * side;
      this.dashSeq++;
      return;
    }
    // Escape dash when retreating under fire.
    if (this.state === 'retreat' && world.time - p.lastDamageTime < 0.5 && (input.moveX || input.moveY)) {
      this.dashX = input.moveX;
      this.dashY = input.moveY;
      this.dashSeq++;
    }
  }
}

function towersLeft(world: World, team: TeamId, lane: LaneId): number {
  let n = 0;
  for (const t of world.towers.values()) if (t.team === team && t.lane === lane) n++;
  return n;
}

/** Our lane mobs within `range` of a point (they soak tower shots). */
function alliedMobsNear(world: World, team: TeamId, at: { x: number; y: number }, range: number): number {
  let n = 0;
  for (const e of world.enemies.values()) {
    if (e.team === team && !e.boss && e.role !== 'farmer' && distanceSq(e.x, e.y, at.x, at.y) <= range * range) n++;
  }
  return n;
}
