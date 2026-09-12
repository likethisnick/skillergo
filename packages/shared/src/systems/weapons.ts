import { rifleRange } from '../classes';
import { CONFIG } from '../config';
import { circleInCone, rayCircleDistance } from '../math/vec2';
import { attackSpeedMultiplier, weaponDamageMultiplier } from '../stats';
import type { EntityId, Player, TargetKind } from '../types';
import type { World } from '../world';
import { breakCloak, hitAround } from './abilities';
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
    case 'rifle':
      if (p.input.fire && p.attackCooldown <= EPS) fireRifle(world, p);
      break;
    case 'fireball':
      if (p.input.fire && p.attackCooldown <= EPS) throwFireball(world, p);
      break;
    case 'blink':
      if (p.input.fire && p.attackCooldown <= EPS) blink(world, p);
      break;
  }
}

function markAttack(world: World, p: Player, cooldown: number): void {
  p.attackCooldown = cooldown;
  p.lastAttackTime = world.time;
  p.lastAttackAngle = p.aim;
  breakCloak(world, p); // attacking always gives an invisible marksman away
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

/** Marksman: one very fast, very heavy bullet that flies almost as far as a tower shoots. */
function fireRifle(world: World, p: Player): void {
  const C = W.rifle;
  const offset = p.radius + C.projectileRadius;
  world.spawnProjectile({
    ownerId: p.id,
    team: p.team,
    source: 'player',
    x: p.x + Math.cos(p.aim) * offset,
    y: p.y + Math.sin(p.aim) * offset,
    angle: p.aim,
    speed: world.server.bulletSpeed * world.server.playerBulletSpeedMultiplier * C.speedMultiplier,
    radius: C.projectileRadius,
    damage: world.server.rifleDamage * weaponDamageMultiplier(p),
    range: rifleRange(world.server.towerRange),
  });
  markAttack(world, p, C.cooldown / attackSpeedMultiplier(p));
}

/** Summoner: a slow ball that bursts on contact or at the end of its flight. */
function throwFireball(world: World, p: Player): void {
  const C = W.fireball;
  const offset = p.radius + C.projectileRadius;
  world.spawnProjectile({
    ownerId: p.id,
    team: p.team,
    source: 'player',
    x: p.x + Math.cos(p.aim) * offset,
    y: p.y + Math.sin(p.aim) * offset,
    angle: p.aim,
    speed: world.server.bulletSpeed * world.server.playerBulletSpeedMultiplier * C.speedMultiplier,
    radius: C.projectileRadius,
    // The direct hit does no damage of its own: everything happens in the burst.
    damage: 0,
    range: C.range,
    blastRadius: C.blastRadius,
    blastDamage: world.server.fireballDamage * weaponDamageMultiplier(p),
  });
  markAttack(world, p, C.cooldown / attackSpeedMultiplier(p));
}

/** Bastard: a short teleport towards the cursor that hurts everything where he lands. */
function blink(world: World, p: Player): void {
  const C = W.blink;
  const fromX = p.x;
  const fromY = p.y;
  // The input carries an aim angle, not a cursor distance: the jump is always full length.
  const reach = C.range;
  const spot = world.findFreeSpot(
    Math.max(p.radius, Math.min(world.width - p.radius, p.x + Math.cos(p.aim) * reach)),
    Math.max(p.radius, Math.min(world.height - p.radius, p.y + Math.sin(p.aim) * reach)),
    p.radius,
  );
  const resolved = world.resolveObstacles(spot.x, spot.y, p.radius);
  p.x = resolved.x;
  p.y = resolved.y;
  p.vx = 0;
  p.vy = 0;
  hitAround(world, p, p.x, p.y, C.blastRadius, world.server.blinkDamage * weaponDamageMultiplier(p));
  world.emit({ type: 'blink', playerId: p.id, fromX, fromY, x: p.x, y: p.y });
  world.emit({ type: 'explosion', x: p.x, y: p.y, radius: C.blastRadius, source: 'blink' });
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
