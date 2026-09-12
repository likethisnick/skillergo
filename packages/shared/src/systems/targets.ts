import type { Body, EntityId, TargetKind, TeamId } from '../types';
import type { World } from '../world';

export interface TargetFilter {
  players?: boolean;
  enemies?: boolean;
  /** Nexuses and towers. */
  buildings?: boolean;
}

const ALL: TargetFilter = { players: true, enemies: true, buildings: true };

export function isBuilding(kind: TargetKind): kind is 'nexus' | 'tower' {
  return kind === 'nexus' || kind === 'tower';
}

/**
 * Calls `fn` for every alive body hostile to `team`: players, enemy units, nexuses and towers.
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
  if (filter.buildings) {
    for (const t of world.towers.values()) {
      if (t.team !== team && fn('tower', t.id, t)) return;
    }
    for (const n of world.nexuses.values()) {
      if (n.team !== team && n.hp > 0 && fn('nexus', n.id, n)) return;
    }
  }
}

/** Can AI (mobs, towers, the bot) pick this target? A cloaked player cannot be seen. */
export function canBeTargeted(world: World, kind: TargetKind, id: EntityId): boolean {
  if (kind !== 'player') return true;
  const p = world.players.get(id);
  return !!p && p.alive && p.cloakTimer <= 0;
}

export function getTarget(world: World, kind: TargetKind, id: EntityId): Body | undefined {
  switch (kind) {
    case 'player': {
      const p = world.players.get(id);
      return p && p.alive ? p : undefined;
    }
    case 'enemy':
      return world.enemies.get(id);
    case 'tower':
      return world.towers.get(id);
    case 'nexus': {
      const n = world.nexuses.get(id);
      return n && n.hp > 0 ? n : undefined;
    }
  }
}

/**
 * Routes damage to whatever was hit. Returns false when the hit did not land
 * (a dashing player), so a bullet can fly on.
 */
export function damageTarget(
  world: World, kind: TargetKind, id: EntityId,
  damage: number, sourceId: EntityId, fromX: number, fromY: number,
): boolean {
  switch (kind) {
    case 'player': {
      const p = world.players.get(id);
      return !!p && world.damagePlayer(p, damage, fromX, fromY, sourceId) !== 'ignored';
    }
    case 'enemy': {
      const e = world.enemies.get(id);
      if (e) world.damageEnemy(e, damage, sourceId);
      return true;
    }
    case 'tower': {
      const t = world.towers.get(id);
      if (t) world.damageTower(t, damage, sourceId, fromX, fromY);
      return true;
    }
    case 'nexus': {
      const n = world.nexuses.get(id);
      if (n) world.damageNexus(n, damage, sourceId, fromX, fromY);
      return true;
    }
  }
}
