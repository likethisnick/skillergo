import { CONFIG } from '../config';
import { distanceSq } from '../math/vec2';
import type { Body, EntityId, TargetKind, Tower } from '../types';
import type { World } from '../world';
import { canBeTargeted, damageTarget, getTarget } from './targets';

interface TowerTarget {
  kind: TargetKind;
  id: EntityId;
  body: Body;
}

/**
 * Lane towers (versus). Each one shoots the nearest hostile mob in range; players only
 * when no mob is around, or right away when a player hurts an allied player in range
 * (no free fights under an enemy tower). Shots hit instantly.
 */
export function updateTowers(world: World, dt: number): void {
  for (const tower of world.towers.values()) {
    tower.attackCooldown = Math.max(0, tower.attackCooldown - dt);
    const target = pickTarget(world, tower);
    tower.targetKind = target ? target.kind : null;
    tower.targetId = target ? target.id : null;
    if (!target || tower.attackCooldown > 0) continue;

    tower.attackCooldown = world.server.towerAttackSeconds;
    world.emit({
      type: 'towerShot', towerId: tower.id, team: tower.team,
      x: tower.x, y: tower.y, targetX: target.body.x, targetY: target.body.y,
    });
    damageTarget(world, target.kind, target.id, world.server.towerDamage, tower.id, tower.x, tower.y);
  }
}

function pickTarget(world: World, tower: Tower): TowerTarget | null {
  const range = world.server.towerRange;
  const inRange = (b: Body): boolean => distanceSq(b.x, b.y, tower.x, tower.y) <= (range + b.radius) ** 2;

  // 1. A player attacking one of our players under the tower.
  for (const p of world.players.values()) {
    if (!p.alive || p.cloakTimer > 0 || p.team === tower.team || !inRange(p)) continue;
    for (const ally of world.players.values()) {
      if (ally.team !== tower.team || !ally.alive || ally.lastHitBy !== p.id) continue;
      if (world.time - ally.lastDamageTime <= CONFIG.versus.towerAggroMemory && inRange(ally)) {
        return { kind: 'player', id: p.id, body: p };
      }
    }
  }

  // 2. Keep shooting the current target while it stays in range (except a player once mobs arrive).
  if (tower.targetKind && tower.targetId !== null) {
    const current = getTarget(world, tower.targetKind, tower.targetId);
    const visible = canBeTargeted(world, tower.targetKind, tower.targetId);
    if (current && visible && inRange(current) && (tower.targetKind !== 'player' || !hasMobInRange(world, tower, inRange))) {
      return { kind: tower.targetKind, id: tower.targetId, body: current };
    }
  }

  // 3. The nearest hostile mob, 4. otherwise the nearest hostile player.
  let best: TowerTarget | null = null;
  let bestSq = Infinity;
  for (const e of world.enemies.values()) {
    if (e.team === tower.team || e.boss || !inRange(e)) continue;
    const d = distanceSq(e.x, e.y, tower.x, tower.y);
    if (d < bestSq) {
      bestSq = d;
      best = { kind: 'enemy', id: e.id, body: e };
    }
  }
  if (best) return best;
  for (const p of world.players.values()) {
    if (!p.alive || p.cloakTimer > 0 || p.team === tower.team || !inRange(p)) continue;
    const d = distanceSq(p.x, p.y, tower.x, tower.y);
    if (d < bestSq) {
      bestSq = d;
      best = { kind: 'player', id: p.id, body: p };
    }
  }
  return best;
}

function hasMobInRange(world: World, tower: Tower, inRange: (b: Body) => boolean): boolean {
  for (const e of world.enemies.values()) if (e.team !== tower.team && !e.boss && inRange(e)) return true;
  return false;
}
