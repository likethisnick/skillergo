import {
  BOSS_KINDS,
  EMPTY_INPUT,
  POWER_UP_KINDS,
  REGULAR_ENEMY_KINDS,
  TEAMS,
  type Enemy,
  type EnemyKind,
  type EnemyRole,
  type GameEvent,
  type Nexus,
  type Orb,
  type OrbKind,
  type Player,
  type Projectile,
  type TeamId,
  type Tower,
  type WorldView,
} from '../types';

/**
 * World state as sent to clients about 30 times per second.
 * Players, towers and nexuses travel as (rounded) objects; the many small things
 * (mobs, bullets, orbs) as flat number arrays to keep the JSON short.
 */
export interface SnapshotMessage {
  t: 's';
  tick: number;
  time: number;
  /** Last input sequence number the server applied for the receiving player. */
  ack: number;
  winner: TeamId | null;
  pl: WirePlayer[];
  en: number[][];
  pr: number[][];
  or: number[][];
  tw: Tower[];
  nx: Nexus[];
  /** Everything that happened since the previous snapshot. */
  ev: GameEvent[];
}

/** Player without the server-only bookkeeping (input, run log, request counters). */
export type WirePlayer = Omit<Player, 'input' | 'upgradeLog' | 'prevAbilityHeld' | 'upgradeRequests'>;

const ENEMY_KINDS: readonly EnemyKind[] = [...REGULAR_ENEMY_KINDS, ...BOSS_KINDS, 'dummy', 'farmer'];
const ROLES: readonly EnemyRole[] = ['survival', 'wave', 'defender', 'farmer', 'guardian'];
const ORB_KINDS: readonly OrbKind[] = ['xp', 'heal', 'power'];

/** Stand-in for +-Infinity (JSON has no Infinity; "never happened" timestamps use it). */
const FAR = 1e9;

const r1 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v > 0 ? FAR : -FAR);
const r2 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v > 0 ? FAR : -FAR);
const r3 = (v: number): number => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v > 0 ? FAR : -FAR);
const teamIndex = (team: TeamId): number => (team === 'blue' ? 0 : 1);
const indexOf = <T>(list: readonly T[], value: T): number => Math.max(0, list.indexOf(value));

/** Deep copy with every number rounded to 2 decimals (and Infinity made JSON-safe). */
export function roundValues<T>(value: T): T {
  if (typeof value === 'number') return r2(value) as T;
  if (Array.isArray(value)) return value.map(roundValues) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = roundValues(v);
    return out as T;
  }
  return value;
}

// ------------------------------------------------------------------- encoding

/** Everything except `t` and `ack`, which differ per receiver. */
export function encodeSnapshotBody(
  world: WorldView & { tick: number },
  events: readonly GameEvent[],
): Omit<SnapshotMessage, 't' | 'ack'> {
  const pl: WirePlayer[] = [];
  for (const p of world.players.values()) {
    const { input: _input, upgradeLog: _log, prevAbilityHeld: _held, upgradeRequests: _requests, ...rest } = p;
    pl.push(roundValues({ ...rest, killStats: { ...rest.killStats, byKind: {} } }));
  }
  const en: number[][] = [];
  for (const e of world.enemies.values()) {
    en.push([
      e.id, indexOf(ENEMY_KINDS, e.kind), teamIndex(e.team), indexOf(ROLES, e.role), (e.boss ? 1 : 0) | (e.elite ? 2 : 0),
      r1(e.x), r1(e.y), r1(e.radius), r1(e.hp), r1(e.maxHp), r3(e.aim), r2(e.windup), r2(e.burstTimer),
      r1(e.vx), r1(e.vy), r2(e.lastAttackTime), e.pulledBy ?? -1, r2(e.age), r2(e.hitFlash),
    ]);
  }
  const pr: number[][] = [];
  for (const b of world.projectiles.values()) {
    const source = b.source === 'player' ? 0 : indexOf(ENEMY_KINDS, b.source) + 1;
    pr.push([b.id, b.ownerId, teamIndex(b.team), source, r1(b.x), r1(b.y), r1(b.vx), r1(b.vy), r1(b.radius)]);
  }
  const or: number[][] = [];
  for (const o of world.orbs.values()) {
    or.push([
      o.id, indexOf(ORB_KINDS, o.kind), r1(o.x), r1(o.y), r1(o.radius), o.xp,
      o.power ? indexOf(POWER_UP_KINDS, o.power) : -1, o.reduced ? 1 : 0, r2(o.life),
      o.denyTeam ? teamIndex(o.denyTeam) : -1,
    ]);
  }
  return {
    tick: world.tick,
    time: r3(world.time),
    winner: world.winner,
    pl,
    en,
    pr,
    or,
    tw: [...world.towers.values()].map(roundValues),
    nx: [...world.nexuses.values()].map(roundValues),
    ev: events.map(roundValues),
  };
}

// ------------------------------------------------------------------- decoding

export function decodePlayer(w: WirePlayer): Player {
  return {
    ...w,
    input: { ...EMPTY_INPUT, upgrades: { ...EMPTY_INPUT.upgrades } },
    upgradeLog: [],
    upgradeRequests: { weapon: 0, mobility: 0, ability: 0 },
    prevAbilityHeld: false,
  };
}

export function decodeEnemy(a: readonly number[]): Enemy {
  const pulledBy = a[16];
  return {
    id: a[0],
    kind: ENEMY_KINDS[a[1]] ?? 'grunt',
    team: TEAMS[a[2]] ?? 'red',
    role: ROLES[a[3]] ?? 'wave',
    boss: (a[4] & 1) !== 0,
    elite: (a[4] & 2) !== 0,
    x: a[5],
    y: a[6],
    radius: a[7],
    hp: a[8],
    maxHp: a[9],
    aim: a[10],
    windup: a[11],
    burstTimer: a[12],
    vx: a[13],
    vy: a[14],
    lastAttackTime: a[15],
    pulledBy: pulledBy >= 0 ? pulledBy : null,
    age: a[17],
    hitFlash: a[18],
    // Not sent: only the simulation needs them.
    lane: null,
    waypoint: 0,
    homeX: a[5],
    homeY: a[6],
    targetKind: null,
    targetId: null,
    retargetTimer: 0,
    escortId: null,
    xp: 0,
    wanderTimer: 0,
    strafeDir: 1,
    slotAngle: 0,
    distanceScale: 1,
    attackCooldown: 0,
    contactCooldown: 0,
    retreatTimer: 0,
    lastHitTime: -FAR,
  };
}

export function decodeProjectile(a: readonly number[]): Projectile {
  return {
    id: a[0],
    ownerId: a[1],
    team: TEAMS[a[2]] ?? 'red',
    source: a[3] === 0 ? 'player' : ENEMY_KINDS[a[3] - 1] ?? 'grunt',
    x: a[4],
    y: a[5],
    vx: a[6],
    vy: a[7],
    radius: a[8],
    life: 1,
    damage: 0,
    ignoresWalls: false,
    piercesBuildings: false,
    aimedAt: null,
  };
}

export function decodeOrb(a: readonly number[]): Orb {
  return {
    id: a[0],
    kind: ORB_KINDS[a[1]] ?? 'xp',
    x: a[2],
    y: a[3],
    radius: a[4],
    xp: a[5],
    power: a[6] >= 0 ? POWER_UP_KINDS[a[6]] ?? null : null,
    reduced: a[7] === 1,
    life: a[8],
    denyTeam: a[9] >= 0 ? TEAMS[a[9]] ?? null : null,
    attractedTo: null,
    speed: 0,
  };
}

/** Wall grid as one digit per tile. */
export function encodeTiles(tiles: Uint8Array): string {
  let out = '';
  for (const t of tiles) out += String.fromCharCode(48 + t);
  return out;
}

export function decodeTiles(text: string, target: Uint8Array): void {
  for (let i = 0; i < target.length && i < text.length; i++) target[i] = text.charCodeAt(i) - 48;
}
