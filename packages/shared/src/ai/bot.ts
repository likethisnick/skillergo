import { LANES, depthInto, lanePath, territoryAt, type LaneId } from '../arena';
import { CONFIG } from '../config';
import { distance, length } from '../math/vec2';
import { forEachHostile, getTarget } from '../systems/targets';
import {
  UPGRADE_STATS,
  type Body,
  type EntityId,
  type Player,
  type PlayerInput,
  type TargetKind,
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
 * - push: walk a lane just behind our own wave and kill what comes;
 * - raid: when strong, go for the enemy farmers (lots of XP);
 * - siege: level 10+ -> attack the enemy nexus and its guardians;
 * - retreat: low HP -> back home to regenerate.
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

    if (this.state === 'retreat' ? hp < 0.85 : hp < 0.3) this.state = 'retreat';
    else if (enemy && enemy.alive && territoryAt(arena, enemy.x, enemy.y) === p.team) this.state = 'defend';
    else if (p.level >= world.server.nexusUnlockLevel) this.state = 'siege';
    else if (p.level >= 4 && hp > 0.75 && (!enemy || !enemy.alive || distance(p.x, p.y, enemy.x, enemy.y) > 1500)) this.state = 'raid';
    else this.state = 'push';

    // Occasionally switch lanes while pushing, like a player rotating.
    if (this.state === 'push' && world.rng.next() < 0.004) this.lane = LANES[Math.floor(world.rng.next() * LANES.length)];

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

    // Nearest threat or prey. Players and farmers are worth more than mobs.
    const range = this.state === 'retreat' ? 500 : 750;
    let best: { kind: TargetKind; id: EntityId } | null = null;
    let bestScore = Infinity;
    forEachHostile(world, p.team, (kind, id, body) => {
      const d = distance(p.x, p.y, body.x, body.y);
      if (d > range || !world.map.lineOfSight(p.x, p.y, body.x, body.y)) return;
      let score = d;
      if (kind === 'player') score *= 0.6;
      const e = kind === 'enemy' ? world.enemies.get(id) : undefined;
      if (e?.role === 'farmer') score *= 0.5;
      if (e?.boss && p.level < 8) score *= 3; // avoid bosses while weak
      if (score < bestScore) {
        bestScore = score;
        best = { kind, id };
      }
    }, { players: true, enemies: true });
    return best;
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
    } else if (this.state === 'siege' || this.state === 'raid') {
      const n = arena.nexus[p.team === 'blue' ? 'red' : 'blue'];
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
      if (p.ability === 'hook') wantAbility = d > 200 && d < 600 && this.target?.kind !== 'nexus';
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
