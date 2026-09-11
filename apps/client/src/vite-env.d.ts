/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Game server base URL, e.g. https://skillergo-server.fly.dev (Vercel project env variable). */
  readonly VITE_GAME_SERVER_URL?: string;
}
