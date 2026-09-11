import { CONFIG } from '../config';
import { distanceSq, wrapAngle } from '../math/vec2';
import { targetPopulation } from '../difficulty';
import { BOSS_KINDS, REGULAR_ENEMY_KINDS, type Player, type RegularEnemyKind } from '../types';
import type { World } from '../world';

const S = CONFIG.spawner;

/**
 * Keeps a level- and difficulty-dependent number of enemies around every player
 * and brings in a boss every N regular kills. Enemies only appear where no player
 * can see them and walk in from off-screen.
 */
export function updateSpawner(world: World, dt: number): void {
  // The training room only has what the player spawns by hand.
  if (world.isTraining) return;

  despawnFarEnemies(world);
  spawnBossIfDue(world);

  let needy: Player | undefined;
  if (world.enemies.size < world.mods.maxEnemies) {
    for (const p of world.players.values()) {
      if (p.alive && countRegularEnemiesAround(world, p) < targetPopulation(world.mods)) {
        needy = p;
        break;
      }
    }
  }

  // The timer only runs while somebody lacks enemies, so a kill
  // is followed by a short breather before the next spawn.
  if (!needy) {
    world.spawnTimer = world.mods.spawnInterval;
    return;
  }
  world.spawnTimer -= dt;
  if (world.spawnTimer > 0) return;

  const point = findHiddenSpawnPoint(world, needy);
  if (point) {
    const elite = world.rng.next() < world.mods.eliteChance;
    world.spawnEnemy(pickRegularKind(world), point.x, point.y, elite);
    world.spawnTimer = world.mods.spawnInterval;
  }
}

export function countRegularEnemiesAround(world: World, p: Player): number {
  const radiusSq = S.activityRadius * S.activityRadius;
  let count = 0;
  for (const e of world.enemies.values()) {
    if (!e.boss && distanceSq(e.x, e.y, p.x, p.y) <= radiusSq) count++;
  }
  return count;
}

function despawnFarEnemies(world: World): void {
  const despawnSq = S.despawnDistance * S.despawnDistance;
  for (const e of world.enemies.values()) {
    if (e.pulledBy !== null || e.boss) continue;
    const nearest = world.nearestPlayer(e.x, e.y);
    if (!nearest || distanceSq(e.x, e.y, nearest.x, nearest.y) > despawnSq) {
      world.enemies.delete(e.id);
    }
  }
}

/** One boss at a time; kinds rotate Colossus -> Duelist -> Blademaster. */
function spawnBossIfDue(world: World): void {
  if (world.killsSinceBoss < world.mods.bossEveryKills || world.aliveBoss()) return;
  const target = world.nearestPlayer(world.width / 2, world.height / 2);
  if (!target) return;
  const point = findHiddenSpawnPoint(world, target);
  if (!point) return;
  const kind = BOSS_KINDS[world.bossIndex % BOSS_KINDS.length];
  world.bossIndex++;
  world.killsSinceBoss = 0;
  world.spawnEnemy(kind, point.x, point.y);
}

/** Largest spawnable body radius (elite grunt), so any enemy fits the chosen spot. */
const SPAWN_CLEARANCE = 40;

/**
 * Point on a ring around `p` that is outside every alive player's screen and not in a wall.
 * Among a few random candidates it takes the direction with the fewest enemies,
 * so new enemies arrive from all sides instead of piling up on one.
 */
function findHiddenSpawnPoint(world: World, p: Player): { x: number; y: number } | null {
  const { width, height } = world;
  const margin = 80;
  const hiddenSq = S.hiddenRadius * S.hiddenRadius;
  const radiusSq = S.activityRadius * S.activityRadius;
  const occupied: number[] = [];
  for (const e of world.enemies.values()) {
    if (distanceSq(e.x, e.y, p.x, p.y) <= radiusSq) occupied.push(Math.atan2(e.y - p.y, e.x - p.x));
  }

  let best: { x: number; y: number } | null = null;
  let bestGap = -1;
  for (let attempt = 0; attempt < 24; attempt++) {
    const angle = world.rng.angle();
    const dist = S.hiddenRadius + world.rng.range(0, S.spawnRingWidth);
    const x = p.x + Math.cos(angle) * dist;
    const y = p.y + Math.sin(angle) * dist;
    if (x < margin || y < margin || x > width - margin || y > height - margin) continue;
    if (!world.map.circleFree(x, y, SPAWN_CLEARANCE)) continue;

    let seen = false;
    for (const other of world.players.values()) {
      if (other.alive && distanceSq(x, y, other.x, other.y) < hiddenSq) {
        seen = true;
        break;
      }
    }
    if (seen) continue;

    let gap = Math.PI;
    for (const a of occupied) gap = Math.min(gap, Math.abs(wrapAngle(a - angle)));
    if (gap > bestGap) {
      bestGap = gap;
      best = { x, y };
    }
  }
  return best;
}

function pickRegularKind(world: World): RegularEnemyKind {
  const E = CONFIG.enemies;
  let total = 0;
  for (const kind of REGULAR_ENEMY_KINDS) total += E[kind].spawnWeight;
  let roll = world.rng.next() * total;
  for (const kind of REGULAR_ENEMY_KINDS) {
    roll -= E[kind].spawnWeight;
    if (roll < 0) return kind;
  }
  return 'grunt';
}
