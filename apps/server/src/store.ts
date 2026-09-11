import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PublicUser, UserProvider } from '@skillergo/shared';

export interface UserRecord {
  /** "<provider>:<id at the provider>", e.g. "github:123456". */
  id: string;
  provider: UserProvider;
  name: string;
  avatar: string | null;
  rating: number;
  wins: number;
  losses: number;
  createdAt: string;
  lastSeen: string;
}

interface FileShape {
  version: 1;
  users: Record<string, UserRecord>;
}

/** Seconds between a change and the write to disk (changes in between share one write). */
const SAVE_DELAY_MS = 1000;

/**
 * All players and their ratings in one JSON file. Fine for a small game:
 * everything lives in memory and the file is rewritten (atomically) after changes.
 */
export class UserStore {
  private readonly file: string;
  private readonly users = new Map<string, UserRecord>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string, private readonly startRating: number) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'users.json');
    this.load();
  }

  get(id: string): UserRecord | undefined {
    return this.users.get(id);
  }

  /** Finds or creates the user after a login; the name and avatar follow the provider profile. */
  upsert(id: string, provider: UserProvider, name: string, avatar: string | null): UserRecord {
    const now = new Date().toISOString();
    let user = this.users.get(id);
    if (!user) {
      user = { id, provider, name, avatar, rating: this.startRating, wins: 0, losses: 0, createdAt: now, lastSeen: now };
      this.users.set(id, user);
    } else {
      user.name = name;
      user.avatar = avatar;
      user.lastSeen = now;
    }
    this.changed();
    return user;
  }

  touch(user: UserRecord): void {
    user.lastSeen = new Date().toISOString();
    this.changed();
  }

  /** Call after changing a record in place (rating, wins, losses). */
  changed(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, SAVE_DELAY_MS);
  }

  /** Writes pending changes right away (on shutdown). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.save();
  }

  get size(): number {
    return this.users.size;
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return; // First start: no file yet.
    }
    const data = JSON.parse(raw) as FileShape;
    for (const user of Object.values(data.users ?? {})) this.users.set(user.id, user);
    console.log(`[store] loaded ${this.users.size} users from ${this.file}`);
  }

  private save(): void {
    const data: FileShape = { version: 1, users: Object.fromEntries(this.users) };
    // Write to a temp file and rename: a crash mid-write never leaves a broken users.json.
    const tmp = `${this.file}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(data, null, 1));
      renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] save failed', err);
    }
  }
}

export function publicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    provider: user.provider,
    rating: user.rating,
    wins: user.wins,
    losses: user.losses,
  };
}
