import {
  ABILITY_TYPES,
  CONFIG,
  WEAPON_TYPES,
  World,
  buildRunSummary,
  type EnemyKind,
  type EntityId,
  type GameEvent,
  type GameMode,
  type GameSettings,
  type Loadout,
  type PlayerInput,
  type PowerUpKind,
  type RunEndReason,
  type RunSummary,
  type UpgradeStat,
  type WorldView,
} from '@skillergo/shared';
import type { GameSession, TrainingControls } from './GameSession';

const STEP = 1 / CONFIG.tickRate;
/** Caps catch-up work after a long frame (e.g. tab was in background). */
const MAX_STEPS_PER_FRAME = 5;

/** Local session: owns the World and steps it with a fixed timestep. */
export class LocalSession implements GameSession {
  readonly localPlayerId: EntityId;
  readonly training?: TrainingControls;
  private readonly world: World;
  private readonly startedAt = new Date();
  private accumulator = 0;

  constructor(loadout: Loadout, settings: GameSettings, mode: GameMode = 'normal') {
    this.world = new World({ settings, mode });
    this.localPlayerId = this.world.addPlayer(loadout, { team: 'blue' }).id;
    if (mode === 'training') this.training = this.createTrainingControls();
    if (mode === 'versus') {
      // The AI opponent gets random gear. Later a network player takes this slot.
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
      this.world.addPlayer({ weapon: pick(WEAPON_TYPES), ability: pick(ABILITY_TYPES) }, { team: 'red', bot: true });
    }
  }

  get view(): WorldView {
    return this.world;
  }

  sendInput(input: PlayerInput): void {
    this.world.setInput(this.localPlayerId, input);
  }

  update(frameDt: number): GameEvent[] {
    this.accumulator += frameDt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS_PER_FRAME) {
      this.world.step(STEP);
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.accumulator = 0;
    return this.world.drainEvents();
  }

  summarize(reason: RunEndReason): RunSummary | null {
    return buildRunSummary(this.world, this.localPlayerId, { startedAt: this.startedAt, endReason: reason });
  }

  dispose(): void {
    // Nothing to release for a local session; a network session would close its socket here.
  }

  private createTrainingControls(): TrainingControls {
    const world = this.world;
    const id = this.localPlayerId;
    return {
      setLoadout: (loadout: Loadout) => world.setLoadout(id, loadout),
      setRank: (stat: UpgradeStat, rank: number) => world.setRank(id, stat, rank),
      spawnEnemy: (kind: EnemyKind, elite = false) => void world.spawnNear(id, kind, elite),
      spawnPowerUp: (kind: PowerUpKind) => world.spawnPowerUpNear(id, kind),
      clearEnemies: () => world.clearEnemies(),
      setEnemyAI: (enabled: boolean) => {
        world.enemyAI = enabled;
      },
    };
  }
}
