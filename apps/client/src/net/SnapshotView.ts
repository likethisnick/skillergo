import {
  CONFIG,
  GameMap,
  createArenaLayout,
  decodeTiles,
  resolveObstacles,
  versusXpToNext,
  type ArenaLayout,
  type Enemy,
  type EntityId,
  type GameMode,
  type GameSettings,
  type MatchStartInfo,
  type MovementEnv,
  type Nexus,
  type Orb,
  type Player,
  type Projectile,
  type ServerConfig,
  type TeamId,
  type Tower,
  type WorldView,
} from '@skillergo/shared';

/**
 * A WorldView built from server snapshots instead of a local simulation.
 * NetworkSession fills the entity maps every frame; the renderer cannot tell the difference.
 * It is also the MovementEnv for predicting the local player (same walls and buildings).
 */
export class SnapshotView implements WorldView, MovementEnv {
  time = 0;
  winner: TeamId | null = null;
  readonly width: number;
  readonly height: number;
  readonly arena: ArenaLayout;
  readonly map: GameMap;
  readonly settings: GameSettings;
  readonly server: ServerConfig;
  readonly mode: GameMode = 'versus';
  readonly intensity = 0;

  readonly players = new Map<EntityId, Player>();
  readonly enemies = new Map<EntityId, Enemy>();
  readonly projectiles = new Map<EntityId, Projectile>();
  readonly orbs = new Map<EntityId, Orb>();
  readonly nexuses = new Map<EntityId, Nexus>();
  readonly towers = new Map<EntityId, Tower>();

  constructor(info: MatchStartInfo) {
    this.server = info.server;
    this.settings = info.settings;
    this.width = info.map.width;
    this.height = info.map.height;
    this.arena = createArenaLayout(CONFIG.arena);
    this.map = new GameMap(info.map.width, info.map.height, info.map.tileSize);
    decodeTiles(info.map.tiles, this.map.tiles);
  }

  xpToNext(level: number): number {
    return versusXpToNext(this.server, level);
  }

  resolveObstacles(x: number, y: number, radius: number): { x: number; y: number } {
    return resolveObstacles(this.map, [this.nexuses.values(), this.towers.values()], x, y, radius);
  }
}
