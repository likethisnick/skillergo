import {
  CLASS_IDS,
  CONFIG,
  DEFAULT_LOADOUT,
  UPGRADE_STATS,
  classInfo,
  type EnemyKind,
  type Loadout,
  type Player,
  type PowerUpKind,
  type UpgradeStat,
} from '@skillergo/shared';
import type { TrainingControls } from '../session/GameSession';
import { ABILITY_INFO, CLASS_INFO, UPGRADE_INFO, WEAPON_INFO } from './loadoutInfo';
import { requireElement } from './StartScreen';

const SPAWNS: readonly { label: string; kind: EnemyKind; elite?: boolean }[] = [
  { label: 'Dummy', kind: 'dummy' },
  { label: 'Grunt', kind: 'grunt' },
  { label: 'Rusher', kind: 'rusher' },
  { label: 'Sniper', kind: 'sniper' },
  { label: 'Elite', kind: 'grunt', elite: true },
  { label: 'Colossus', kind: 'colossus' },
  { label: 'Duelist', kind: 'duelist' },
  { label: 'Blade', kind: 'blademaster' },
];

const POWER_UPS: readonly { label: string; kind: PowerUpKind }[] = [
  { label: 'Damage', kind: 'damage' },
  { label: 'Speed', kind: 'speed' },
  { label: 'Wipe', kind: 'wipe' },
];

/** Side panel of the training room: switch gear, set upgrade ranks, spawn things. */
export class TrainingPanel {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private controls: TrainingControls | null = null;
  private loadout: Loadout = { ...DEFAULT_LOADOUT };
  private onLoadoutChange: (loadout: Loadout) => void = () => {};
  private readonly rankLabels = new Map<UpgradeStat, HTMLElement>();
  private readonly classButtons: HTMLButtonElement[] = [];
  private aiToggle!: HTMLInputElement;
  private kitLabel!: HTMLElement;

  constructor() {
    this.root = requireElement<HTMLElement>('training-panel');
    this.root.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'tp-header';
    const title = document.createElement('strong');
    title.textContent = 'Training room';
    const collapse = this.button('Hide', () => {
      this.body.hidden = !this.body.hidden;
      collapse.textContent = this.body.hidden ? 'Show' : 'Hide';
    }, 'tp-collapse');
    header.append(title, collapse);

    this.body = document.createElement('div');
    this.body.className = 'tp-body';
    this.body.append(
      this.section('Class', this.segmented(CLASS_IDS, (id) => CLASS_INFO[id].name, this.classButtons, (classId) => {
        this.applyLoadout({ classId });
      })),
      this.section('Kit', this.kitLine()),
      this.section('Upgrades · keys 1 / 2 / 3', this.upgradeRows()),
      this.section('Spawn', this.grid(SPAWNS.map((s) => this.button(s.label, () => this.controls?.spawnEnemy(s.kind, s.elite))))),
      this.section('Power-ups', this.grid(POWER_UPS.map((p) => this.button(p.label, () => this.controls?.spawnPowerUp(p.kind))))),
      this.section('Enemies', this.enemyControls()),
    );

    this.root.append(header, this.body);
    // Clicks on the panel must never reach the game as attacks or open a context menu.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  show(controls: TrainingControls, loadout: Loadout, onLoadoutChange: (loadout: Loadout) => void): void {
    this.controls = controls;
    this.loadout = { ...loadout };
    this.onLoadoutChange = onLoadoutChange;
    this.aiToggle.checked = false;
    controls.setEnemyAI(false);
    this.refreshLoadout();
    this.root.hidden = false;
  }

  hide(): void {
    this.controls = null;
    this.root.hidden = true;
  }

  /** Keeps rank numbers in sync (keys 1/2/3 also change them). */
  sync(player: Readonly<Player>): void {
    for (const stat of UPGRADE_STATS) {
      const label = this.rankLabels.get(stat);
      const text = String(player.ranks[stat]);
      if (label && label.textContent !== text) label.textContent = text;
    }
  }

  private currentRank(stat: UpgradeStat): number {
    return Number(this.rankLabels.get(stat)?.textContent ?? 0);
  }

  /** Shows which weapon and ability the picked class gives. */
  private kitLine(): HTMLElement {
    this.kitLabel = document.createElement('div');
    this.kitLabel.className = 'tp-kit';
    return this.kitLabel;
  }

  private applyLoadout(loadout: Loadout): void {
    this.loadout = loadout;
    this.controls?.setLoadout(loadout);
    this.onLoadoutChange(loadout);
    this.refreshLoadout();
  }

  private refreshLoadout(): void {
    for (const b of this.classButtons) b.setAttribute('aria-pressed', String(b.dataset.value === this.loadout.classId));
    const info = classInfo(this.loadout.classId);
    this.kitLabel.textContent = `LMB ${WEAPON_INFO[info.weapon].name} · RMB ${ABILITY_INFO[info.ability].name}`;
  }

  private upgradeRows(): HTMLElement {
    const rows = document.createElement('div');
    rows.className = 'tp-rows';
    UPGRADE_STATS.forEach((stat, i) => {
      const row = document.createElement('div');
      row.className = 'tp-row';
      const name = document.createElement('span');
      name.className = 'tp-row-name';
      name.textContent = `${i + 1} · ${UPGRADE_INFO[stat].name}`;
      const value = document.createElement('span');
      value.className = 'tp-rank';
      value.textContent = '0';
      this.rankLabels.set(stat, value);
      const change = (delta: number): void => {
        const rank = Math.max(0, Math.min(CONFIG.upgrades.maxRank, this.currentRank(stat) + delta));
        this.controls?.setRank(stat, rank);
        value.textContent = String(rank);
      };
      row.append(name, this.button('−', () => change(-1), 'tp-step'), value, this.button('+', () => change(1), 'tp-step'));
      rows.append(row);
    });
    return rows;
  }

  private enemyControls(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'tp-rows';
    const label = document.createElement('label');
    label.className = 'tp-toggle';
    this.aiToggle = document.createElement('input');
    this.aiToggle.type = 'checkbox';
    this.aiToggle.addEventListener('change', () => this.controls?.setEnemyAI(this.aiToggle.checked));
    label.append(this.aiToggle, 'Enemies move and attack');
    wrap.append(label, this.button('Clear all enemies', () => this.controls?.clearEnemies(), 'tp-wide'));
    return wrap;
  }

  private segmented<T extends string>(
    values: readonly T[],
    label: (value: T) => string,
    store: HTMLButtonElement[],
    onPick: (value: T) => void,
  ): HTMLElement {
    const buttons = values.map((value) => {
      const b = this.button(label(value), () => onPick(value));
      b.dataset.value = value;
      store.push(b);
      return b;
    });
    return this.grid(buttons);
  }

  private section(title: string, content: HTMLElement): HTMLElement {
    const section = document.createElement('section');
    section.className = 'tp-section';
    const h = document.createElement('h3');
    h.textContent = title;
    section.append(h, content);
    return section;
  }

  private grid(children: HTMLElement[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'tp-grid';
    grid.append(...children);
    return grid;
  }

  private button(text: string, onClick: () => void, className = 'tp-button'): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className === 'tp-button' ? 'tp-button' : `tp-button ${className}`;
    b.textContent = text;
    b.addEventListener('click', () => {
      onClick();
      // Drop focus so Space/Enter never re-trigger panel buttons during play.
      b.blur();
    });
    return b;
  }
}
