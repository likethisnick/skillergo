import { LANES, lanePath, nearestLane, territoryAt, type LaneId } from '../arena';
import { CONFIG } from '../config';
import { distance } from '../math/vec2';
import { TEAMS, otherTeam, type Player, type RegularEnemyKind, type TeamId } from '../types';
import type { World } from '../world';

const V = CONFIG.versus;

/** Places both nexuses and the first farmers. Called once when a versus world is created. */
export function setupArena(world: World): void {
  const arena = world.arena!;
  for (const team of TEAMS) {
    const n = arena.nexus[team];
    world.createNexus(team, n.x, n.y);
    for (let i = 0; i < world.server.farmerCount; i++) spawnFarmer(world, team);
  }
  world.waveTimer = V.firstWaveDelay;
}

/** Versus rules that run every tick: waves, farmer respawns, intruders, escorts, reinforcements. */
export function updateArena(world: World, dt: number): void {
  world.waveTimer -= dt;
  if (world.waveTimer <= 0) {
    for (const team of TEAMS) for (const lane of LANES) spawnWave(world, team, lane);
    world.waveTimer = world.server.waveIntervalSeconds;
  }

  respawnFarmers(world);

  for (const p of world.players.values()) {
    if (!p.alive) continue;
    const intruding = territoryAt(world.arena!, p.x, p.y) === otherTeam(p.team);
    if (intruding) {
      p.intrusionTime += dt;
      callEscorts(world, p);
      if (p.intrusionTime >= V.reinforcementDelay) {
        p.reinforcementTimer -= dt;
        if (p.reinforcementTimer <= 0) {
          sendDefenders(world, p);
          p.reinforcementTimer = world.server.reinforcementSeconds;
        }
      }
    } else {
      p.intrusionTime = Math.max(0, p.intrusionTime - dt * 2);
      p.reinforcementTimer = 0;
    }
  }
}

function teamMobCount(world: World, team: TeamId): number {
  let count = 0;
  for (const e of world.enemies.values()) if (e.team === team && (e.role === 'wave' || e.role === 'defender')) count++;
  return count;
}

/** A wave: `waveSize` mobs in a small formation at the base, marching down one lane. */
function spawnWave(world: World, team: TeamId, lane: LaneId): void {
  if (teamMobCount(world, team) >= V.maxMobsPerTeam) return;
  const path = lanePath(world.arena!, lane, team);
  const start = path[0];
  const next = path[1];
  const len = distance(start.x, start.y, next.x, next.y) || 1;
  const dirX = (next.x - start.x) / len;
  const dirY = (next.y - start.y) / len;
  const composition = V.waveComposition;
  for (let i = 0; i < world.server.waveSize; i++) {
    const kind = composition[i % composition.length] as RegularEnemyKind;
    const row = Math.floor(i / 2);
    const side = i % 2 === 0 ? -1 : 1;
    const x = start.x + dirX * (120 + row * 70) - dirY * side * 45;
    const y = start.y + dirY * (120 + row * 70) + dirX * side * 45;
    const spot = world.findFreeSpot(x, y, 30);
    world.spawnEnemy(kind, spot.x, spot.y, false, { team, role: 'wave', lane });
  }
}

function spawnFarmer(world: World, team: TeamId): void {
  const home = world.arena!.nexus[team];
  const angle = world.rng.angle();
  const r = world.rng.range(V.nexusRadius + 80, V.farmerWanderRadius);
  const spot = world.findFreeSpot(home.x + Math.cos(angle) * r, home.y + Math.sin(angle) * r, V.farmerRadius);
  world.spawnEnemy('farmer', spot.x, spot.y, false, { team, role: 'farmer', homeX: home.x, homeY: home.y });
}

/** Killed farmers come back after `farmerRespawnSeconds`. */
function respawnFarmers(world: World): void {
  for (const team of TEAMS) {
    let alive = 0;
    for (const e of world.enemies.values()) if (e.role === 'farmer' && e.team === team) alive++;
    const queue = world.farmerRespawns;
    const pending = queue.filter((r) => r.team === team).length;
    for (let i = alive + pending; i < world.server.farmerCount; i++) {
      queue.push({ team, at: world.time + world.server.farmerRespawnSeconds });
    }
  }
  for (let i = world.farmerRespawns.length - 1; i >= 0; i--) {
    const r = world.farmerRespawns[i];
    if (world.time >= r.at) {
      spawnFarmer(world, r.team);
      world.farmerRespawns.splice(i, 1);
    }
  }
}

/** Half of our own wave mobs on the same lane follow a player who pushes into enemy ground. */
function callEscorts(world: World, p: Player): void {
  const lane = nearestLane(world.arena!, p.x, p.y);
  for (const e of world.enemies.values()) {
    if (e.team !== p.team || e.role !== 'wave' || e.escortId !== null || e.lane !== lane) continue;
    if (e.id % 2 !== 0) continue; // only part of the wave escorts; the rest keeps pushing
    if (distance(e.x, e.y, p.x, p.y) <= V.escortRadius) e.escortId = p.id;
  }
}

/**
 * The defending side sends a squad for an intruder: it appears off-screen on the way
 * between him and their base, and hunts him while he stays on their half.
 */
function sendDefenders(world: World, p: Player): void {
  const defenders = otherTeam(p.team);
  if (teamMobCount(world, defenders) >= V.maxMobsPerTeam) return;
  const hub = world.arena!.hub[defenders];
  const d = distance(p.x, p.y, hub.x, hub.y) || 1;
  const reach = Math.min(1100, d);
  const cx = p.x + ((hub.x - p.x) / d) * reach;
  const cy = p.y + ((hub.y - p.y) / d) * reach;
  const kinds: RegularEnemyKind[] = ['grunt', 'rusher', 'sniper'];
  for (let i = 0; i < world.server.reinforcementSize; i++) {
    const spot = world.findFreeSpot(cx + world.rng.range(-80, 80), cy + world.rng.range(-80, 80), 30);
    world.spawnEnemy(kinds[i % kinds.length], spot.x, spot.y, false, {
      team: defenders,
      role: 'defender',
      escortId: p.id,
    });
  }
}
