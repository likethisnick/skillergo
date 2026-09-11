import type {
  EnemyKind,
  EntityId,
  GameEvent,
  Loadout,
  PlayerInput,
  PowerUpKind,
  RunEndReason,
  RunSummary,
  UpgradeStat,
  WorldView,
} from '@skillergo/shared';

/**
 * Abstraction over "where the simulation runs".
 * - LocalSession: the World runs right in the browser (single player, training room).
 * - NetworkSession (future): sends inputs over WebSocket and builds a WorldView
 *   from server snapshots. Renderer, input and HUD code stay the same.
 */
export interface GameSession {
  readonly localPlayerId: EntityId;
  readonly view: WorldView;
  /** Present only in the training room. */
  readonly training?: TrainingControls;
  sendInput(input: PlayerInput): void;
  /** Advances the session by real frame time; returns events that happened meanwhile. */
  update(frameDt: number): GameEvent[];
  /**
   * History entry for the local player's run. A network session returns null:
   * there the server writes the history itself.
   */
  summarize(reason: RunEndReason): RunSummary | null;
  dispose(): void;
}

/** Sandbox commands available in the training room. */
export interface TrainingControls {
  setLoadout(loadout: Loadout): void;
  setRank(stat: UpgradeStat, rank: number): void;
  spawnEnemy(kind: EnemyKind, elite?: boolean): void;
  spawnPowerUp(kind: PowerUpKind): void;
  clearEnemies(): void;
  setEnemyAI(enabled: boolean): void;
}
