import type { EnemyKind, TeamId } from '@skillergo/shared';

export interface Style {
  fill: string;
  stroke: string;
}

/** Absolute team colors (like a MOBA): blue is always blue, red is always red. */
export const TEAM_COLORS: Record<TeamId, { main: string; dark: string; tint: string; soft: string }> = {
  blue: { main: '#4a90e2', dark: '#2f6fb8', tint: 'rgba(74, 144, 226, 0.07)', soft: 'rgba(74, 144, 226, 0.35)' },
  red: { main: '#e5534b', dark: '#b83b34', tint: 'rgba(229, 83, 75, 0.07)', soft: 'rgba(229, 83, 75, 0.35)' },
};

/** Player bodies per team. The red one is pinker so it does not blend with red grunts. */
export const PLAYER_STYLE: Record<TeamId, Style> = {
  blue: { fill: '#4a90e2', stroke: '#2f6fb8' },
  red: { fill: '#e74c7a', stroke: '#a82f55' },
};

/** Survival / red team palette: the original enemy colors. */
const RED_MOBS: Record<EnemyKind, Style> = {
  grunt: { fill: '#e5534b', stroke: '#b83b34' },
  rusher: { fill: '#f08c2e', stroke: '#c26a14' },
  sniper: { fill: '#8e5bd6', stroke: '#6a3fb0' },
  colossus: { fill: '#8b2635', stroke: '#5e1823' },
  duelist: { fill: '#1fa88f', stroke: '#137563' },
  blademaster: { fill: '#4d5561', stroke: '#2f353d' },
  dummy: { fill: '#cfd4d9', stroke: '#8a949e' },
  farmer: { fill: '#e2bd72', stroke: '#b08a3e' },
};

/** Blue team mobs: same shapes, cool colors. Bosses and farmers keep their look (a team ring marks them). */
const BLUE_MOBS: Record<EnemyKind, Style> = {
  ...RED_MOBS,
  grunt: { fill: '#4f86d9', stroke: '#3464ad' },
  rusher: { fill: '#2cb5c8', stroke: '#1b8696' },
  sniper: { fill: '#6b6fe0', stroke: '#4a4db5' },
};

export function mobStyle(kind: EnemyKind, team: TeamId): Style {
  return team === 'blue' ? BLUE_MOBS[kind] : RED_MOBS[kind];
}
