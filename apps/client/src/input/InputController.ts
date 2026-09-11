import type { PlayerInput, UpgradeStat } from '@skillergo/shared';

const LEFT_BUTTON = 0;
const RIGHT_BUTTON = 2;

/** Movement keys and their directions. KeyboardEvent.code is layout-independent (works on Cyrillic). */
const DIRECTION_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** Either Shift dashes. */
const DASH_KEYS: ReadonlySet<string> = new Set(['ShiftLeft', 'ShiftRight']);

/** Keys 1 / 2 / 3 (top row or numpad) spend upgrade points. */
const UPGRADE_KEYS: Readonly<Record<string, UpgradeStat>> = {
  Digit1: 'weapon',
  Numpad1: 'weapon',
  Digit2: 'mobility',
  Numpad2: 'mobility',
  Digit3: 'ability',
  Numpad3: 'ability',
};

/**
 * Collects keyboard and mouse state and turns it into PlayerInput.
 * Mouse events (not pointer events) are used on purpose: they fire for every button
 * even while another one is held, so "hold LMB + click RMB" works.
 * Shift requests a dash in the movement direction.
 */
export class InputController {
  private readonly keys = new Set<string>();
  private mouseX = 0;
  private mouseY = 0;
  private fire = false;
  private ability = false;
  private dashSeq = 0;
  private dashX = 0;
  private dashY = 0;
  /** Shift pressed while standing still: the dash goes towards the cursor (resolved in sample()). */
  private dashTowardsAim = false;
  private upgrades = { weapon: 0, mobility: 0, ability: 0 };

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('blur', this.reset);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Builds input for this frame. Aim is measured from the player's position on screen. */
  sample(playerScreenX: number, playerScreenY: number): PlayerInput {
    const move = this.moveVector();
    const aim = Math.atan2(this.mouseY - playerScreenY, this.mouseX - playerScreenX);
    if (this.dashTowardsAim) {
      this.dashTowardsAim = false;
      this.dashX = Math.cos(aim);
      this.dashY = Math.sin(aim);
    }
    return {
      moveX: move.x,
      moveY: move.y,
      aim,
      fire: this.fire,
      ability: this.ability,
      dashSeq: this.dashSeq,
      dashX: this.dashX,
      dashY: this.dashY,
      upgrades: { ...this.upgrades },
    };
  }

  /** Call when a new session starts: request counters are per player. */
  resetCounters(): void {
    this.dashSeq = 0;
    this.dashTowardsAim = false;
    this.upgrades = { weapon: 0, mobility: 0, ability: 0 };
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('blur', this.reset);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
  }

  private moveVector(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    for (const code of this.keys) {
      const dir = DIRECTION_KEYS[code];
      if (!dir) continue;
      x += dir[0];
      y += dir[1];
    }
    return { x: Math.sign(x), y: Math.sign(y) };
  }

  /** Dash goes where the player is moving (W+D dashes diagonally); standing still, towards the cursor. */
  private requestDash(): void {
    const move = this.moveVector();
    if (move.x !== 0 || move.y !== 0) {
      this.dashX = move.x;
      this.dashY = move.y;
    } else {
      this.dashTowardsAim = true;
    }
    this.dashSeq++;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
    if (e.repeat) return;

    const upgrade = UPGRADE_KEYS[e.code];
    if (upgrade) {
      this.upgrades[upgrade]++;
      return;
    }

    if (DASH_KEYS.has(e.code)) this.requestDash();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseX = e.clientX - rect.left;
    this.mouseY = e.clientY - rect.top;
  };

  private readonly onMouseDown = (e: MouseEvent): void => {
    this.onMouseMove(e);
    if (e.button === LEFT_BUTTON) this.fire = true;
    if (e.button === RIGHT_BUTTON) this.ability = true;
  };

  private readonly onMouseUp = (e: MouseEvent): void => {
    if (e.button === LEFT_BUTTON) this.fire = false;
    if (e.button === RIGHT_BUTTON) this.ability = false;
  };

  private readonly onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
  };

  private readonly reset = (): void => {
    this.keys.clear();
    this.fire = false;
    this.ability = false;
  };
}
