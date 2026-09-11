import {
  ABILITY_TYPES,
  CONFIG,
  DEFAULT_LOADOUT,
  DEFAULT_SETTINGS,
  WEAPON_TYPES,
  difficultyLabel,
  getModifiers,
  normalizeSettings,
  targetPopulation,
  type GameMode,
  type GameSettings,
  type Loadout,
} from '@skillergo/shared';
import { drawIcon, type IconName } from '../render/icons';
import { ABILITY_INFO, WEAPON_INFO, type OptionInfo } from './loadoutInfo';

const LOADOUT_KEY = 'skillergo.loadout';
const SETTINGS_KEY = 'skillergo.settings';

export interface GameOverInfo {
  level: number;
  kills: number;
  /** Replaces the default "Game over" title (e.g. "Victory!"). */
  title?: string;
  /** Shown in green instead of red. */
  won?: boolean;
}

/** DOM overlay: loadout picker, round Play button and run settings. */
export class StartScreen {
  private readonly root: HTMLElement;
  private readonly gameOver: HTMLElement;
  private loadout: Loadout = loadLoadout();
  private settings: GameSettings = loadSettings();

  constructor(onPlay: (loadout: Loadout, settings: GameSettings, mode: GameMode) => void) {
    this.root = requireElement<HTMLElement>('start-screen');
    this.gameOver = requireElement<HTMLElement>('game-over');

    requireElement<HTMLElement>('loadout').append(
      this.buildOptionGroup('LMB', 'Weapon', null, WEAPON_TYPES, WEAPON_INFO, () => this.loadout.weapon, (weapon) => {
        this.loadout = { ...this.loadout, weapon };
      }),
      this.buildOptionGroup('RMB', 'Ability', `unlocks at level ${CONFIG.abilities.unlockLevel}`, ABILITY_TYPES, ABILITY_INFO,
        () => this.loadout.ability, (ability) => {
          this.loadout = { ...this.loadout, ability };
        }),
    );
    requireElement<HTMLElement>('settings').append(this.buildDifficulty(), this.buildSpeed());

    const start = (mode: GameMode): void => {
      save(LOADOUT_KEY, this.loadout);
      save(SETTINGS_KEY, this.settings);
      this.hide();
      onPlay({ ...this.loadout }, { ...this.settings }, mode);
    };
    requireElement<HTMLButtonElement>('play-button').addEventListener('click', () => start('normal'));
    requireElement<HTMLButtonElement>('training-button').addEventListener('click', () => start('training'));
    requireElement<HTMLButtonElement>('versus-button').addEventListener('click', () => start('versus'));
  }

  show(gameOver?: GameOverInfo): void {
    this.gameOver.hidden = !gameOver;
    if (gameOver) {
      this.gameOver.textContent = `${gameOver.title ?? 'Game over'} · level ${gameOver.level} · ${gameOver.kills} kills`;
      this.gameOver.classList.toggle('won', gameOver.won === true);
    }
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  // --------------------------------------------------------------- settings

  private buildDifficulty(): HTMLElement {
    const D = CONFIG.difficulty;
    const hint = document.createElement('p');
    hint.className = 'setting-hint';

    return this.buildSlider({
      title: 'Difficulty',
      min: D.min,
      max: D.max,
      step: 1,
      value: this.settings.difficulty,
      scale: ['1', '30'],
      hint,
      format: (v) => `${v} · ${difficultyLabel(v)}`,
      onChange: (v) => {
        this.settings = { ...this.settings, difficulty: v };
        const start = getModifiers(this.settings, 0);
        const peak = getModifiers(this.settings, 1);
        hint.textContent =
          `Every run starts the same (≈${targetPopulation(start)} enemies) and ramps up to level ` +
          `${CONFIG.difficulty.peakLevel}. Peak: ≈${targetPopulation(peak)} enemies, ` +
          `HP x${peak.enemyHp.toFixed(2)}, damage x${peak.enemyDamage.toFixed(2)}, ` +
          `accuracy ${Math.round(peak.accuracy * 100)}%, boss every ${peak.bossEveryKills} kills.`;
      },
    });
  }

  private buildSpeed(): HTMLElement {
    const SP = CONFIG.speedSetting;
    const hint = document.createElement('p');
    hint.className = 'setting-hint';
    hint.textContent = 'Enemy movement and enemy bullets. Your own speed stays the same.';

    return this.buildSlider({
      title: 'Enemy speed',
      min: SP.min,
      max: SP.max,
      step: SP.step,
      value: this.settings.speed,
      scale: [`${SP.min}x`, `${SP.max}x`],
      hint,
      format: (v) => `x${v.toFixed(1)}`,
      onChange: (v) => {
        this.settings = { ...this.settings, speed: Math.round(v * 10) / 10 };
      },
    });
  }

  private buildSlider(options: {
    title: string;
    min: number;
    max: number;
    step: number;
    value: number;
    scale: [string, string];
    hint: HTMLElement;
    format: (value: number) => string;
    onChange: (value: number) => void;
  }): HTMLElement {
    const group = document.createElement('section');
    group.className = 'loadout-group';

    const heading = document.createElement('h2');
    heading.className = 'loadout-title';
    const valueLabel = document.createElement('span');
    valueLabel.className = 'setting-value';
    heading.append(options.title, valueLabel);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'setting-slider';
    slider.min = String(options.min);
    slider.max = String(options.max);
    slider.step = String(options.step);
    slider.value = String(options.value);
    slider.setAttribute('aria-label', options.title);

    const scale = document.createElement('div');
    scale.className = 'setting-scale';
    scale.innerHTML = '<span></span><span></span>';
    scale.children[0].textContent = options.scale[0];
    scale.children[1].textContent = options.scale[1];

    const update = (): void => {
      const value = Number(slider.value);
      valueLabel.textContent = options.format(value);
      options.onChange(value);
    };
    slider.addEventListener('input', update);
    update();

    group.append(heading, slider, scale, options.hint);
    return group;
  }

  // ---------------------------------------------------------------- loadout

  private buildOptionGroup<T extends IconName>(
    key: string,
    title: string,
    note: string | null,
    values: readonly T[],
    info: Readonly<Record<T, OptionInfo>>,
    get: () => T,
    set: (value: T) => void,
  ): HTMLElement {
    const group = document.createElement('section');
    group.className = 'loadout-group';

    const heading = document.createElement('h2');
    heading.className = 'loadout-title';
    heading.innerHTML = `<span class="key">${key}</span>${title}`;
    if (note) {
      const small = document.createElement('span');
      small.className = 'loadout-note';
      small.textContent = note;
      heading.append(small);
    }

    const options = document.createElement('div');
    options.className = 'loadout-options';
    options.setAttribute('role', 'radiogroup');
    options.setAttribute('aria-label', title);

    const buttons = values.map((value) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'option';
      button.setAttribute('role', 'radio');
      button.dataset.value = value;

      const text = document.createElement('span');
      text.className = 'option-text';
      const name = document.createElement('span');
      name.className = 'option-name';
      name.textContent = info[value].name;
      const desc = document.createElement('span');
      desc.className = 'option-desc';
      desc.textContent = info[value].description;
      text.append(name, desc);

      button.append(createIconCanvas(value), text);
      button.addEventListener('click', () => {
        set(value);
        refresh();
      });
      return button;
    });

    const refresh = (): void => {
      for (const button of buttons) {
        button.setAttribute('aria-checked', String(button.dataset.value === get()));
      }
    };
    refresh();

    options.append(...buttons);
    group.append(heading, options);
    return group;
  }
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

function createIconCanvas(icon: IconName): HTMLCanvasElement {
  const size = 36;
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.className = 'option-icon';
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.scale(dpr, dpr);
    drawIcon(ctx, icon, size / 2, size / 2, 30, '#4a4a4a');
  }
  return canvas;
}

// ------------------------------------------------------------ persistence
// Remembered per browser; storage may be unavailable (private mode), so every access is guarded.

function loadLoadout(): Loadout {
  const parsed = load<Partial<Loadout>>(LOADOUT_KEY) ?? {};
  return {
    weapon: WEAPON_TYPES.find((w) => w === parsed.weapon) ?? DEFAULT_LOADOUT.weapon,
    ability: ABILITY_TYPES.find((a) => a === parsed.ability) ?? DEFAULT_LOADOUT.ability,
  };
}

function loadSettings(): GameSettings {
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...load<Partial<GameSettings>>(SETTINGS_KEY) });
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore: private mode or storage disabled.
  }
}
