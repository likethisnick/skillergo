import { CONFIG } from './config';

const P = CONFIG.progression;

/** XP required to go from `level` to `level + 1`: 1000, 1100, 1200, ... */
export function xpToNextLevel(level: number): number {
  return P.baseXp + P.xpStep * (level - P.startLevel);
}
