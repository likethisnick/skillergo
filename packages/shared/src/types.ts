import type { ArenaLayout, LaneId } from './arena';
import type { GameMap } from './map';
import type { ServerConfig } from './server.config';

export type EntityId = number;

export type WeaponType = 'gun' | 'sword' | 'beam';
export type AbilityType = 'hook' | 'shield' | 'shotgun';
export type RegularEnemyKind = 'grunt' | 'rusher' | 'sniper';
export type BossKind = 'colossus' | 'duelist' | 'blademaster';
/** Training-room only target. */
export type TrainingEnemyKind = 'dummy';
/** Versus-only: harmless, slow, lots of XP, lives next to its nexus. */
export type VersusEnemyKind = 'farmer';
export type EnemyKind = RegularEnemyKind | BossKind | TrainingEnemyKind | VersusEnemyKind;

export type GameMode = 'normal' | 'training' | 'versus';

/** Two sides. In survival the player is blue and every enemy is red. */
export type TeamId = 'blue' | 'red';
export const TEAMS: readonly TeamId[] = ['blue', 'red'];
export function otherTeam(team: TeamId): TeamId {
  return team === 'blue' ? 'red' : 'blue';
}

/**
 * What an enemy unit is doing in the world:
 * survival - classic arena enemy; wave - marches a lane; defender - hunts an intruder;
 * farmer - wanders near its nexus; guardian - boss protecting its nexus.
 */
export type EnemyRole = 'survival' | 'wave' | 'defender' | 'farmer' | 'guardian';

/** Anything with a position and a body that AI can chase, aim at or lead. */
export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export type TargetKind = 'player' | 'enemy' | 'nexus' | 'tower';

/** Buildings: they never move and cannot be pulled, only damaged. */
export type BuildingKind = 'nexus' | 'tower';

/** Upgrade tracks bound to keys 1 / 2 / 3. */
export type UpgradeStat = 'weapon' | 'mobility' | 'ability';
export const UPGRADE_STATS: readonly UpgradeStat[] = ['weapon', 'mobility', 'ability'];
export type UpgradeRanks = Record<UpgradeStat, number>;

export type PowerUpKind = 'damage' | 'speed' | 'wipe';
export const POWER_UP_KINDS: readonly PowerUpKind[] = ['damage', 'speed', 'wipe'];

export interface UpgradeLogEntry {
  stat: UpgradeStat;
  /** Rank after the upgrade. */
  rank: number;
  /** Player level at the moment of the upgrade. */
  level: number;
  /** Seconds since the run started. */
  time: number;
}

export interface KillStats {
  regular: number;
  elite: number;
  boss: number;
  /** Versus: enemy players killed. */
  players: number;
  /** Versus: enemy towers finished off. */
  towers: number;
  byKind: Partial<Record<EnemyKind, number>>;
}

export interface Buffs {
  /** Seconds left for each active buff (0 = inactive). */
  damage: number;
  attackSpeed: number;
  speed: number;
}

/** Who fired a projectile; lets clients pick visuals without extra lookups. */
export type ProjectileSource = 'player' | EnemyKind;

export const WEAPON_TYPES: readonly WeaponType[] = ['gun', 'sword', 'beam'];
export const ABILITY_TYPES: readonly AbilityType[] = ['hook', 'shield', 'shotgun'];
export const REGULAR_ENEMY_KINDS: readonly RegularEnemyKind[] = ['grunt', 'rusher', 'sniper'];
export const BOSS_KINDS: readonly BossKind[] = ['colossus', 'duelist', 'blademaster'];

export function isBossKind(kind: EnemyKind): kind is BossKind {
  return (BOSS_KINDS as readonly EnemyKind[]).includes(kind);
}

/** Run settings chosen on the start screen (for multiplayer: room settings). */
export interface GameSettings {
  /** 1..30, see CONFIG.difficulty. */
  difficulty: number;
  /** Enemy movement and enemy bullet speed multiplier, see CONFIG.speedSetting. */
  speed: number;
}

/** Character customization chosen before a run (sent in a "join" message in multiplayer). */
export interface Loadout {
  weapon: WeaponType;
  ability: AbilityType;
}

export const DEFAULT_LOADOUT: Readonly<Loadout> = { weapon: 'gun', ability: 'hook' };

/**
 * Everything a client sends to the simulation for one player.
 * Held-button state (not "clicked" events) is sent on purpose:
 * it survives packet loss and the simulation detects edges itself.
 */
export interface PlayerInput {
  /** Movement direction, each axis in [-1, 1]. Clamped to unit length by the simulation. */
  moveX: number;
  moveY: number;
  /** Aim angle in radians (world space). */
  aim: number;
  /** LMB held: use weapon. */
  fire: boolean;
  /** RMB held: use ability (triggers on press). */
  ability: boolean;
  /**
   * Dash requests are counted instead of flagged, so a request is never lost
   * between simulation ticks or network packets. A new value = a new dash request.
   */
  dashSeq: number;
  dashX: number;
  dashY: number;
  /**
   * Cumulative count of upgrade key presses per track. Like `dashSeq`, counters
   * never lose a press between ticks or packets; the simulation applies the difference.
   */
  upgrades: Readonly<UpgradeRanks>;
}

export const EMPTY_INPUT: Readonly<PlayerInput> = {
  moveX: 0,
  moveY: 0,
  aim: 0,
  fire: false,
  ability: false,
  dashSeq: 0,
  dashX: 0,
  dashY: 0,
  upgrades: { weapon: 0, mobility: 0, ability: 0 },
};

export type HookState = 'idle' | 'flying' | 'pulling' | 'retracting';

export interface Hook {
  state: HookState;
  x: number;
  y: number;
  dirX: number;
  dirY: number;
  traveled: number;
  targetId: EntityId | null;
  /** Stats captured at throw time (they depend on the ability upgrade rank). */
  range: number;
  speed: number;
  pullSpeed: number;
  damage: number;
  /** Seconds spent pulling the current target. */
  pullTime: number;
}

export interface Beam {
  active: boolean;
  endX: number;
  endY: number;
  targetId: EntityId | null;
  /** Damage dealt since the last floating-number report. */
  pendingDamage: number;
  reportTimer: number;
}

export interface Player {
  id: EntityId;
  team: TeamId;
  /** Controlled by the built-in AI instead of a human / network client. */
  isBot: boolean;
  x: number;
  y: number;
  /** Actual velocity during the last tick (used by enemies that lead their shots). */
  vx: number;
  vy: number;
  radius: number;
  aim: number;
  kills: number;
  /** Versus: times this player died (and respawned). */
  deaths: number;

  hp: number;
  maxHp: number;
  alive: boolean;
  lastDamageTime: number;
  /** Who hit this player last (kill credit). */
  lastHitBy: EntityId | null;
  /** Versus: seconds until respawn while dead. */
  respawnTimer: number;
  /** Versus: seconds spent on enemy ground in a row (decays when back home). */
  intrusionTime: number;
  /** Versus: time until the next defender squad comes for this intruder. */
  reinforcementTimer: number;

  level: number;
  /** XP collected towards the next level. */
  xp: number;
  upgradePoints: number;
  ranks: UpgradeRanks;
  /** Every upgrade taken this run, in order (for the run history). */
  upgradeLog: UpgradeLogEntry[];
  /** Kills split by category (for the run history); `kills` is the total. */
  killStats: KillStats;
  /** How many upgrade key presses per track have been processed (see PlayerInput.upgrades). */
  upgradeRequests: UpgradeRanks;
  buffs: Buffs;

  weapon: WeaponType;
  ability: AbilityType;

  attackCooldown: number;
  /** Time and direction of the last weapon attack (used to draw sword swings). */
  lastAttackTime: number;
  lastAttackAngle: number;
  beam: Beam;

  abilityUnlocked: boolean;
  abilityCooldown: number;
  /** Full length of the current cooldown, for HUD progress. */
  abilityCooldownTotal: number;
  shieldTimer: number;
  /** Shield width captured at activation (depends on the ability rank). */
  shieldArc: number;
  hook: Hook;

  dashTimer: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
  lastDashSeq: number;
  invulnerableTimer: number;

  input: PlayerInput;
  prevAbilityHeld: boolean;
}

export interface Enemy {
  id: EntityId;
  kind: EnemyKind;
  team: TeamId;
  role: EnemyRole;
  boss: boolean;
  elite: boolean;
  /** Wave mobs: lane and index of the next waypoint. */
  lane: LaneId | null;
  waypoint: number;
  /** Farmers and guardians stay around this point. */
  homeX: number;
  homeY: number;
  /** Current target (re-picked a few times per second). */
  targetKind: TargetKind | null;
  targetId: EntityId | null;
  retargetTimer: number;
  /** Wave mob escorting its own intruding player, or defender hunting an intruder. */
  escortId: EntityId | null;
  x: number;
  y: number;
  radius: number;
  hp: number;
  maxHp: number;
  xp: number;
  vx: number;
  vy: number;
  wanderTimer: number;
  /** +1 / -1: which way a shooter circles around its target. */
  strafeDir: number;
  /** World angle of this enemy's own spot around the player (spreads crowds out). */
  slotAngle: number;
  /** Personal multiplier for the preferred distance. */
  distanceScale: number;
  /** Seconds since spawn (used for fade-in). */
  age: number;
  /** Seconds left of the "just got hit" flash. */
  hitFlash: number;
  pulledBy: EntityId | null;

  /** Shooters: current aim angle, time to next attack, remaining windup (0 = not aiming). */
  aim: number;
  attackCooldown: number;
  windup: number;
  /** Contact attackers: time until contact damage is possible again, bounce-back / leap timer. */
  contactCooldown: number;
  retreatTimer: number;
  /** Duelist: remaining time of the current side dash. */
  burstTimer: number;
  /** Blademaster: when the last swing happened (for visuals). */
  lastAttackTime: number;
  /** Dummies heal back after a break in damage. */
  lastHitTime: number;
}

export interface Projectile {
  id: EntityId;
  ownerId: EntityId;
  team: TeamId;
  source: ProjectileSource;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  damage: number;
  /** Boss attacks and sniper shots fly through walls. */
  ignoresWalls: boolean;
  /** Sniper shots fly through buildings too, except the one they were aimed at. */
  piercesBuildings: boolean;
  aimedAt: EntityId | null;
}

export type OrbKind = 'xp' | 'heal' | 'power';

export interface Orb {
  id: EntityId;
  kind: OrbKind;
  x: number;
  y: number;
  radius: number;
  /** XP amount for XP orbs; unused for heal orbs (they heal a fraction of max HP). */
  xp: number;
  /** Power-up orbs only. */
  power: PowerUpKind | null;
  /** Players of this team cannot pick the orb up (drops of their own units). */
  denyTeam: TeamId | null;
  /** XP cut down because no player finished the unit off (drawn yellow). */
  reduced: boolean;
  attractedTo: EntityId | null;
  speed: number;
  /** Seconds until the orb disappears. */
  life: number;
}

/** One-off things that happened during a tick. Clients use them for effects and sounds. */
export type GameEvent =
  | { type: 'hit'; targetId: EntityId; sourceId: EntityId; x: number; y: number; damage: number }
  | { type: 'kill'; targetId: EntityId; killerId: EntityId; x: number; y: number; kind: EnemyKind }
  | { type: 'pickup'; playerId: EntityId; xp: number }
  | { type: 'heal'; playerId: EntityId; amount: number }
  | { type: 'bossSpawned'; enemyId: EntityId; kind: BossKind }
  | { type: 'levelUp'; playerId: EntityId; level: number }
  | { type: 'hookHit'; playerId: EntityId; targetId: EntityId }
  | { type: 'playerHit'; playerId: EntityId; x: number; y: number; damage: number }
  | { type: 'playerDied'; playerId: EntityId; level: number }
  | { type: 'blocked'; playerId: EntityId; x: number; y: number }
  | { type: 'shotgun'; playerId: EntityId; x: number; y: number; angle: number; range: number; arc: number }
  | { type: 'upgrade'; playerId: EntityId; stat: UpgradeStat; rank: number }
  | { type: 'powerUp'; playerId: EntityId; buff: 'damage' | 'attackSpeed' | 'speed' | 'wipe' }
  | { type: 'wipe'; playerId: EntityId; x: number; y: number; radius: number; count: number }
  | { type: 'dash'; playerId: EntityId }
  | { type: 'wallHit'; x: number; y: number }
  | { type: 'playerRespawned'; playerId: EntityId }
  | { type: 'nexusHit'; nexusId: EntityId; sourceId: EntityId; x: number; y: number; damage: number }
  | { type: 'nexusImmune'; nexusId: EntityId; sourceId: EntityId; x: number; y: number }
  | { type: 'towerHit'; towerId: EntityId; sourceId: EntityId; x: number; y: number; damage: number }
  | { type: 'towerShot'; towerId: EntityId; team: TeamId; x: number; y: number; targetX: number; targetY: number }
  | { type: 'towerDestroyed'; towerId: EntityId; team: TeamId; lane: LaneId; x: number; y: number; blastRadius: number; wiped: number }
  | { type: 'nexusStage'; nexusId: EntityId; team: TeamId; stage: number; boss: BossKind }
  /** `reason`: 'forfeit' when the other side left an online match (missing = the nexus fell). */
  | { type: 'victory'; team: TeamId; reason?: 'nexus' | 'forfeit' };

/** Common part of nexuses and towers. */
export interface Building extends Body {
  id: EntityId;
  team: TeamId;
  hp: number;
  maxHp: number;
  lastHitTime: number;
}

/** Versus: the main building. Losing it (and its last guardian) loses the match. */
export interface Nexus extends Building {
  /** Guardian bosses summoned so far (0..3). */
  stage: number;
  /** While its guardian lives the nexus cannot be damaged. */
  guardianId: EntityId | null;
  /** Remaining boss kinds, in the order they will appear (never repeats). */
  bossQueue: BossKind[];
}

/**
 * Versus: lane tower. Lane mobs attack it; it shoots mobs first, players when no mob
 * is around or when a player attacks an allied player in its range.
 */
export interface Tower extends Building {
  lane: LaneId;
  /** 0 = outer (closest to the middle of the map), then inwards. */
  order: number;
  attackCooldown: number;
  targetKind: TargetKind | null;
  targetId: EntityId | null;
}

/**
 * Read-only view of the game state used by renderers.
 * `World` implements it directly; a network client will build the same
 * shape from server snapshots, so rendering code will not change.
 */
export interface WorldView {
  readonly time: number;
  readonly width: number;
  readonly height: number;
  /** Versus layout (lanes, bases); null in survival and training. */
  readonly arena: Readonly<ArenaLayout> | null;
  readonly nexuses: ReadonlyMap<EntityId, Readonly<Nexus>>;
  readonly towers: ReadonlyMap<EntityId, Readonly<Tower>>;
  readonly winner: TeamId | null;
  /** XP needed to go from `level` to the next one in this mode. */
  xpToNext(level: number): number;
  readonly settings: Readonly<GameSettings>;
  /** Base balance values of this world (a network client receives them from the server). */
  readonly server: Readonly<ServerConfig>;
  readonly mode: GameMode;
  /** Walls. Static for the whole run. */
  readonly map: GameMap;
  /** 0..1: how far the difficulty ramp has progressed (1 at the peak level). */
  readonly intensity: number;
  readonly players: ReadonlyMap<EntityId, Readonly<Player>>;
  readonly enemies: ReadonlyMap<EntityId, Readonly<Enemy>>;
  readonly projectiles: ReadonlyMap<EntityId, Readonly<Projectile>>;
  readonly orbs: ReadonlyMap<EntityId, Readonly<Orb>>;
}
