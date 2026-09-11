import { CONFIG } from '../config';
import { distanceSq, length } from '../math/vec2';
import type { Orb, Player } from '../types';
import type { World } from '../world';
import { applyPowerUp } from './powerups';

const C = CONFIG.orb;

export function updateOrbs(world: World, dt: number): void {
  for (const orb of world.orbs.values()) {
    orb.life -= dt;
    if (orb.life <= 0) {
      world.orbs.delete(orb.id);
      continue;
    }

    let target = orb.attractedTo !== null ? world.players.get(orb.attractedTo) : undefined;
    if (target && (!target.alive || !wants(orb, target))) target = undefined;

    // Once an orb locks on a player it keeps following him (feels better than a hard radius).
    if (!target) {
      orb.attractedTo = null;
      target = findCollector(world, orb);
      if (!target) continue;
      orb.attractedTo = target.id;
      orb.speed = C.magnetStartSpeed;
    }

    orb.speed += C.magnetAcceleration * dt;
    const dx = target.x - orb.x;
    const dy = target.y - orb.y;
    const dist = length(dx, dy);
    const step = orb.speed * dt;

    if (dist <= target.radius || dist <= step) {
      world.orbs.delete(orb.id);
      collect(world, orb, target);
      continue;
    }
    orb.x += (dx / dist) * step;
    orb.y += (dy / dist) * step;
  }
}

/** Heal orbs are left on the ground for later while the player is at full HP. */
function wants(orb: Orb, p: Player): boolean {
  if (orb.denyTeam === p.team) return false; // drops of your own units are for the enemy
  return orb.kind !== 'heal' || p.hp < p.maxHp;
}

function findCollector(world: World, orb: Orb): Player | undefined {
  let best: Player | undefined;
  let bestSq = C.magnetRadius * C.magnetRadius;
  for (const p of world.players.values()) {
    if (!p.alive || !wants(orb, p)) continue;
    const d = distanceSq(orb.x, orb.y, p.x, p.y);
    if (d <= bestSq) {
      best = p;
      bestSq = d;
    }
  }
  return best;
}

function collect(world: World, orb: Orb, p: Player): void {
  if (orb.kind === 'power') {
    if (orb.power) applyPowerUp(world, p, orb.power);
    return;
  }
  if (orb.kind === 'heal') {
    const amount = Math.min(p.maxHp - p.hp, p.maxHp * CONFIG.drops.healFraction);
    p.hp += amount;
    world.emit({ type: 'heal', playerId: p.id, amount: Math.round(amount) });
    return;
  }
  world.emit({ type: 'pickup', playerId: p.id, xp: orb.xp });
  world.grantXp(p, orb.xp);
}
