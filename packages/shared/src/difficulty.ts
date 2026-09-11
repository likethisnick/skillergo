import { CONFIG } from './config';
import { clamp } from './math/vec2';
import { xpToNextLevel } from './progression';
import type { GameSettings, Player } from './types';

const D = CONFIG.difficulty;
const SP = CONFIG.speedSetting;

export const DEFAULT_SETTINGS: Readonly<GameSettings> = {
  difficulty: D.default,
  speed: SP.default,
};

/** Everything difficulty, progress and the speed setting change. Recomputed every tick. */
export interface DifficultyModifiers {
  /** 0..1 progress of the difficulty ramp. */
  intensity: number;
  /** Multiplier for the number of regular enemies around a player. */
  population: number;
  spawnInterval: number;
  enemyHp: number;
  enemyDamage: number;
  /** Divides enemy attack cooldowns. */
  fireRate: number;
  /** 0..1, narrows the grunts' random spread. */
  accuracy: number;
  eliteChance: number;
  bossEveryKills: number;
  /** Enemy movement multiplier (speed setting x difficulty ramp). */
  moveSpeed: number;
  /** Enemy bullet speed multiplier (speed setting x difficulty ramp). */
  projectileSpeed: number;
  maxEnemies: number;
}

export function normalizeSettings(settings: Partial<GameSettings>): GameSettings {
  const difficulty = Math.round(clamp(Number(settings.difficulty) || D.default, D.min, D.max));
  const speed = Math.round(clamp(Number(settings.speed) || SP.default, SP.min, SP.max) * 10) / 10;
  return { difficulty, speed };
}

/** 0 at the start of level 1, 1 at `peakLevel`; grows smoothly with XP inside a level. */
export function levelProgress(p: Readonly<Player>): number {
  const progress = p.level - CONFIG.progression.startLevel + p.xp / xpToNextLevel(p.level);
  return clamp(progress / (D.peakLevel - CONFIG.progression.startLevel), 0, 1);
}

/**
 * Difficulty ramp position 0..1, see `ServerConfig.difficultyGrowthRate`.
 * The level term dominates at normal rates; the time term (quadratic in the rate)
 * only matters for very fast rates, so rate 100 peaks within about a second.
 */
export function rampIntensity(progress: number, seconds: number, growthRate: number): number {
  const rate = Math.max(0, growthRate);
  return clamp(rate * progress + (rate / 100) ** 2 * seconds, 0, 1);
}

/**
 * At intensity 0 every difficulty is the same baseline.
 * At intensity 1 the stats reach the peak that the chosen difficulty allows.
 */
export function getModifiers(settings: GameSettings, intensity = 0): DifficultyModifiers {
  const growth = (settings.difficulty / D.max) * clamp(intensity, 0, 1);
  const lerp = (range: readonly [number, number]): number => range[0] + (range[1] - range[0]) * growth;
  return {
    intensity,
    population: lerp(D.population),
    spawnInterval: CONFIG.spawner.interval / lerp(D.spawnRate),
    enemyHp: lerp(D.enemyHp),
    enemyDamage: lerp(D.enemyDamage),
    fireRate: lerp(D.fireRate),
    accuracy: lerp(D.accuracy),
    eliteChance: lerp(D.eliteChance),
    bossEveryKills: Math.round(lerp(D.bossEveryKills)),
    moveSpeed: settings.speed * lerp(D.enemySpeed),
    projectileSpeed: settings.speed * lerp(D.projectileSpeed),
    maxEnemies: D.maxEnemies,
  };
}

/** Regular enemies the spawner keeps around each player. */
export function targetPopulation(mods: DifficultyModifiers): number {
  return Math.min(mods.maxEnemies, Math.round(CONFIG.spawner.basePopulation * mods.population));
}

/** Human-readable difficulty tier for UI. */
export function difficultyLabel(difficulty: number): string {
  if (difficulty <= 5) return 'Easy';
  if (difficulty <= 10) return 'Normal';
  if (difficulty <= 15) return 'Hard';
  if (difficulty <= 20) return 'Brutal';
  if (difficulty <= 25) return 'Insane';
  return 'Impossible';
}
