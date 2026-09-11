import { CONFIG } from '../config';
import { DEFAULT_SERVER_CONFIG, type ServerConfig } from '../server.config';
import {
  ABILITY_TYPES,
  UPGRADE_STATS,
  WEAPON_TYPES,
  type EntityId,
  type GameSettings,
  type Loadout,
  type PlayerInput,
  type TeamId,
} from '../types';
import type { SnapshotMessage } from './snapshot';

/**
 * Wire protocol between the browser client and the game server (JSON over WebSocket).
 * Bump PROTOCOL_VERSION whenever a message shape changes.
 */
export const PROTOCOL_VERSION = 1;

/** Simulation ticks between two snapshots (60 Hz / 2 = 30 snapshots per second). */
export const TICKS_PER_SNAPSHOT = 2;

export type AuthProvider = 'github' | 'google';
export type UserProvider = AuthProvider | 'guest';

export interface PublicUser {
  id: string;
  name: string;
  avatar: string | null;
  provider: UserProvider;
  rating: number;
  wins: number;
  losses: number;
}

export interface MatchPlayerInfo {
  id: EntityId;
  team: TeamId;
  name: string;
  rating: number;
}

export interface MatchStartInfo {
  matchId: string;
  /** Entity id of the receiving player in the match world. */
  you: EntityId;
  team: TeamId;
  players: MatchPlayerInfo[];
  server: ServerConfig;
  settings: GameSettings;
  /** Wall grid: one digit per tile (0 = free, 1..7 = tetromino type). */
  map: { width: number; height: number; tileSize: number; tiles: string };
  /** True when the player reconnects into a running match. */
  resumed: boolean;
}

export type MatchEndReason = 'nexus' | 'forfeit' | 'surrender';

export interface MatchResult {
  won: boolean;
  reason: MatchEndReason;
  /** Rating after the match and the change it got. */
  rating: number;
  delta: number;
  wins: number;
  losses: number;
}

/** One fixed-step input: [sequence number, input]. The server applies one per tick. */
export type InputCommand = [seq: number, input: PlayerInput];

export type ClientMessage =
  | { t: 'hello'; v: number; fp: string; token: string | null }
  | { t: 'guest'; name: string }
  | { t: 'queue'; loadout: Loadout }
  | { t: 'cancel' }
  | { t: 'input'; cmds: InputCommand[] }
  | { t: 'ping'; c: number }
  | { t: 'leave' };

export type ServerMessage =
  | { t: 'welcome'; user: PublicUser | null; providers: AuthProvider[]; guest: boolean; online: number }
  | { t: 'mismatch' }
  | { t: 'token'; token: string; user: PublicUser }
  | { t: 'authFailed' }
  | { t: 'queued'; waiting: number }
  | { t: 'idle' }
  | { t: 'matchStart'; match: MatchStartInfo }
  | SnapshotMessage
  | { t: 'opponent'; connected: boolean; graceSeconds: number }
  | { t: 'matchEnd'; result: MatchResult }
  | { t: 'pong'; c: number; online: number }
  | { t: 'kicked'; reason: 'replaced' }
  | { t: 'error'; message: string };

/**
 * Hash of everything that must match on client and server: the protocol and every
 * balance value. A client built from other code than the server is told to reload.
 */
export function buildFingerprint(): string {
  const text = JSON.stringify([PROTOCOL_VERSION, CONFIG, DEFAULT_SERVER_CONFIG]);
  // FNV-1a, 32 bit.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ------------------------------------------------------------------ validation
// Everything a client sends is untrusted: these helpers turn it into safe values or null.

const finite = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clampUnit = (v: unknown): number => Math.max(-1, Math.min(1, finite(v)));
const counter = (v: unknown): number => Math.max(0, Math.min(1e9, Math.floor(finite(v))));

export function sanitizeInput(raw: unknown): PlayerInput | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const up = (r.upgrades && typeof r.upgrades === 'object' ? r.upgrades : {}) as Record<string, unknown>;
  const upgrades = { weapon: 0, mobility: 0, ability: 0 };
  for (const stat of UPGRADE_STATS) upgrades[stat] = counter(up[stat]);
  return {
    moveX: clampUnit(r.moveX),
    moveY: clampUnit(r.moveY),
    aim: finite(r.aim),
    fire: r.fire === true,
    ability: r.ability === true,
    dashSeq: counter(r.dashSeq),
    dashX: clampUnit(r.dashX),
    dashY: clampUnit(r.dashY),
    upgrades,
  };
}

export function sanitizeLoadout(raw: unknown): Loadout | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const weapon = WEAPON_TYPES.find((w) => w === r.weapon);
  const ability = ABILITY_TYPES.find((a) => a === r.ability);
  return weapon && ability ? { weapon, ability } : null;
}

/** Display names: control characters removed, trimmed, 2..20 characters. */
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20);
  return name.length >= 2 ? name : null;
}
