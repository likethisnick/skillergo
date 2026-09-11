import fileConfig from '../../../game.config.json';

/**
 * Main balance knobs. The values live in `game.config.json` in the project root
 * (plain "name": value pairs). This file only declares the types and the fallbacks
 * used when a key is missing or has a wrong type.
 *
 * A future game server loads the same JSON and passes it to `new World({ server })`.
 */
export interface ServerConfig {
  /** 0 = never grows, 1 = normal (peak at level 10), 100 = peak within a second. */
  difficultyGrowthRate: number;
  xpMultiplier: number;

  playerSpeed: number;
  dashCooldown: number;
  dashDistance: number;
  /** Share of free ground covered by tetromino walls. */
  obstacleDensity: number;

  gunDamage: number;
  swordDamage: number;
  beamDamagePerSecond: number;
  hookDamage: number;
  shotgunDamage: number;

  /** Base enemy speed; every type below is a multiplier of it. */
  enemySpeed: number;
  gruntSpeedMultiplier: number;
  rusherSpeedMultiplier: number;
  sniperSpeedMultiplier: number;
  farmerSpeedMultiplier: number;
  colossusSpeedMultiplier: number;
  duelistSpeedMultiplier: number;
  blademasterSpeedMultiplier: number;
  wanderSpeedMultiplier: number;

  /** Base bullet speed; every bullet type below is a multiplier of it. */
  bulletSpeed: number;
  playerBulletSpeedMultiplier: number;
  gruntBulletSpeedMultiplier: number;
  sniperBulletSpeedMultiplier: number;
  colossusBulletSpeedMultiplier: number;
  duelistBulletSpeedMultiplier: number;

  // Versus mode.
  respawnSeconds: number;
  respawnSecondsPerLevel: number;
  nexusHp: number;
  towersPerLane: number;
  towerHp: number;
  /** Damage of one tower shot (mobs and players alike) and seconds between shots. */
  towerDamage: number;
  towerAttackSeconds: number;
  towerRange: number;
  /** A falling tower wipes the attacking mobs within this radius. */
  towerBlastRadius: number;
  /** Guardian bosses burn hostile mobs around them (mobs cannot hurt bosses). */
  guardianAuraRadius: number;
  guardianAuraDamagePerSecond: number;
  /** XP left in a mob's drop when no player finished it off (0.4 = cut by 60%). */
  nonPlayerKillXpMultiplier: number;
  waveIntervalSeconds: number;
  waveSize: number;
  /** Mobs deal this much more damage on their own half of the map. */
  homeDefenseBonus: number;
  /** While a player stays on enemy ground, a defender squad comes for him this often. */
  reinforcementSeconds: number;
  reinforcementSize: number;
  farmerCount: number;
  farmerHp: number;
  farmerXp: number;
  farmerRespawnSeconds: number;
  playerKillXp: number;
  playerKillXpPerLevel: number;
  /** XP curve in versus mode: versusLevelXp + versusLevelXpStep per level. */
  versusLevelXp: number;
  versusLevelXpStep: number;

  historyEnabled: boolean;
  historyDir: string;
  historyFile: string;
}

/** Used when `game.config.json` lacks a key. Keep in sync with the JSON file. */
const FALLBACK: ServerConfig = {
  difficultyGrowthRate: 1,
  xpMultiplier: 1,
  playerSpeed: 280,
  dashCooldown: 1.5,
  dashDistance: 112,
  obstacleDensity: 0.2,
  gunDamage: 50,
  swordDamage: 70,
  beamDamagePerSecond: 40,
  hookDamage: 20,
  shotgunDamage: 120,
  enemySpeed: 100,
  gruntSpeedMultiplier: 1.1,
  rusherSpeedMultiplier: 3.2,
  sniperSpeedMultiplier: 0.9,
  farmerSpeedMultiplier: 0.7,
  colossusSpeedMultiplier: 0.45,
  duelistSpeedMultiplier: 6.5,
  blademasterSpeedMultiplier: 3,
  wanderSpeedMultiplier: 0.6,
  bulletSpeed: 600,
  playerBulletSpeedMultiplier: 1.5,
  gruntBulletSpeedMultiplier: 0.9,
  sniperBulletSpeedMultiplier: 1.9,
  colossusBulletSpeedMultiplier: 0.32,
  duelistBulletSpeedMultiplier: 1.6,
  respawnSeconds: 5,
  respawnSecondsPerLevel: 3,
  nexusHp: 30000,
  towersPerLane: 2,
  towerHp: 4000,
  towerDamage: 60,
  towerAttackSeconds: 1,
  towerRange: 700,
  towerBlastRadius: 2560,
  guardianAuraRadius: 420,
  guardianAuraDamagePerSecond: 200,
  nonPlayerKillXpMultiplier: 0.4,
  waveIntervalSeconds: 30,
  waveSize: 6,
  homeDefenseBonus: 0.25,
  reinforcementSeconds: 10,
  reinforcementSize: 3,
  farmerCount: 5,
  farmerHp: 300,
  farmerXp: 150,
  farmerRespawnSeconds: 30,
  playerKillXp: 60,
  playerKillXpPerLevel: 8,
  versusLevelXp: 1500,
  versusLevelXpStep: 400,
  historyEnabled: true,
  historyDir: 'logs',
  historyFile: 'history.jsonl',
};

/** Values from `game.config.json` with fallbacks applied. */
export const DEFAULT_SERVER_CONFIG: Readonly<ServerConfig> = merge(FALLBACK, fileConfig as Partial<ServerConfig>);

/** Applies overrides on top of the file config. Wrong types and negative numbers are ignored. */
export function resolveServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return merge(DEFAULT_SERVER_CONFIG, overrides);
}

function merge(base: Readonly<ServerConfig>, overrides: Partial<ServerConfig>): ServerConfig {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const current = result[key];
    if (current === undefined) continue; // unknown key (typo) is ignored
    if (typeof current === 'number') {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) result[key] = value;
    } else if (typeof value === typeof current) {
      result[key] = value;
    }
  }
  return result as unknown as ServerConfig;
}
