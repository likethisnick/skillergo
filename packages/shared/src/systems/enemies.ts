import { CONFIG } from '../config';
import { circleInCone, circlesOverlap, distance, distanceSq, length } from '../math/vec2';
import { lanePath, nearestLane, territoryAt } from '../arena';
import { otherTeam, type Body, type Enemy, type EntityId, type TargetKind } from '../types';
import { damageTarget, forEachHostile, getTarget } from './targets';
import type { World } from '../world';

const E = CONFIG.enemies;
const B = CONFIG.bosses;

interface AttackConfig {
  range: number;
  cooldownMin: number;
  cooldownMax: number;
  windup: number;
  aimLock: number;
  projectileRadius: number;
  projectileRange: number;
  damage: number;
}

/** lead: 0 = aim at the current position, 1 = full intercept; spread: max random deviation (radians). */
interface AimConfig {
  lead: number;
  spread: number;
}

interface ShooterConfig {
  accelerationFactor: number;
  preferredDistance: number;
  aim: AimConfig;
  attack: AttackConfig;
}

type ShooterKind = 'grunt' | 'sniper' | 'colossus';
type MovingKind = 'grunt' | 'rusher' | 'sniper' | 'farmer' | 'colossus' | 'duelist' | 'blademaster' | 'wander';
type BulletSource = 'grunt' | 'sniper' | 'colossus' | 'duelist';

/** Movement speed: server base x type multiplier x slider x difficulty ramp. */
function enemySpeed(world: World, kind: MovingKind): number {
  const S = world.server;
  return S.enemySpeed * S[`${kind}SpeedMultiplier`] * world.mods.moveSpeed;
}

/** Enemy bullet speed: server base x type multiplier x slider x difficulty ramp. */
function bulletSpeed(world: World, source: BulletSource): number {
  const S = world.server;
  return S.bulletSpeed * S[`${source}BulletSpeedMultiplier`] * world.mods.projectileSpeed;
}

export function updateEnemies(world: World, dt: number): void {
  for (const e of world.enemies.values()) {
    e.age += dt;
    e.hitFlash = Math.max(0, e.hitFlash - dt);
    e.attackCooldown = Math.max(0, e.attackCooldown - dt);
    e.contactCooldown = Math.max(0, e.contactCooldown - dt);

    if (e.kind === 'dummy') {
      if (world.time - e.lastHitTime > CONFIG.training.dummy.regenDelay) e.hp = e.maxHp;
      e.vx = 0;
      e.vy = 0;
      continue;
    }

    // A hooked enemy is moved by the hook system only.
    if (e.pulledBy !== null) continue;

    // Training room with enemy AI switched off: targets just stand there.
    if (world.isTraining && !world.enemyAI) {
      e.vx = 0;
      e.vy = 0;
      e.windup = 0;
      continue;
    }

    if (e.role === 'farmer') {
      updateFarmer(world, e, dt);
    } else {
      const target = acquireTarget(world, e, dt);
      if (target) fight(world, e, target, dt);
      else idle(world, e, dt);
      if (e.role === 'guardian') leash(e);
    }

    e.x += e.vx * dt;
    e.y += e.vy * dt;
    if (!e.boss) collideWithWalls(world, e);
    keepInsideWorld(world, e);
  }
}

// ---------------------------------------------------------------- targeting

/** Keeps the current target for a moment, then re-picks (cheap and avoids flip-flopping). */
function acquireTarget(world: World, e: Enemy, dt: number): Body | null {
  e.retargetTimer -= dt;
  if (e.retargetTimer > 0 && e.targetKind && e.targetId !== null) {
    const current = getTarget(world, e.targetKind, e.targetId);
    if (current) return current;
  }
  e.retargetTimer = 0.3;
  const pick = chooseTarget(world, e);
  e.targetKind = pick ? pick.kind : null;
  e.targetId = pick ? pick.id : null;
  return pick ? pick.body : null;
}

interface Pick {
  kind: TargetKind;
  id: EntityId;
  body: Body;
}

function chooseTarget(world: World, e: Enemy): Pick | null {
  // Survival and training: enemies only hunt players (bosses always know where they are).
  if (!world.isVersus) {
    const p = world.nearestPlayer(e.x, e.y, e.boss ? Infinity : E.aggroRange, e.team);
    return p ? { kind: 'player', id: p.id, body: p } : null;
  }

  const V = CONFIG.versus;
  const arena = world.arena!;

  if (e.role === 'guardian') {
    // Bosses fight whatever hostile comes near the base, but never leave it.
    return nearestHostile(world, e, (body) => distance(body.x, body.y, e.homeX, e.homeY) <= V.bossLeash);
  }

  // 1. A player on our half is the priority. The longer he stays, the farther we notice him.
  let intruder: Pick | null = null;
  let best = Infinity;
  for (const p of world.players.values()) {
    if (!p.alive || p.team === e.team || territoryAt(arena, p.x, p.y) !== e.team) continue;
    const radius = e.role === 'defender' && e.escortId === p.id
      ? Infinity
      : Math.min(V.defendRadiusMax, V.defendRadius + V.defendRadiusGrowth * p.intrusionTime);
    const d = distance(e.x, e.y, p.x, p.y);
    if (d <= radius && d < best) {
      best = d;
      intruder = { kind: 'player', id: p.id, body: p };
    }
  }
  if (intruder) return intruder;

  // 2. Otherwise: the nearest hostile unit or player within reach.
  return nearestHostile(world, e, (body) => distance(body.x, body.y, e.x, e.y) <= V.engageRadius);
}

function nearestHostile(world: World, e: Enemy, accept: (body: Body) => boolean): Pick | null {
  let pick: Pick | null = null;
  let best = Infinity;
  forEachHostile(world, e.team, (kind, id, body) => {
    if (!accept(body)) return;
    const d = distanceSq(e.x, e.y, body.x, body.y);
    if (d < best) {
      best = d;
      pick = { kind, id, body };
    }
  }, { players: true, enemies: true });
  return pick;
}

// ---------------------------------------------------------------- behaviour

function fight(world: World, e: Enemy, target: Body, dt: number): void {
  switch (e.kind) {
    case 'grunt':
    case 'sniper':
      updateShooter(world, e, e.kind, E[e.kind], target, dt);
      break;
    case 'rusher':
      updateRusher(world, e, target, dt);
      break;
    case 'colossus':
      updateShooter(world, e, 'colossus', B.colossus, target, dt);
      contactHit(world, e, B.colossus.contactDamage, B.colossus.contactCooldown);
      break;
    case 'duelist':
      updateDuelist(world, e, target, dt);
      break;
    case 'blademaster':
      updateBlademaster(world, e, target, dt);
      break;
    default:
      break;
  }
}

/** No target: survival enemies wander; lane mobs march; guardians go home. */
function idle(world: World, e: Enemy, dt: number): void {
  e.windup = 0;
  if (!world.isVersus || e.role === 'survival') {
    wander(world, e, dt);
    return;
  }
  if (e.role === 'guardian') {
    moveTowards(world, e, e.homeX, e.homeY, 0.6, dt);
    return;
  }
  if (e.role === 'defender') {
    // The intruder left: join the nearest lane and push like everybody else.
    e.role = 'wave';
    e.escortId = null;
    joinNearestLane(world, e);
  }
  march(world, e, dt);
}

/** Lane mobs walk their lane towards the enemy base, or escort their own player on enemy ground. */
function march(world: World, e: Enemy, dt: number): void {
  const arena = world.arena!;
  if (!e.lane) joinNearestLane(world, e);
  const path = lanePath(arena, e.lane!, e.team);

  if (e.escortId !== null) {
    const p = world.players.get(e.escortId);
    const stillIntruding = p && p.alive && territoryAt(arena, p.x, p.y) === otherTeam(e.team);
    if (stillIntruding) {
      const spot = slotPoint(world, e, p, 160);
      moveTowards(world, e, spot.x, spot.y, 1, dt, p.x, p.y);
      return;
    }
    e.escortId = null;
  }

  const index = Math.min(e.waypoint, path.length - 1);
  const goal = path[index];
  if (distance(e.x, e.y, goal.x, goal.y) < CONFIG.versus.waypointReach && index < path.length - 1) {
    e.waypoint = index + 1;
  }
  moveTowards(world, e, goal.x, goal.y, 1, dt);
}

function joinNearestLane(world: World, e: Enemy): void {
  const arena = world.arena!;
  e.lane = nearestLane(arena, e.x, e.y);
  const path = lanePath(arena, e.lane, e.team);
  // Continue from the waypoint after the closest one.
  let best = Infinity;
  let index = 1;
  for (let i = 0; i < path.length; i++) {
    const d = distance(e.x, e.y, path[i].x, path[i].y);
    if (d < best) {
      best = d;
      index = i;
    }
  }
  e.waypoint = Math.min(path.length - 1, index + 1);
}

/** Farmers potter about near their nexus and run from danger. Almost harmless. */
function updateFarmer(world: World, e: Enemy, dt: number): void {
  const V = CONFIG.versus;
  const speed = enemySpeed(world, 'farmer');
  const threat = nearestHostile(world, e, (body) => distance(body.x, body.y, e.x, e.y) <= V.farmerFleeRadius);
  if (threat) {
    const away = { x: e.x - threat.body.x, y: e.y - threat.body.y };
    const len = length(away.x, away.y) || 1;
    // Flee, but not out of the base: lean back home when far.
    const homeX = e.homeX - e.x;
    const homeY = e.homeY - e.y;
    const homeLen = length(homeX, homeY) || 1;
    const homePull = Math.min(1, homeLen / V.farmerWanderRadius);
    const dirX = away.x / len + (homeX / homeLen) * homePull;
    const dirY = away.y / len + (homeY / homeLen) * homePull;
    const dirLen = length(dirX, dirY) || 1;
    steer(e, (dirX / dirLen) * speed * 1.4, (dirY / dirLen) * speed * 1.4, speed * 6, dt);
    contactHit(world, e, V.farmerContactDamage, 1.5);
    return;
  }
  e.wanderTimer -= dt;
  if (e.wanderTimer <= 0) {
    e.wanderTimer = world.rng.range(1.5, 4);
    const a = world.rng.angle();
    const r = world.rng.range(0, V.farmerWanderRadius);
    e.slotAngle = a;
    e.distanceScale = r;
  }
  const gx = e.homeX + Math.cos(e.slotAngle) * e.distanceScale;
  const gy = e.homeY + Math.sin(e.slotAngle) * e.distanceScale;
  moveTowards(world, e, gx, gy, 0.5, dt);
}

/** Guardians never follow anybody past their leash. */
function leash(e: Enemy): void {
  const d = distance(e.x, e.y, e.homeX, e.homeY);
  if (d <= CONFIG.versus.bossLeash) return;
  const speed = Math.max(length(e.vx, e.vy), 120);
  e.vx = ((e.homeX - e.x) / d) * speed;
  e.vy = ((e.homeY - e.y) / d) * speed;
  e.targetKind = null;
  e.targetId = null;
}

/**
 * This enemy's own spot around a target: its slot angle at the given distance.
 * A spot inside a wall is pulled towards the target until it is free.
 */
function slotPoint(world: World, e: Enemy, target: Body, dist: number): { x: number; y: number } {
  let x = target.x + Math.cos(e.slotAngle) * dist;
  let y = target.y + Math.sin(e.slotAngle) * dist;
  for (let i = 0; i < 8 && !e.boss && world.map.isSolidAt(x, y); i++) {
    x += (target.x - x) * 0.25;
    y += (target.y - y) * 0.25;
  }
  return { x, y };
}

/** Steers towards a point at `speedFactor` of this kind's speed (around walls). */
function moveTowards(
  world: World, e: Enemy, gx: number, gy: number, speedFactor: number, dt: number,
  pathX = gx, pathY = gy,
): void {
  const d = distance(e.x, e.y, gx, gy);
  if (d < 20) {
    steer(e, 0, 0, speedOf(world, e) * accelerationOf(e), dt);
    return;
  }
  const speed = speedOf(world, e) * speedFactor * Math.min(1, d / 120);
  const dir = navigate(world, e, gx, gy, pathX, pathY);
  steer(e, dir.x * speed, dir.y * speed, speedOf(world, e) * accelerationOf(e), dt);
}

function speedOf(world: World, e: Enemy): number {
  const kind: MovingKind = e.kind === 'dummy' ? 'wander' : e.kind;
  return enemySpeed(world, kind);
}

function accelerationOf(e: Enemy): number {
  if (e.kind === 'dummy' || e.kind === 'farmer') return 4;
  return e.boss ? B[e.kind as 'colossus'].accelerationFactor : E[e.kind as 'grunt'].accelerationFactor;
}

/** Mob damage: difficulty multiplier, plus the home-ground bonus in versus. */
function mobDamage(world: World, e: Enemy, base: number): number {
  let damage = base * world.mods.enemyDamage;
  if (world.arena && territoryAt(world.arena, e.x, e.y) === e.team) damage *= 1 + world.server.homeDefenseBonus;
  return damage;
}

/** Regular enemies cannot pass walls or buildings; they slide along them. Bosses ignore walls entirely. */
function collideWithWalls(world: World, e: Enemy): void {
  const resolved = world.resolveObstacles(e.x, e.y, e.radius);
  e.x = resolved.x;
  e.y = resolved.y;
}

/**
 * Direction towards a goal point: straight when the way is clear (and always for bosses),
 * otherwise along the path map towards (pathX, pathY), around walls.
 */
function navigate(
  world: World, e: Enemy, goalX: number, goalY: number, pathX = goalX, pathY = goalY,
): { x: number; y: number } {
  const dx = goalX - e.x;
  const dy = goalY - e.y;
  const len = length(dx, dy) || 1;
  if (e.boss || world.map.lineOfSight(e.x, e.y, goalX, goalY)) return { x: dx / len, y: dy / len };
  return world.pathStepTo(pathX, pathY, e.x, e.y) ?? { x: dx / len, y: dy / len };
}

/** Picks a new random slow movement (or a short pause). Used while no player is around. */
export function pickWanderDirection(world: World, e: Enemy): void {
  const rng = world.rng;
  e.wanderTimer = rng.range(E.wanderMin, E.wanderMax);
  if (rng.next() < 0.2) {
    e.vx = 0;
    e.vy = 0;
    return;
  }
  const angle = rng.angle();
  const speed = enemySpeed(world, 'wander') * rng.range(0.6, 1);
  e.vx = Math.cos(angle) * speed;
  e.vy = Math.sin(angle) * speed;
}

/**
 * Pushes overlapping enemies apart so crowds spread out instead of stacking.
 * Heavier (bigger) enemies move less. O(n^2), fine for the enemy cap.
 */
export function separateEnemies(world: World): void {
  const list = Array.from(world.enemies.values());
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      // Regular enemies keep a bit of personal space so crowds spread out.
      const minDist = a.radius + b.radius + (a.boss || b.boss ? 0 : E.separationGap);
      const distSq = dx * dx + dy * dy;
      if (distSq >= minDist * minDist) continue;

      const dist = Math.sqrt(distSq);
      const nx = dist > 0 ? dx / dist : 1;
      const ny = dist > 0 ? dy / dist : 0;
      // Resolve half of the overlap per tick: soft, jitter-free pushing.
      const overlap = (minDist - dist) * 0.5;
      let wa = a.radius * a.radius;
      let wb = b.radius * b.radius;
      // A hooked enemy is driven by the hook; treat it as immovable.
      if (a.pulledBy !== null) wa = Infinity;
      if (b.pulledBy !== null) wb = Infinity;
      if (wa === Infinity && wb === Infinity) continue;
      const moveA = wa === Infinity ? 0 : wb === Infinity ? overlap : (overlap * wb) / (wa + wb);
      const moveB = wb === Infinity ? 0 : wa === Infinity ? overlap : (overlap * wa) / (wa + wb);
      a.x -= nx * moveA;
      a.y -= ny * moveA;
      b.x += nx * moveB;
      b.y += ny * moveB;
    }
  }
  // Pushing must never shove anybody into a wall.
  for (const e of list) if (!e.boss && world.enemies.has(e.id)) collideWithWalls(world, e);
}

function wander(world: World, e: Enemy, dt: number): void {
  e.windup = 0;
  e.wanderTimer -= dt;
  if (e.wanderTimer <= 0) pickWanderDirection(world, e);
}

// ------------------------------------------------------------------ shooters

/**
 * Grunts, snipers and the Colossus keep a preferred distance, circle around
 * the target and shoot. They only start a shot while they are on the target's
 * screen, so nobody gets sniped from outside the view.
 */
function updateShooter(world: World, e: Enemy, kind: ShooterKind, C: ShooterConfig, target: Body, dt: number): void {
  const dist = length(target.x - e.x, target.y - e.y) || 1;
  const visible = isOnPlayerScreen(e, target);
  const speed = enemySpeed(world, kind);

  // Every shooter heads for its own spot around the player and slowly orbits it,
  // so a crowd surrounds the player instead of trailing behind him in one clump.
  e.slotAngle += e.strafeDir * E.slotDrift * dt;
  maybeFlipStrafe(world, e, dt);
  const preferred = preferredDistance(e, C.preferredDistance * e.distanceScale, Math.cos(e.slotAngle), Math.sin(e.slotAngle));
  const goal = slotPoint(world, e, target, preferred);
  const toGoal = length(goal.x - e.x, goal.y - e.y);

  let desiredX = 0;
  let desiredY = 0;
  const standStill = (e.kind === 'sniper' || e.kind === 'colossus') && e.windup > 0;
  if (!standStill && toGoal > 25) {
    const dir = navigate(world, e, goal.x, goal.y, target.x, target.y);
    const scale = Math.min(1, toGoal / 120); // ease into the spot
    desiredX = dir.x * speed * scale;
    desiredY = dir.y * speed * scale;
  }
  steer(e, desiredX, desiredY, speed * C.accelerationFactor, dt);

  // Regular shooters only open fire with a clear line; bosses shoot through walls.
  const clearShot = e.boss || world.map.lineOfSight(e.x, e.y, target.x, target.y);
  updateAttack(world, e, C.attack, C.aim, kind, target, dist, visible && clearShot, dt);
}

/** Duelist: stands still, then darts sideways in short bursts; shots lead the target. */
function updateDuelist(world: World, e: Enemy, target: Body, dt: number): void {
  const C = B.duelist;
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const dist = length(dx, dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;
  const visible = isOnPlayerScreen(e, target);

  if (e.burstTimer > 0) {
    e.burstTimer -= dt;
    if (e.burstTimer <= 0) {
      e.vx = 0;
      e.vy = 0;
      // Off-screen it hurries in; on-screen it pauses between dashes (and shoots).
      e.wanderTimer = visible ? world.rng.range(C.burstPauseMin, C.burstPauseMax) : 0.05;
    }
  } else {
    e.vx = 0;
    e.vy = 0;
    e.wanderTimer = Math.min(e.wanderTimer, visible ? C.burstPauseMax : 0.05) - dt;
    if (e.wanderTimer <= 0 && e.windup <= 0) {
      const side = world.rng.next() < 0.5 ? -1 : 1;
      const preferred = preferredDistance(e, C.preferredDistance, dirX, dirY);
      let radial = 0;
      if (!visible) radial = 2;
      else if (dist > preferred + 60) radial = 0.8;
      else if (dist < preferred - 60) radial = -0.8;
      let mx = -dirY * side + dirX * radial;
      let my = dirX * side + dirY * radial;
      const len = length(mx, my) || 1;
      mx /= len;
      my /= len;
      const speed = enemySpeed(world, 'duelist');
      e.vx = mx * speed;
      e.vy = my * speed;
      e.burstTimer = C.burstTime;
    }
  }

  updateAttack(world, e, C.attack, C.aim, 'duelist', target, dist, visible && e.burstTimer <= 0, dt);
}

/**
 * Shared windup -> fire logic. Aim tracks the target, then locks for the last `aimLock` seconds.
 * Snipers and the Duelist lead moving targets; grunts shoot roughly towards the player with
 * a random deviation that the difficulty ramp narrows (but never removes).
 */
function updateAttack(
  world: World, e: Enemy, A: AttackConfig, aim: AimConfig, source: BulletSource,
  target: Body, dist: number, canStart: boolean, dt: number,
): void {
  const projectileSpeed = bulletSpeed(world, source);
  const aimAt = (): number => leadAngle(e, target, projectileSpeed, aim.lead);

  if (e.windup > 0) {
    if (e.windup > A.aimLock) e.aim = aimAt();
    e.windup -= dt;
    if (e.windup > 0) return;
    e.windup = 0;
    const spread = aim.spread * (1 - CONFIG.accuracy.spreadReductionAtPeak * world.mods.accuracy);
    e.aim += world.rng.range(-spread, spread);
    // Big projectiles emerge from the body instead of spawning far in front of it.
    const offset = e.radius + Math.min(A.projectileRadius, 24);
    world.spawnProjectile({
      ownerId: e.id,
      team: e.team,
      source: e.kind,
      x: e.x + Math.cos(e.aim) * offset,
      y: e.y + Math.sin(e.aim) * offset,
      angle: e.aim,
      speed: projectileSpeed,
      radius: A.projectileRadius,
      damage: mobDamage(world, e, A.damage),
      range: A.projectileRange,
      ignoresWalls: e.boss,
    });
    e.attackCooldown = world.rng.range(A.cooldownMin, A.cooldownMax) / world.mods.fireRate;
    return;
  }

  e.aim = aimAt();
  if (e.attackCooldown <= 0 && canStart && dist <= A.range) e.windup = A.windup;
}

/**
 * Angle to hit a target moving with constant velocity, scaled by `fraction`
 * (0 = aim at the current position, 1 = full intercept).
 */
function leadAngle(e: Enemy, t: Body, speed: number, fraction: number): number {
  const dx = t.x - e.x;
  const dy = t.y - e.y;
  if (fraction <= 0) return Math.atan2(dy, dx);
  const a = t.vx * t.vx + t.vy * t.vy - speed * speed;
  const b = 2 * (dx * t.vx + dy * t.vy);
  const c = dx * dx + dy * dy;
  let time = 0;
  if (Math.abs(a) < 1e-6) {
    time = b !== 0 ? -c / b : 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-b - sq) / (2 * a);
      const t2 = (-b + sq) / (2 * a);
      time = Math.min(t1 > 0 ? t1 : Infinity, t2 > 0 ? t2 : Infinity);
    }
  }
  if (!Number.isFinite(time) || time < 0) time = 0;
  time *= fraction;
  return Math.atan2(dy + t.vy * time, dx + t.vx * time);
}

// --------------------------------------------------------------------- melee

/** Rushers charge straight at the target and deal contact damage, then bounce back. */
function updateRusher(world: World, e: Enemy, target: Body, dt: number): void {
  const C = E.rusher;
  const speed = enemySpeed(world, 'rusher');
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const dist = length(dx, dy) || 1;

  if (e.retreatTimer > 0) {
    e.retreatTimer -= dt;
  } else {
    // From far away it runs to its own flank, then charges straight in.
    const goal = dist > E.rushRange ? slotPoint(world, e, target, E.flankDistance) : { x: target.x, y: target.y };
    const dir = navigate(world, e, goal.x, goal.y, target.x, target.y);
    steer(e, dir.x * speed, dir.y * speed, speed * C.accelerationFactor, dt);
  }
  if (e.vx !== 0 || e.vy !== 0) e.aim = Math.atan2(e.vy, e.vx);

  const hit = contactHit(world, e, C.contactDamage, C.contactCooldown);
  if (hit) bounceAway(e, hit, speed * 0.7, C.retreatTime);
}

/** Blademaster: approach -> telegraphed wide swing -> leap back -> circle while recovering. */
function updateBlademaster(world: World, e: Enemy, target: Body, dt: number): void {
  const C = B.blademaster;
  const speed = enemySpeed(world, 'blademaster');
  const acceleration = speed * C.accelerationFactor;
  const dx = target.x - e.x;
  const dy = target.y - e.y;
  const dist = length(dx, dy) || 1;
  const dirX = dx / dist;
  const dirY = dy / dist;

  if (e.retreatTimer > 0) {
    e.retreatTimer -= dt;
    if (e.retreatTimer <= 0) {
      e.vx *= 0.2;
      e.vy *= 0.2;
    }
    return;
  }

  if (e.windup > 0) {
    steer(e, 0, 0, acceleration * 3, dt);
    // Direction locks halfway through the windup: that is the moment to dodge.
    if (e.windup > C.windup * 0.5) e.aim = Math.atan2(dy, dx);
    e.windup -= dt;
    if (e.windup <= 0) {
      e.windup = 0;
      swingBlade(world, e);
    }
    return;
  }

  e.aim = Math.atan2(dy, dx);
  if (e.attackCooldown > 0) {
    // Recovering: keep some distance and circle around.
    const orbit = speed * 0.6;
    let desiredX = -dirY * e.strafeDir * orbit;
    let desiredY = dirX * e.strafeDir * orbit;
    if (dist < C.orbitDistance - 60) {
      desiredX -= dirX * orbit;
      desiredY -= dirY * orbit;
    } else if (dist > C.orbitDistance + 60) {
      desiredX += dirX * orbit;
      desiredY += dirY * orbit;
    }
    steer(e, desiredX, desiredY, acceleration, dt);
    maybeFlipStrafe(world, e, dt);
    return;
  }

  steer(e, dirX * speed, dirY * speed, acceleration, dt);
  if (dist <= C.swingRange * 0.8 + target.radius) e.windup = C.windup;
}

function swingBlade(world: World, e: Enemy): void {
  const C = B.blademaster;
  const leap = enemySpeed(world, 'blademaster') * C.leapSpeedFactor;
  e.lastAttackTime = world.time;
  const hits: [TargetKind, EntityId][] = [];
  forEachHostile(world, e.team, (kind, id, body) => {
    if (circleInCone(e.x, e.y, e.aim, C.swingArc, C.swingRange, body.x, body.y, body.radius)) hits.push([kind, id]);
  }, { players: true, enemies: true });
  for (const [kind, id] of hits) damageTarget(world, kind, id, mobDamage(world, e, C.damage), e.id, e.x, e.y);
  e.vx = -Math.cos(e.aim) * leap;
  e.vy = -Math.sin(e.aim) * leap;
  e.retreatTimer = C.leapTime;
  e.attackCooldown = C.leapTime + C.recoverTime / world.mods.fireRate;
}

/** Deals contact damage to the first overlapping hostile player or unit. Returns it on a hit or block. */
function contactHit(world: World, e: Enemy, damage: number, cooldown: number): Body | null {
  if (e.contactCooldown > 0) return null;
  let hit: Body | null = null;
  forEachHostile(world, e.team, (kind, id, body) => {
    if (!circlesOverlap(e.x, e.y, e.radius, body.x, body.y, body.radius)) return false;
    // 'false' means a dashing player: running through an enemy is allowed.
    if (!damageTarget(world, kind, id, mobDamage(world, e, damage), e.id, e.x, e.y)) return false;
    hit = body;
    return true;
  }, { players: true, enemies: true });
  if (hit) e.contactCooldown = cooldown;
  return hit;
}

function bounceAway(e: Enemy, from: Body, speed: number, time: number): void {
  const awayX = e.x - from.x;
  const awayY = e.y - from.y;
  const len = length(awayX, awayY) || 1;
  e.vx = (awayX / len) * speed;
  e.vy = (awayY / len) * speed;
  e.retreatTimer = time;
}

// ------------------------------------------------------------------- helpers

function maybeFlipStrafe(world: World, e: Enemy, dt: number): void {
  e.wanderTimer -= dt;
  if (e.wanderTimer <= 0) {
    e.wanderTimer = world.rng.range(E.wanderMin, E.wanderMax);
    e.strafeDir = world.rng.next() < 0.5 ? -1 : 1;
  }
}

/** Moves velocity towards the desired one with limited acceleration. */
function steer(e: Enemy, desiredX: number, desiredY: number, acceleration: number, dt: number): void {
  let ax = desiredX - e.vx;
  let ay = desiredY - e.vy;
  const len = length(ax, ay);
  const max = acceleration * dt;
  if (len > max) {
    ax = (ax / len) * max;
    ay = (ay / len) * max;
  }
  e.vx += ax;
  e.vy += ay;
}

/**
 * The screen is wider than tall, so a fixed preferred distance would push shooters
 * off-screen vertically. Clamp it to the distance to the screen edge in this direction.
 */
function preferredDistance(e: Enemy, preferred: number, dirX: number, dirY: number): number {
  const halfW = CONFIG.view.width / 2 - e.radius - 40;
  const halfH = CONFIG.view.height / 2 - e.radius - 40;
  const ax = Math.abs(dirX);
  const ay = Math.abs(dirY);
  const toEdge = Math.min(ax > 1e-6 ? halfW / ax : Infinity, ay > 1e-6 ? halfH / ay : Infinity);
  return Math.max(120 + e.radius, Math.min(preferred, toEdge));
}

function isOnPlayerScreen(e: Enemy, p: Body): boolean {
  return (
    Math.abs(e.x - p.x) <= CONFIG.view.width / 2 - e.radius &&
    Math.abs(e.y - p.y) <= CONFIG.view.height / 2 - e.radius
  );
}

function keepInsideWorld(world: World, e: Enemy): void {
  const { width, height } = world;
  if (e.x < e.radius) {
    e.x = e.radius;
    e.vx = Math.abs(e.vx);
  } else if (e.x > width - e.radius) {
    e.x = width - e.radius;
    e.vx = -Math.abs(e.vx);
  }
  if (e.y < e.radius) {
    e.y = e.radius;
    e.vy = Math.abs(e.vy);
  } else if (e.y > height - e.radius) {
    e.y = height - e.radius;
    e.vy = -Math.abs(e.vy);
  }
}
