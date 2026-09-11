import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { DEFAULT_SERVER_CONFIG } from '../../packages/shared/src/server.config';
import { historyLogPlugin } from './dev/historyLog';

/** Project root (C:\Skillergo), where the logs folder lives. */
const projectRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const server = DEFAULT_SERVER_CONFIG;

export default defineConfig({
  plugins: server.historyEnabled
    ? [historyLogPlugin({ dir: path.resolve(projectRoot, server.historyDir), file: server.historyFile })]
    : [],
  server: {
    // Listen on LAN too, so the game can be opened from a phone on the same Wi-Fi.
    host: true,
    port: 5173,
  },
});
