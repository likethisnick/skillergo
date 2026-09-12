import { CONFIG } from '../config';
import { circleInCone, distanceSq, wrapAngle } from '../math/vec2';
import { abilityDamage, abilityScaling } from '../stats';
import type { ServerConfig } from '../server.config';
import type { EntityId, Player, TargetKind } from '../types';
import type { World } from '../world';
import { throwHook, updateHook } from './hook';
import { canBeTargeted, damageTarget, forEachHostile } from './targets';

const A = CONFIG.abilities;
const EPS = 1e-6;
/** The shield can grow with upgrades but never becomes a full circle. */
export const MAX_SHIELD_ARC = (270 * Math.PI) / 180;
export const MAX_SHOTGUN_ARC = (110 * Math.PI) / 180;

/** Reach, width and damage of this player's shotgun blast (the client predicts it with the same numbers). */
export function shotgunCone(
  p: Readonly<Player>,
  server: Readonly<ServerConfig>,
): { range: number; arc: number; damage: number } {
  const s = abilityScaling(p);
  return {
    range: A.shotgun.range * s.radius,
    arc: Math.min(MAX_SHOTGUN_ARC, A.shotgun.arc * (1 + (s.radius - 1) / 2)),
    damage: abilityDamage(p, server.shotgunDamage),
  };
}

/** RMB press. Does nothing while locked or on cooldown. */
export function tryUseAbility(world: World, p: Player): void {
  if (!p.abilityUnlocked || p.abilityCooldown > EPS) return;
  const s = abilityScaling(p);

  switch (p.ability) {
    case 'hook':
      const hookDamage = abilityDamage(p, world.server.hookDamage);
      if (throwHook(p, A.hook.range * s.radius, A.hook.speed * s.speed, A.hook.pullSpeed * s.speed, hookDamage)) {
        startCooldown(p, A.hook.cooldown * s.cooldown);
      }
      break;
    case 'shield': {
      const duration = A.shield.duration * s.power;
      p.shieldTimer = duration;
      p.shieldArc = Math.min(MAX_SHIELD_ARC, A.shield.arc * s.radius);
      // Cooldown counts from the moment the shield expires.
      startCooldown(p, duration + A.shield.cooldown * s.cooldown, A.shield.cooldown * s.cooldown);
      break;
    }
    case 'shotgun':
      fireShotgun(world, p);
      startCooldown(p, A.shotgun.cooldown * s.cooldown);
      break;
    case 'cloak':
      p.cloakTimer = A.cloak.duration * s.power;
      world.emit({ type: 'cloak', playerId: p.id, on: true });
      startCooldown(p, p.cloakTimer + A.cloak.cooldown * s.cooldown, A.cloak.cooldown * s.cooldown);
      break;
    case 'rally':
      rallyMobs(world, p);
      startCooldown(p, A.rally.cooldown * s.cooldown);
      break;
    case 'whirlwind':
      spin(world, p);
      startCooldown(p, A.whirlwind.cooldown * s.cooldown);
      break;
  }
}

/** Invisibility ends the moment the marksman attacks. */
export function breakCloak(world: World, p: Player): void {
  if (p.cloakTimer <= 0) return;
  p.cloakTimer = 0;
  world.emit({ type: 'cloak', playerId: p.id, on: false });
}

/**
 * Summoner: own mobs around him get faster and hit harder for a while and go
 * for whatever his cursor points at (the nearest hostile to it, if any).
 */
function rallyMobs(world: World, p: Player): void {
  const C = A.rally;
  const s = abilityScaling(p);
  const radius = C.radius * s.radius;
  const duration = C.duration * s.power;
  const markX = p.x + Math.cos(p.aim) * radius;
  const markY = p.y + Math.sin(p.aim) * radius;

  // What the cursor marks: the closest hostile to that point.
  let mark: { kind: TargetKind; id: EntityId; x: number; y: number } | null = null;
  let best = (C.markRadius * s.radius) ** 2;
  forEachHostile(world, p.team, (kind, id, body) => {
    if (!canBeTargeted(world, kind, id)) return;
    const d = distanceSq(body.x, body.y, markX, markY);
    if (d < best) {
      best = d;
      mark = { kind, id, x: body.x, y: body.y };
    }
  });
  const target = mark as { kind: TargetKind; id: EntityId; x: number; y: number } | null;

  let count = 0;
  for (const e of world.enemies.values()) {
    if (e.team !== p.team || e.boss || e.role === 'farmer') continue;
    if (distanceSq(e.x, e.y, p.x, p.y) > radius * radius) continue;
    e.rallyTimer = duration;
    if (target) {
      e.targetKind = target.kind;
      e.targetId = target.id;
      // Hold the marked target while the buff lasts instead of re-picking every 0.3 s.
      e.retargetTimer = duration;
    }
    count++;
  }
  p.rallyX = target ? target.x : markX;
  p.rallyY = target ? target.y : markY;
  world.emit({ type: 'rally', playerId: p.id, x: p.rallyX, y: p.rallyY, radius, count });
}

/** Bastard: one sweep that hits everything around him. */
function spin(world: World, p: Player): void {
  const C = A.whirlwind;
  const s = abilityScaling(p);
  const radius = C.radius * s.radius;
  const damage = abilityDamage(p, world.server.whirlwindDamage);
  p.whirlTimer = C.spinTime;
  p.lastAttackTime = world.time;
  hitAround(world, p, p.x, p.y, radius, damage);
  world.emit({ type: 'explosion', x: p.x, y: p.y, radius, source: 'whirlwind' });
}

/** Damages every hostile body whose circle reaches into the blast (walls block it). */
export function hitAround(world: World, p: Player, x: number, y: number, radius: number, damage: number): void {
  const hits: [TargetKind, EntityId][] = [];
  forEachHostile(world, p.team, (kind, id, body) => {
    if (distanceSq(body.x, body.y, x, y) > (radius + body.radius) ** 2) return;
    if (!world.map.lineOfSight(x, y, body.x, body.y)) return;
    hits.push([kind, id]);
  });
  for (const [kind, id] of hits) damageTarget(world, kind, id, damage, p.id, x, y);
}

export function updateAbilities(world: World, dt: number): void {
  for (const p of world.players.values()) {
    if (!p.alive) continue;
    p.shieldTimer = Math.max(0, p.shieldTimer - dt);
    p.whirlTimer = Math.max(0, p.whirlTimer - dt);
    if (p.cloakTimer > 0) {
      p.cloakTimer = Math.max(0, p.cloakTimer - dt);
      if (p.cloakTimer === 0) world.emit({ type: 'cloak', playerId: p.id, on: false });
    }
    updateHook(world, p, dt);
  }
}

/** True if an active shield faces the point (x, y). The shield always follows the aim. */
export function shieldCovers(p: Player, x: number, y: number): boolean {
  if (p.shieldTimer <= 0) return false;
  const angle = Math.atan2(y - p.y, x - p.x);
  return Math.abs(wrapAngle(angle - p.aim)) <= p.shieldArc / 2;
}

/** `total` is what the HUD shows as a full cooldown circle (defaults to `seconds`). */
function startCooldown(p: Player, seconds: number, total = seconds): void {
  p.abilityCooldown = seconds;
  p.abilityCooldownTotal = total;
}

/** Instant cone blast: every enemy inside the cone takes full damage. */
function fireShotgun(world: World, p: Player): void {
  const { range, arc, damage } = shotgunCone(p, world.server);
  const hits: [TargetKind, EntityId][] = [];
  forEachHostile(world, p.team, (kind, id, body) => {
    if (
      circleInCone(p.x, p.y, p.aim, arc, range, body.x, body.y, body.radius) &&
      world.map.lineOfSight(p.x, p.y, body.x, body.y) // walls take the blast
    ) {
      hits.push([kind, id]);
    }
  });
  for (const [kind, id] of hits) damageTarget(world, kind, id, damage, p.id, p.x, p.y);
  world.emit({ type: 'shotgun', playerId: p.id, x: p.x, y: p.y, angle: p.aim, range, arc });
}
