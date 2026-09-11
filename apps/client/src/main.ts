import type { GameMode, GameSettings, Loadout, MatchStartInfo, RunEndReason } from '@skillergo/shared';
import { HistoryReporter } from './history/HistoryReporter';
import { InputController } from './input/InputController';
import { takeLoginResult } from './net/authToken';
import { Connection } from './net/Connection';
import { Effects } from './render/Effects';
import { Renderer } from './render/Renderer';
import type { GameSession } from './session/GameSession';
import { LocalSession } from './session/LocalSession';
import { NetworkSession } from './session/NetworkSession';
import { OnlinePanel } from './ui/OnlinePanel';
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

// A "Sign in with ..." redirect brings the login token back in the address bar: keep it
// before the connection says hello with it.
const loginResult = takeLoginResult();

const canvas = requireElement<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas);
const input = new InputController(canvas);
const effects = new Effects();
const trainingPanel = new TrainingPanel();
const history = new HistoryReporter();
const connection = new Connection();
const startScreen = new StartScreen((loadout, settings, mode) => startGame({ loadout, settings, mode }));
const onlinePanel = new OnlinePanel(connection, () => startScreen.selectedLoadout(), loginResult.error);
const pauseMenu = new PauseMenu({
  onRestart: () => {
    finishRun('restart');
    if (lastRun) startGame(lastRun);
  },
  onMainMenu: () => {
    if (session instanceof NetworkSession && !session.over) {
      // Leaving an online match gives the win to the opponent.
      session.surrender();
      const me = session.view.players.get(session.localPlayerId);
      leaveToMenu({ level: me?.level ?? 1, kills: me?.kills ?? 0, title: 'Defeat (left the match)', won: false });
      return;
    }
    leaveToMenu();
  },
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

// Online: the server starts the match (after Find match, or when we reconnect into a running one).
connection.onMessage((m) => {
  if (m.t === 'matchStart') startOnlineMatch(m.match);
});

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
  onlinePanel.cancelSearch();
  lastRun = { ...run };
  beginSession(new LocalSession(run.loadout, run.settings, run.mode));
  if (session?.training) {
    trainingPanel.show(session.training, run.loadout, (loadout) => {
      // Restart in the training room keeps the gear picked on the panel.
      if (lastRun) lastRun.loadout = loadout;
    });
  }
}

function startOnlineMatch(info: MatchStartInfo): void {
  if (session instanceof NetworkSession && session.matchId === info.matchId) {
    // Our connection dropped and came back: same match, same screen.
    session.resume(info);
    return;
  }
  lastRun = null;
  onlinePanel.stopSearching();
  startScreen.hide();
  beginSession(new NetworkSession(connection, info));
}

function beginSession(next: GameSession): void {
  session?.dispose();
  cancelAnimationFrame(frameHandle);
  session = next;
  runReported = false;
  input.resetCounters();
  effects.clear();
  pauseMenu.hide();
  pauseMenu.setOnline(next instanceof NetworkSession);
  trainingPanel.hide();
  gameOverTimer = null;
  lastTime = performance.now();

  if (import.meta.env.DEV) {
    // Handy for debugging from the browser console: __session.view.players
    (window as unknown as { __session: GameSession }).__session = next;
  }
  frameHandle = requestAnimationFrame(frame);
}

function leaveToMenu(gameOver?: GameOverInfo): void {
  finishRun('menu');
  if (gameOver && session instanceof NetworkSession && session.result) {
    const r = session.result;
    gameOver = { ...gameOver, extra: `rating ${r.rating} (${r.delta >= 0 ? '+' : ''}${r.delta})` };
  }
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

  if (session instanceof NetworkSession && session.lost) {
    const lostMe = session.view.players.get(session.localPlayerId);
    leaveToMenu({ level: lostMe?.level ?? 1, kills: lostMe?.kills ?? 0, title: 'Disconnected · match lost', won: false });
    return;
  }

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
    if (ev.type === 'victory' && me && gameOverTimer === null) {
      gameOverTimer = VICTORY_DELAY;
      pauseMenu.hide();
      const won = ev.team === me.team;
      lastGameOver = { level: me.level, kills: me.kills, title: won ? 'Victory!' : 'Defeat', won };
      finishRun('finished');
    }
  }

  effects.handle(events, session.localPlayerId, session.view);
  effects.update(dt);
  renderer.render(session.view, session.localPlayerId, effects, session.net);

  if (gameOverTimer !== null) {
    gameOverTimer -= dt;
    if (gameOverTimer <= 0) {
      leaveToMenu(lastGameOver);
      return;
    }
  }
  frameHandle = requestAnimationFrame(frame);
}
