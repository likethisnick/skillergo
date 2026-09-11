import { CONFIG } from '../config';
import { length, segmentCircleHit } from '../math/vec2';
import type { Player } from '../types';
import type { World } from '../world';
import { damageTarget, forEachHostile } from './targets';

const C = CONFIG.abilities.hook;
const EPS = 1e-6;

/** Starts a hook throw in the aim direction. Returns false if the hook is already out. */
export function throwHook(p: Player, range: number, speed: number, pullSpeed: number, damage: number): boolean {
  if (p.hook.state !== 'idle') return false;
  p.hook.range = range;
  p.hook.speed = speed;
  p.hook.pullSpeed = pullSpeed;
  p.hook.damage = damage;

  const dirX = Math.cos(p.aim);
  const dirY = Math.sin(p.aim);
  const h = p.hook;
  h.state = 'flying';
  h.dirX = dirX;
  h.dirY = dirY;
  h.x = p.x + dirX * p.radius;
  h.y = p.y + dirY * p.radius;
  h.traveled = 0;
  h.targetId = null;
  return true;
}

export function updateHook(world: World, p: Player, dt: number): void {
  switch (p.hook.state) {
    case 'idle':
      p.hook.x = p.x;
      p.hook.y = p.y;
      break;
    case 'flying':
      updateFlying(world, p, dt);
      break;
    case 'pulling':
      updatePulling(world, p, dt);
      break;
    case 'retracting':
      updateRetracting(world, p, dt);
      break;
  }
}

/** Frees the hooked enemy (if any) and returns the hook to the player. */
export function releaseHook(world: World, p: Player): void {
  const h = p.hook;
  if (h.targetId !== null) {
    const enemy = world.enemies.get(h.targetId);
    if (enemy && enemy.pulledBy === p.id) enemy.pulledBy = null;
  }
  h.state = 'idle';
  h.targetId = null;
  h.traveled = 0;
  h.x = p.x;
  h.y = p.y;
}

function updateFlying(world: World, p: Player, dt: number): void {
  const h = p.hook;
  const x0 = h.x;
  const y0 = h.y;
  const step = Math.min(h.speed * dt, h.range - h.traveled);
  h.x += h.dirX * step;
  h.y += h.dirY * step;
  h.traveled += step;

  // The hook bounces off walls.
  const wallT = world.map.raycast(x0, y0, h.x, h.y);
  if (wallT !== null) {
    h.x = x0 + (h.x - x0) * wallT;
    h.y = y0 + (h.y - y0) * wallT;
    h.state = 'retracting';
    world.emit({ type: 'wallHit', x: h.x, y: h.y });
    return;
  }

  // The hook has to hit the target directly (swept circle test, no auto-aim).
  for (const enemy of world.enemies.values()) {
    if (enemy.team === p.team || enemy.pulledBy !== null) continue;
    if (segmentCircleHit(x0, y0, h.x, h.y, enemy.x, enemy.y, enemy.radius + C.radius)) {
      if (h.damage > 0) world.damageEnemy(enemy, h.damage, p.id);
      // Bosses are too heavy to pull (the hook bounces off); a killed target has nothing to pull.
      if (enemy.boss || !world.enemies.has(enemy.id)) {
        h.state = 'retracting';
        return;
      }
      h.state = 'pulling';
      h.pullTime = 0;
      h.targetId = enemy.id;
      h.x = enemy.x;
      h.y = enemy.y;
      enemy.pulledBy = p.id;
      enemy.vx = 0;
      enemy.vy = 0;
      enemy.windup = 0;
      world.emit({ type: 'hookHit', playerId: p.id, targetId: enemy.id });
      return;
    }
  }
  // Enemy players and buildings only take the hit; they are not pulled.
  let struck = false;
  forEachHostile(world, p.team, (kind, id, body) => {
    if (!segmentCircleHit(x0, y0, h.x, h.y, body.x, body.y, body.radius + C.radius)) return false;
    if (h.damage > 0) damageTarget(world, kind, id, h.damage, p.id, h.x, h.y);
    struck = true;
    return true;
  }, { players: true, nexuses: true });
  if (struck) {
    h.state = 'retracting';
    return;
  }

  if (h.traveled >= h.range - EPS) h.state = 'retracting';
}

function updatePulling(world: World, p: Player, dt: number): void {
  const h = p.hook;
  const enemy = h.targetId !== null ? world.enemies.get(h.targetId) : undefined;
  if (!enemy) {
    // Target died or disappeared mid-pull.
    h.targetId = null;
    h.state = 'retracting';
    return;
  }

  const dx = p.x - enemy.x;
  const dy = p.y - enemy.y;
  const dist = length(dx, dy);
  const stopAt = p.radius + enemy.radius + C.releaseGap;
  const move = Math.min(h.pullSpeed * dt, Math.max(0, dist - stopAt));
  if (dist > 0) {
    // The pulled enemy still collides with walls (it slides around corners).
    const resolved = world.map.resolveCircle(enemy.x + (dx / dist) * move, enemy.y + (dy / dist) * move, enemy.radius);
    enemy.x = resolved.x;
    enemy.y = resolved.y;
  }
  h.x = enemy.x;
  h.y = enemy.y;
  h.pullTime += dt;

  if (dist - move <= stopAt + 0.5 || h.pullTime >= C.maxPullTime) releaseHook(world, p);
}

function updateRetracting(world: World, p: Player, dt: number): void {
  const h = p.hook;
  const dx = p.x - h.x;
  const dy = p.y - h.y;
  const dist = length(dx, dy);
  const step = C.retractSpeed * dt;
  if (dist <= step + p.radius) {
    releaseHook(world, p);
    return;
  }
  h.x += (dx / dist) * step;
  h.y += (dy / dist) * step;
}
