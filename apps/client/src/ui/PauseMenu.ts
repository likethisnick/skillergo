import { requireElement } from './StartScreen';

export interface PauseMenuActions {
  onRestart: () => void;
  onMainMenu: () => void;
}

/** Esc menu. It does not pause the simulation: the world keeps running underneath. */
export class PauseMenu {
  private readonly root: HTMLElement;

  constructor(actions: PauseMenuActions) {
    this.root = requireElement<HTMLElement>('pause-menu');
    this.root.addEventListener('click', (e) => {
      const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'resume') this.hide();
      if (action === 'restart') actions.onRestart();
      if (action === 'menu') actions.onMainMenu();
    });
    // Right-clicks on the menu must not open the browser context menu mid-fight.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Online: no restart, and leaving the match counts as a loss. */
  setOnline(online: boolean): void {
    const restart = this.root.querySelector<HTMLElement>('[data-action="restart"]');
    const menu = this.root.querySelector<HTMLElement>('[data-action="menu"]');
    if (restart) restart.hidden = online;
    if (menu) menu.textContent = online ? 'Leave match (counts as a loss)' : 'Main menu';
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(): void {
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }
}
