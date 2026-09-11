import { CONFIG } from '../config';
import { circleInCone, wrapAngle } from '../math/vec2';
import { abilityDamage, abilityScaling } from '../stats';
import type { EntityId, Player, TargetKind } from '../types';
import type { World } from '../world';
import { throwHook, updateHook } from './hook';
import { damageTarget, forEachHostile } from './targets';

const A = CONFIG.abilities;
const EPS = 1e-6;
/** The shield can grow with upgrades but never becomes a full circle. */
const MAX_SHIELD_ARC = (270 * Math.PI) / 180;
const MAX_SHOTGUN_ARC = (110 * Math.PI) / 180;

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
  }
}

export function updateAbilities(world: World, dt: number): void {
  for (const p of world.players.values()) {
    if (!p.alive) continue;
    p.shieldTimer = Math.max(0, p.shieldTimer - dt);
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
  const C = A.shotgun;
  const s = abilityScaling(p);
  const range = C.range * s.radius;
  const arc = Math.min(MAX_SHOTGUN_ARC, C.arc * (1 + (s.radius - 1) / 2));
  const damage = abilityDamage(p, world.server.shotgunDamage);
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
