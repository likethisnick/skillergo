import type { AbilityType, EnemyKind, GameMode, GameSettings, UpgradeLogEntry, UpgradeRanks, WeaponType } from './types';
import type { World } from './world';

export type RunEndReason = 'death' | 'finished' | 'restart' | 'menu' | 'closed';

/** One finished run, as written to the history log (one JSON object per line). */
export interface RunSummary {
  version: 1;
  startedAt: string;
  endedAt: string;
  /** Simulated play time in seconds. */
  durationSeconds: number;
  endReason: RunEndReason;
  mode: GameMode;
  /** Versus only: how the match ended for this player (null if it did not end). */
  result: 'victory' | 'defeat' | null;
  /** Versus: how many times the player died. */
  deaths: number;
  settings: GameSettings;
  /** Server config values that change the pace of a run, for comparing runs. */
  balance: { difficultyGrowthRate: number; xpMultiplier: number };
  /** 0..1: how far the difficulty ramp got. */
  difficultyReached: number;
  weapon: WeaponType;
  ability: AbilityType;
  level: number;
  /** XP collected towards the next level. */
  xp: number;
  upgrades: {
    ranks: UpgradeRanks;
    unspentPoints: number;
    history: UpgradeLogEntry[];
  };
  kills: {
    total: number;
    regular: number;
    elite: number;
    boss: number;
    /** Versus: enemy players killed. */
    players: number;
    byKind: Partial<Record<EnemyKind, number>>;
  };
}

/** Builds the history entry for a player. Works the same on the client and on a future server. */
export function buildRunSummary(
  world: World,
  playerId: number,
  meta: { startedAt: Date; endedAt?: Date; endReason: RunEndReason },
): RunSummary | null {
  const p = world.players.get(playerId);
  if (!p) return null;
  return {
    version: 1,
    startedAt: meta.startedAt.toISOString(),
    endedAt: (meta.endedAt ?? new Date()).toISOString(),
    durationSeconds: Math.round(world.time * 10) / 10,
    endReason: meta.endReason,
    mode: world.mode,
    result: world.winner ? (world.winner === p.team ? 'victory' : 'defeat') : null,
    deaths: p.deaths,
    settings: { ...world.settings },
    balance: { difficultyGrowthRate: world.server.difficultyGrowthRate, xpMultiplier: world.server.xpMultiplier },
    difficultyReached: Math.round(world.intensity * 1000) / 1000,
    weapon: p.weapon,
    ability: p.ability,
    level: p.level,
    xp: p.xp,
    upgrades: {
      ranks: { ...p.ranks },
      unspentPoints: p.upgradePoints,
      history: p.upgradeLog.map((entry) => ({ ...entry })),
    },
    kills: {
      total: p.kills,
      regular: p.killStats.regular,
      elite: p.killStats.elite,
      boss: p.killStats.boss,
      players: p.killStats.players,
      byKind: { ...p.killStats.byKind },
    },
  };
}

/** Minimal shape check for summaries received over the network. */
export function isRunSummary(value: unknown): value is RunSummary {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<RunSummary>;
  return (
    v.version === 1 &&
    typeof v.durationSeconds === 'number' &&
    typeof v.level === 'number' &&
    typeof v.weapon === 'string' &&
    typeof v.ability === 'string' &&
    !!v.kills && typeof v.kills.total === 'number' &&
    !!v.upgrades && typeof v.upgrades.ranks === 'object'
  );
}
