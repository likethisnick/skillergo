import type { GameMode, GameSettings, Loadout, RunEndReason } from '@skillergo/shared';
import { HistoryReporter } from './history/HistoryReporter';
import { InputController } from './input/InputController';
import { Effects } from './render/Effects';
import { Renderer } from './render/Renderer';
import type { GameSession } from './session/GameSession';
import { LocalSession } from './session/LocalSession';
import { PauseMenu } from './ui/PauseMenu';
import { StartScreen, requireElement, type GameOverInfo } from './ui/StartScreen';
import { TrainingPanel } from './ui/TrainingPanel';

/** Seconds the death scene stays on screen before the menu returns. */
const GAME_OVER_DELAY = 1.2;
/** Seconds the victory / defeat banner stays before the menu returns. */
const VICTORY_DELAY = 4;
/** Runs shorter than this (e.g. an instant restart) are not written to the history. */
const MIN_LOGGED_RUN_SECONDS = 1;

interface RunConfig {
  loadout: Loadout;
  settings: GameSettings;
  mode: GameMode;
}

const canvas = requireElement<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const input = new InputController(canvas);
const effects = new Effects();
const trainingPanel = new TrainingPanel();
const history = new HistoryReporter();
const startScreen = new StartScreen((loadout, settings, mode) => startGame({ loadout, settings, mode }));
const pauseMenu = new PauseMenu({
  onRestart: () => {
    finishRun('restart');
    if (lastRun) startGame(lastRun);
  },
  onMainMenu: () => leaveToMenu(),
});

let session: GameSession | null = null;
let lastRun: RunConfig | null = null;
let lastTime = 0;
let gameOverTimer: number | null = null;
let lastGameOver: GameOverInfo = { level: 1, kills: 0 };
let frameHandle = 0;
let runReported = false;

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && session && gameOverTimer === null) pauseMenu.toggle();
});
// Closing or reloading the tab mid-run still records it.
window.addEventListener('pagehide', () => finishRun('closed', true));

/** Writes the current run to the history once (training runs are not recorded). */
function finishRun(reason: RunEndReason, unloading = false): void {
  if (!session || runReported || session.training || !session.view.server.historyEnabled) return;
  if (session.view.time < MIN_LOGGED_RUN_SECONDS) return;
  const summary = session.summarize(reason);
  if (!summary) return;
  runReported = true;
  if (unloading) history.reportOnUnload(summary);
  else history.report(summary);
}

function startGame(run: RunConfig): void {
  session?.dispose();
  cancelAnimationFrame(frameHandle);
  lastRun = { ...run };
  // Swap LocalSession for a NetworkSession here once multiplayer exists.
  session = new LocalSession(run.loadout, run.settings, run.mode);
  runReported = false;
  input.resetCounters();
  effects.clear();
  pauseMenu.hide();
  gameOverTimer = null;
  lastTime = performance.now();

  if (session.training) {
    trainingPanel.show(session.training, run.loadout, (loadout) => {
      // Restart in the training room keeps the gear picked on the panel.
      if (lastRun) lastRun.loadout = loadout;
    });
  } else {
    trainingPanel.hide();
  }

  if (import.meta.env.DEV) {
    // Handy for debugging from the browser console: __session.view.players
    (window as unknown as { __session: GameSession }).__session = session;
  }
  frameHandle = requestAnimationFrame(frame);
}

function leaveToMenu(gameOver?: GameOverInfo): void {
  finishRun('menu');
  session?.dispose();
  session = null;
  cancelAnimationFrame(frameHandle);
  pauseMenu.hide();
  trainingPanel.hide();
  startScreen.show(gameOver);
}

function frame(now: number): void {
  if (!session) return;
  // Clamp so a long pause (tab in background) does not fast-forward the game.
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  const me = session.view.players.get(session.localPlayerId);
  if (me?.alive) {
    renderer.camera.follow(me.x, me.y);
    const screen = renderer.camera.worldToScreen(me.x, me.y);
    const sampled = input.sample(screen.x, screen.y);
    // The menu does not pause the game, but the character stands still while it is open.
    // Dash requests made meanwhile are consumed without dashing (zero direction).
    session.sendInput(
      pauseMenu.isOpen
        ? { ...sampled, moveX: 0, moveY: 0, fire: false, ability: false, dashX: 0, dashY: 0 }
        : sampled,
    );
  }
  if (me && session.training) trainingPanel.sync(me);

  const events = session.update(dt);
  const versus = session.view.mode === 'versus';
  for (const ev of events) {
    // In versus a dead player respawns; only the match result ends the game.
    if (ev.type === 'playerDied' && ev.playerId === session.localPlayerId && !versus) {
      gameOverTimer = GAME_OVER_DELAY;
      pauseMenu.hide();
      lastGameOver = { level: ev.level, kills: me?.kills ?? 0 };
      finishRun('death');
    }
    if (ev.type === 'victory' && me) {
      gameOverTimer = VICTORY_DELAY;
      pauseMenu.hide();
      const won = ev.team === me.team;
      lastGameOver = { level: me.level, kills: me.kills, title: won ? 'Victory!' : 'Defeat', won };
      finishRun('finished');
    }
  }

  effects.handle(events, session.localPlayerId, session.view);
  effects.update(dt);
  renderer.render(session.view, session.localPlayerId, effects);

  if (gameOverTimer !== null) {
    gameOverTimer -= dt;
    if (gameOverTimer <= 0) {
      leaveToMenu(lastGameOver);
      return;
    }
  }
  frameHandle = requestAnimationFrame(frame);
}
