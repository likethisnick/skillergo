import { CONFIG } from '../config';
import { circleInCone, rayCircleDistance } from '../math/vec2';
import { attackSpeedMultiplier, weaponDamageMultiplier } from '../stats';
import type { EntityId, Player, TargetKind } from '../types';
import type { World } from '../world';
import { damageTarget, forEachHostile } from './targets';

const W = CONFIG.weapons;
const EPS = 1e-6;

/** LMB weapon logic. Gun and sword auto-repeat while held; the beam is continuous. */
export function updateWeapon(world: World, p: Player, dt: number): void {
  p.attackCooldown = Math.max(0, p.attackCooldown - dt);

  switch (p.weapon) {
    case 'gun':
      if (p.input.fire && p.attackCooldown <= EPS) fireGun(world, p);
      break;
    case 'sword':
      if (p.input.fire && p.attackCooldown <= EPS) swingSword(world, p);
      break;
    case 'beam':
      updateBeam(world, p, dt);
      break;
  }
}

function markAttack(world: World, p: Player, cooldown: number): void {
  p.attackCooldown = cooldown;
  p.lastAttackTime = world.time;
  p.lastAttackAngle = p.aim;
}

function fireGun(world: World, p: Player): void {
  const C = W.gun;
  const offset = p.radius + C.projectileRadius;
  world.spawnProjectile({
    ownerId: p.id,
    team: p.team,
    source: 'player',
    x: p.x + Math.cos(p.aim) * offset,
    y: p.y + Math.sin(p.aim) * offset,
    angle: p.aim,
    speed: world.server.bulletSpeed * world.server.playerBulletSpeedMultiplier,
    radius: C.projectileRadius,
    damage: world.server.gunDamage * weaponDamageMultiplier(p),
    range: C.range,
  });
  markAttack(world, p, C.cooldown / attackSpeedMultiplier(p));
}

function swingSword(world: World, p: Player): void {
  const C = W.sword;
  const damage = world.server.swordDamage * weaponDamageMultiplier(p);
  const hits: [TargetKind, EntityId][] = [];
  forEachHostile(world, p.team, (kind, id, body) => {
    if (
      circleInCone(p.x, p.y, p.aim, C.arc, C.range, body.x, body.y, body.radius) &&
      world.map.lineOfSight(p.x, p.y, body.x, body.y) // no hitting through walls
    ) {
      hits.push([kind, id]);
    }
  });
  for (const [kind, id] of hits) damageTarget(world, kind, id, damage, p.id, p.x, p.y);
  markAttack(world, p, C.cooldown / attackSpeedMultiplier(p));
}

function updateBeam(world: World, p: Player, dt: number): void {
  const C = W.beam;
  const beam = p.beam;

  if (!p.input.fire) {
    reportBeamDamage(world, p);
    beam.active = false;
    beam.targetId = null;
    return;
  }

  // The beam stops at the first wall or enemy along the aim ray.
  const dirX = Math.cos(p.aim);
  const dirY = Math.sin(p.aim);
  const wallT = world.map.raycast(p.x, p.y, p.x + dirX * C.range, p.y + dirY * C.range);
  let reach: number = wallT === null ? C.range : C.range * wallT;
  let target: { kind: TargetKind; id: EntityId } | null = null;
  forEachHostile(world, p.team, (kind, id, body) => {
    const t = rayCircleDistance(p.x, p.y, dirX, dirY, body.x, body.y, body.radius);
    if (t !== null && t < reach) {
      reach = t;
      target = { kind, id };
    }
  });

  beam.active = true;
  beam.endX = p.x + dirX * reach;
  beam.endY = p.y + dirY * reach;
  const hit = target as { kind: TargetKind; id: EntityId } | null;
  beam.targetId = hit ? hit.id : null;
  p.lastAttackTime = world.time;
  p.lastAttackAngle = p.aim;

  if (hit) {
    // For a continuous weapon both damage and attack speed raise the damage per second.
    const amount = world.server.beamDamagePerSecond * weaponDamageMultiplier(p) * attackSpeedMultiplier(p) * dt;
    beam.pendingDamage += amount;
    if (hit.kind === 'enemy') {
      const enemy = world.enemies.get(hit.id);
      if (enemy) world.damageEnemy(enemy, amount, p.id, true);
    } else if (hit.kind === 'player') {
      const victim = world.players.get(hit.id);
      if (victim) world.damagePlayer(victim, amount, p.x, p.y, p.id, true);
    } else {
      damageTarget(world, hit.kind, hit.id, amount, p.id, beam.endX, beam.endY);
    }
  }

  beam.reportTimer -= dt;
  if (beam.reportTimer <= 0) {
    reportBeamDamage(world, p);
    beam.reportTimer = C.reportInterval;
  }
}

/** Beam damage is tiny per tick, so it is shown as one number every `reportInterval`. */
function reportBeamDamage(world: World, p: Player): void {
  const beam = p.beam;
  if (beam.pendingDamage >= 1) {
    world.emit({
      type: 'hit',
      targetId: beam.targetId ?? -1,
      sourceId: p.id,
      x: beam.endX,
      y: beam.endY,
      damage: Math.round(beam.pendingDamage),
    });
  }
  beam.pendingDamage = 0;
}
