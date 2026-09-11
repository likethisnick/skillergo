import type { Body, EntityId, TargetKind, TeamId } from '../types';
import type { World } from '../world';

export interface TargetFilter {
  players?: boolean;
  enemies?: boolean;
  nexuses?: boolean;
}

const ALL: TargetFilter = { players: true, enemies: true, nexuses: true };

/**
 * Calls `fn` for every alive body hostile to `team`: players, enemy units and nexuses.
 * Return `true` from `fn` to stop early.
 */
export function forEachHostile(
  world: World,
  team: TeamId,
  fn: (kind: TargetKind, id: EntityId, body: Body) => boolean | void,
  filter: TargetFilter = ALL,
): void {
  if (filter.players) {
    for (const p of world.players.values()) {
      if (p.alive && p.team !== team && fn('player', p.id, p)) return;
    }
  }
  if (filter.enemies) {
    for (const e of world.enemies.values()) {
      if (e.team !== team && fn('enemy', e.id, e)) return;
    }
  }
  if (filter.nexuses) {
    for (const n of world.nexuses.values()) {
      if (n.team !== team && n.hp > 0 && fn('nexus', n.id, n)) return;
    }
  }
}

export function getTarget(world: World, kind: TargetKind, id: EntityId): Body | undefined {
  if (kind === 'player') {
    const p = world.players.get(id);
    return p && p.alive ? p : undefined;
  }
  if (kind === 'enemy') return world.enemies.get(id);
  const n = world.nexuses.get(id);
  return n && n.hp > 0 ? n : undefined;
}

/**
 * Routes damage to whatever was hit. Returns false when the hit did not land
 * (a dashing player), so a bullet can fly on.
 */
export function damageTarget(
  world: World, kind: TargetKind, id: EntityId,
  damage: number, sourceId: EntityId, fromX: number, fromY: number,
): boolean {
  if (kind === 'player') {
    const p = world.players.get(id);
    return !!p && world.damagePlayer(p, damage, fromX, fromY, sourceId) !== 'ignored';
  }
  if (kind === 'enemy') {
    const e = world.enemies.get(id);
    if (e) world.damageEnemy(e, damage, sourceId);
    return true;
  }
  const n = world.nexuses.get(id);
  if (n) world.damageNexus(n, damage, sourceId, fromX, fromY);
  return true;
}
