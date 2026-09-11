import type { RunSummary } from '@skillergo/shared';

/** Must match HISTORY_ENDPOINT in dev/historyLog.ts (served by the Vite dev/preview server). */
const ENDPOINT = '/api/history';

/**
 * Sends finished runs to the history log. Fire-and-forget: if the endpoint is missing
 * (e.g. the game is hosted as static files) the game keeps working and warns once.
 */
export class HistoryReporter {
  private warned = false;

  report(summary: RunSummary): void {
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
      // Lets the request finish even if the page is being closed.
      keepalive: true,
    })
      .then((response) => {
        if (!response.ok) this.warn(`HTTP ${response.status}`);
      })
      .catch((error: unknown) => this.warn(error));
  }

  /** For page unload: sendBeacon survives the tab closing more reliably than fetch. */
  reportOnUnload(summary: RunSummary): void {
    const blob = new Blob([JSON.stringify(summary)], { type: 'application/json' });
    if (!navigator.sendBeacon?.(ENDPOINT, blob)) this.report(summary);
  }

  private warn(reason: unknown): void {
    if (this.warned) return;
    this.warned = true;
    console.warn('[history] run summary was not saved:', reason);
  }
}
