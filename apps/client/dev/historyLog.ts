import { appendFile, mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

/** Endpoint the client posts finished runs to. */
export const HISTORY_ENDPOINT = '/api/history';

/** A run summary is small; anything bigger is not ours. */
const MAX_BODY_BYTES = 64 * 1024;

export interface HistoryLogOptions {
  /** Absolute directory for log files (created on first write). */
  dir: string;
  file: string;
}

/**
 * Vite plugin: while the game runs through `npm run dev` or `npm run preview`,
 * the dev server accepts run summaries and appends them to `<dir>/<file>` as JSON Lines.
 * A real game server will write the same format itself (see `buildRunSummary`).
 */
export function historyLogPlugin(options: HistoryLogOptions): Plugin {
  const handler = createHistoryHandler(options);
  return {
    name: 'skillergo-history-log',
    configureServer(server) {
      server.middlewares.use(HISTORY_ENDPOINT, handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(HISTORY_ENDPOINT, handler);
    },
  };
}

/** Connect-style middleware: POST a RunSummary JSON body, get 204 back. */
export function createHistoryHandler(options: HistoryLogOptions) {
  const target = path.join(options.dir, options.file);
  // Appends are chained so concurrent requests never interleave lines.
  let queue: Promise<void> = Promise.resolve();

  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    if (req.method !== 'POST') {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        res.statusCode = 413;
        res.end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      let entry: unknown;
      try {
        entry = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        entry = null;
      }
      if (!isSummaryShape(entry)) {
        res.statusCode = 400;
        res.end('Invalid run summary');
        return;
      }
      const line = JSON.stringify({ ...entry, loggedAt: new Date().toISOString() }) + '\n';
      queue = queue
        .then(async () => {
          await mkdir(options.dir, { recursive: true });
          await appendFile(target, line, 'utf8');
          res.statusCode = 204;
          res.end();
        })
        .catch((error: unknown) => {
          console.error('[history] failed to write run summary:', error);
          res.statusCode = 500;
          res.end();
        });
    });
  };
}

/** Same checks as `isRunSummary` in the shared package, kept local so this file has no app imports. */
function isSummaryShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const kills = v.kills as Record<string, unknown> | undefined;
  return (
    v.version === 1 &&
    typeof v.durationSeconds === 'number' &&
    typeof v.level === 'number' &&
    typeof v.weapon === 'string' &&
    typeof v.ability === 'string' &&
    !!kills &&
    typeof kills.total === 'number'
  );
}
