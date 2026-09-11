import { CONFIG } from '../config';
import { segmentCircleHit } from '../math/vec2';
import type { EntityId, Projectile, TargetKind } from '../types';
import type { World } from '../world';
import { shieldCovers } from './abilities';
import { damageTarget, forEachHostile } from './targets';

export function updateProjectiles(world: World, dt: number): void {
  // Deleting from a Map while iterating it is safe in JS.
  for (const pr of world.projectiles.values()) {
    const x0 = pr.x;
    const y0 = pr.y;
    pr.x += pr.vx * dt;
    pr.y += pr.vy * dt;
    pr.life -= dt;

    // Walls stop every bullet except boss attacks. Only the part of the path
    // before the wall can hit anybody.
    const wallT = pr.ignoresWalls ? null : world.map.raycast(x0, y0, pr.x, pr.y);
    if (wallT !== null) {
      pr.x = x0 + (pr.x - x0) * wallT;
      pr.y = y0 + (pr.y - y0) * wallT;
    }

    if (hitSomething(world, pr, x0, y0)) {
      world.projectiles.delete(pr.id);
      continue;
    }
    if (wallT !== null) {
      world.projectiles.delete(pr.id);
      world.emit({ type: 'wallHit', x: pr.x, y: pr.y });
      continue;
    }
    if (pr.life <= 0 || pr.x < 0 || pr.y < 0 || pr.x > world.width || pr.y > world.height) {
      world.projectiles.delete(pr.id);
    }
  }
}

/** The earliest hostile body along the bullet's path this tick takes the hit. */
function hitSomething(world: World, pr: Projectile, x0: number, y0: number): boolean {
  const dx = pr.x - x0;
  const dy = pr.y - y0;
  const lenSq = dx * dx + dy * dy || 1;
  const candidates: { kind: TargetKind; id: EntityId; t: number }[] = [];

  forEachHostile(world, pr.team, (kind, id, body) => {
    let reach = body.radius + pr.radius;
    if (kind === 'player') {
      // An active shield facing the shot catches it a bit before it reaches the body.
      const p = world.players.get(id);
      if (p && shieldCovers(p, x0, y0)) reach = p.radius + CONFIG.abilities.shield.offset + pr.radius;
    }
    if (!segmentCircleHit(x0, y0, pr.x, pr.y, body.x, body.y, reach)) return;
    const t = ((body.x - x0) * dx + (body.y - y0) * dy) / lenSq;
    candidates.push({ kind, id, t });
  });
  if (candidates.length === 0) return false;

  candidates.sort((a, b) => a.t - b.t);
  for (const c of candidates) {
    // A dashing player lets the bullet through; it may still hit someone behind.
    if (damageTarget(world, c.kind, c.id, pr.damage, pr.ownerId, x0, y0)) return true;
  }
  return false;
}
