import { CONFIG } from '../config';
import { circleInCone, rayCircleDistance } from '../math/vec2';
import { attackSpeedMultiplier, weaponDamageMultiplier } from '../stats';
import { isBossKind, type Body, type EntityId, type Player, type TargetKind } from '../types';
import type { World } from '../world';
import { shieldCovers } from './abilities';
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
      if (world.time - p.lastAttackTime < W.sword.swingTime) cutProjectiles(world, p);
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

/**
 * While the blade sweeps, hostile bullets inside the swing arc are cut and vanish.
 * Boss attacks are too heavy to cut.
 */
function cutProjectiles(world: World, p: Player): void {
  const C = W.sword;
  for (const pr of world.projectiles.values()) {
    if (pr.team === p.team || (pr.source !== 'player' && isBossKind(pr.source))) continue;
    if (!circleInCone(p.x, p.y, p.lastAttackAngle, C.arc, C.range, pr.x, pr.y, pr.radius)) continue;
    if (!world.map.lineOfSight(p.x, p.y, pr.x, pr.y)) continue;
    world.projectiles.delete(pr.id);
    world.emit({ type: 'bulletCut', playerId: p.id, x: pr.x, y: pr.y });
  }
}

/** Beam damage per target since the last floating-number report (server-side bookkeeping). */
const beamReports = new WeakMap<Player, Map<EntityId, { damage: number; x: number; y: number }>>();

/**
 * The beam burns through everything hostile along the aim: mobs, players and buildings all
 * take its damage. Only walls and an enemy shield facing the shooter stop it.
 */
function updateBeam(world: World, p: Player, dt: number): void {
  const C = W.beam;
  const beam = p.beam;

  if (!p.input.fire) {
    reportBeamDamage(world, p);
    beam.active = false;
    beam.targetId = null;
    return;
  }

  const dirX = Math.cos(p.aim);
  const dirY = Math.sin(p.aim);
  const wallT = world.map.raycast(p.x, p.y, p.x + dirX * C.range, p.y + dirY * C.range);
  let reach: number = wallT === null ? C.range : C.range * wallT;

  // The nearest shield turned towards us ends the beam at its band.
  let blocker: EntityId | null = null;
  for (const v of world.players.values()) {
    if (!v.alive || v.team === p.team || !shieldCovers(v, p.x, p.y)) continue;
    const t = rayCircleDistance(p.x, p.y, dirX, dirY, v.x, v.y, v.radius + CONFIG.abilities.shield.offset);
    if (t !== null && t < reach) {
      reach = t;
      blocker = v.id;
    }
  }

  const hits: { kind: TargetKind; id: EntityId; body: Body }[] = [];
  forEachHostile(world, p.team, (kind, id, body) => {
    if (id === blocker) return;
    const t = rayCircleDistance(p.x, p.y, dirX, dirY, body.x, body.y, body.radius);
    if (t !== null && t < reach) hits.push({ kind, id, body });
  });

  beam.active = true;
  beam.endX = p.x + dirX * reach;
  beam.endY = p.y + dirY * reach;
  beam.targetId = blocker;
  p.lastAttackTime = world.time;
  p.lastAttackAngle = p.aim;

  // For a continuous weapon both damage and attack speed raise the damage per second.
  const amount = world.server.beamDamagePerSecond * weaponDamageMultiplier(p) * attackSpeedMultiplier(p) * dt;
  let report = beamReports.get(p);
  if (!report) {
    report = new Map();
    beamReports.set(p, report);
  }
  for (const { kind, id, body } of hits) {
    let landed = true;
    if (kind === 'enemy') {
      const enemy = world.enemies.get(id);
      if (!enemy) continue;
      enemy.hitFlash = Math.max(enemy.hitFlash, 0.05);
      world.damageEnemy(enemy, amount, p.id, true);
    } else if (kind === 'player') {
      const victim = world.players.get(id);
      landed = !!victim && world.damagePlayer(victim, amount, p.x, p.y, p.id, true) === 'hit';
    } else {
      damageTarget(world, kind, id, amount, p.id, body.x, body.y);
      continue; // Buildings report their own hits.
    }
    if (!landed) continue;
    const r = report.get(id);
    if (r) {
      r.damage += amount;
      r.x = body.x;
      r.y = body.y;
    } else {
      report.set(id, { damage: amount, x: body.x, y: body.y });
    }
  }

  beam.reportTimer -= dt;
  if (beam.reportTimer <= 0) {
    reportBeamDamage(world, p);
    if (blocker !== null) world.emit({ type: 'blocked', playerId: blocker, x: beam.endX, y: beam.endY });
    beam.reportTimer = C.reportInterval;
  }
}

/** Beam damage is tiny per tick, so every burned target shows one number every `reportInterval`. */
function reportBeamDamage(world: World, p: Player): void {
  const report = beamReports.get(p);
  if (!report) return;
  for (const [id, r] of report) {
    if (r.damage >= 1) world.emit({ type: 'hit', targetId: id, sourceId: p.id, x: r.x, y: r.y, damage: Math.round(r.damage) });
  }
  report.clear();
}
