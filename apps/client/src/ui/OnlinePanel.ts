import type { AuthProvider, Loadout, ServerMessage } from '@skillergo/shared';
import type { Connection } from '../net/Connection';
import { loginUrl } from '../net/serverUrl';
import { requireElement } from './StartScreen';

const PROVIDER_NAMES: Record<AuthProvider, string> = { github: 'GitHub', google: 'Google' };
const GUEST_NAME_KEY = 'skillergo.guestName';

const LOGIN_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  state: 'Sign-in expired. Please try again.',
  provider: 'Sign-in failed on the provider side. Please try again.',
};

/**
 * "Online 1v1" card on the start screen: server status, sign-in, rating,
 * the Find match button and the search timer. Rebuilt whenever the connection changes.
 */
export class OnlinePanel {
  private readonly root: HTMLElement;
  private searching = false;
  private searchStarted = 0;
  private timerLabel: HTMLElement | null = null;
  private footer: HTMLElement | null = null;
  private loginError: string | null;
  /** What the card currently shows; ping and player count alone only update the footer. */
  private shown = '';

  constructor(private readonly conn: Connection, private readonly getLoadout: () => Loadout, loginError: string | null) {
    this.root = requireElement<HTMLElement>('online');
    this.loginError = loginError ? LOGIN_ERRORS[loginError] ?? 'Sign-in failed.' : null;
    conn.onChange(() => this.refresh());
    conn.onMessage((m) => this.onMessage(m));
    window.setInterval(() => this.tickTimer(), 250);
    this.render();
  }

  /** Leaves the queue (a local game was started instead). */
  cancelSearch(): void {
    if (this.searching) this.cancel();
  }

  /** A match started or the menu is left: the search is over. */
  stopSearching(): void {
    this.searching = false;
    this.render();
  }

  private onMessage(m: ServerMessage): void {
    if (m.t === 'queued' && !this.searching) {
      this.searching = true;
      this.searchStarted = performance.now();
      this.render();
    } else if (m.t === 'idle' || m.t === 'matchStart' || m.t === 'error') {
      this.searching = false;
      this.render();
    }
  }

  private findMatch(): void {
    this.loginError = null;
    this.conn.error = null;
    if (this.conn.send({ t: 'queue', loadout: this.getLoadout() })) {
      this.searching = true;
      this.searchStarted = performance.now();
      this.render();
    }
  }

  private cancel(): void {
    this.conn.send({ t: 'cancel' });
    this.searching = false;
    this.render();
  }

  private tickTimer(): void {
    if (!this.searching || !this.timerLabel) return;
    const s = Math.floor((performance.now() - this.searchStarted) / 1000);
    this.timerLabel.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  // ------------------------------------------------------------------ render

  private stateKey(): string {
    const c = this.conn;
    const u = c.user;
    return [c.status, u?.id, u?.name, u?.rating, u?.wins, u?.losses, c.providers.join(), c.guestAllowed,
      this.searching, c.error, this.loginError].join('|');
  }

  private refresh(): void {
    if (this.stateKey() !== this.shown) this.render();
    else this.updateFooter();
  }

  private updateFooter(): void {
    if (!this.footer) return;
    const c = this.conn;
    const ping = c.ping === null ? '' : ` · ping ${Math.round(c.ping)} ms`;
    this.footer.textContent = `${c.online} online${ping}`;
  }

  private render(): void {
    const c = this.conn;
    if (!c.isOnline || !c.user) this.searching = false;
    this.shown = this.stateKey();
    const root = this.root;
    root.replaceChildren();
    this.timerLabel = null;
    this.footer = null;

    root.append(el('h2', 'online-title', 'Online 1v1'));

    switch (c.status) {
      case 'connecting':
        root.append(el('p', 'online-note', 'Connecting to the server…'));
        return;
      case 'offline':
        root.append(el('p', 'online-note', 'Server is offline or waking up. Retrying…'));
        return;
      case 'mismatch': {
        root.append(el('p', 'online-note online-warn', 'The server runs a different version of the game.'));
        root.append(button('secondary-button', 'Reload page', () => location.reload()));
        return;
      }
      case 'replaced':
        root.append(el('p', 'online-note', 'The game is open in another tab.'));
        root.append(button('secondary-button', 'Play here', () => c.reconnect()));
        return;
      case 'online':
        break;
    }

    const error = c.error ?? this.loginError;
    if (!c.user) {
      this.renderSignIn(error);
    } else {
      const user = c.user;
      const profile = el('div', 'online-profile');
      profile.append(
        el('span', 'online-name', user.name),
        el('span', 'online-rating', `${user.rating}`),
      );
      root.append(profile);
      const stats = el('p', 'online-note', `${user.wins} W · ${user.losses} L · `);
      const signOut = el('a', 'online-link', 'Sign out');
      signOut.setAttribute('href', '#');
      signOut.addEventListener('click', (e) => {
        e.preventDefault();
        this.cancel();
        c.signOut();
      });
      stats.append(signOut);
      root.append(stats);

      if (this.searching) {
        const row = el('div', 'online-search');
        const label = el('span', 'online-note', 'Searching for an opponent ');
        this.timerLabel = el('span', 'online-timer', '0:00');
        label.append(this.timerLabel);
        row.append(label, button('secondary-button', 'Cancel', () => this.cancel()));
        root.append(row);
        this.tickTimer();
      } else {
        root.append(button('find-button', 'Find match', () => this.findMatch()));
      }
      if (error) root.append(el('p', 'online-note online-warn', error));
    }

    this.footer = el('p', 'online-footer');
    root.append(this.footer);
    this.updateFooter();
  }

  private renderSignIn(error: string | null): void {
    const c = this.conn;
    const root = this.root;
    if (c.providers.length === 0 && !c.guestAllowed) {
      root.append(el('p', 'online-note', 'Sign-in is not configured on the server yet.'));
      return;
    }
    root.append(el('p', 'online-note', 'Sign in to play ranked matches.'));
    for (const provider of c.providers) {
      root.append(button('secondary-button online-provider', `Sign in with ${PROVIDER_NAMES[provider]}`, () => {
        location.href = loginUrl(provider);
      }));
    }
    if (c.guestAllowed) {
      const form = el('form', 'online-guest');
      const input = document.createElement('input');
      input.className = 'online-input';
      input.maxLength = 20;
      input.placeholder = 'Nickname';
      input.value = loadGuestName();
      input.setAttribute('aria-label', 'Nickname');
      form.append(input, button('secondary-button', 'Play as guest', () => undefined, 'submit'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        saveGuestName(input.value.trim());
        c.playAsGuest(input.value.trim());
      });
      root.append(form);
    }
    if (error) root.append(el('p', 'online-note online-warn', error));
  }
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, text: string, onClick: () => void, type: 'button' | 'submit' = 'button'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = type;
  b.className = className;
  b.textContent = text;
  if (type === 'button') b.addEventListener('click', onClick);
  return b;
}

function loadGuestName(): string {
  try {
    return localStorage.getItem(GUEST_NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveGuestName(name: string): void {
  try {
    localStorage.setItem(GUEST_NAME_KEY, name);
  } catch {
    // Ignore: private mode.
  }
}
