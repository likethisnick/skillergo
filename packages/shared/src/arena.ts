import type { TeamId } from './types';

/**
 * Versus map layout: a square split along the top-left -> bottom-right diagonal.
 * Blue owns the bottom-left half, red the top-right half, with a neutral band on
 * the diagonal. Three lanes connect the bases: top (via the top-left corner),
 * mid (straight diagonal) and bot (via the bottom-right corner).
 */
export type LaneId = 'top' | 'mid' | 'bot';
export const LANES: readonly LaneId[] = ['top', 'mid', 'bot'];

export interface Point {
  x: number;
  y: number;
}

export interface ArenaLayout {
  size: number;
  /** Nexus position per team (deep in the corner). */
  nexus: Record<TeamId, Point>;
  /** Base hub where lanes start and waves appear. */
  hub: Record<TeamId, Point>;
  /** Player (re)spawn point next to the nexus. */
  spawn: Record<TeamId, Point>;
  /** Lane waypoints from the blue base to the red base. */
  lanes: Record<LaneId, Point[]>;
  laneHalfWidth: number;
  neutralHalfWidth: number;
  baseRadius: number;
}

export interface ArenaOptions {
  size: number;
  cornerInset: number;
  nexusInset: number;
  laneHalfWidth: number;
  neutralHalfWidth: number;
  baseRadius: number;
}

export function createArenaLayout(o: ArenaOptions): ArenaLayout {
  const S = o.size;
  const c = o.cornerInset;
  const blueHub = { x: c, y: S - c };
  const redHub = { x: S - c, y: c };
  const blueNexus = { x: o.nexusInset, y: S - o.nexusInset };
  const redNexus = { x: S - o.nexusInset, y: o.nexusInset };
  return {
    size: S,
    nexus: { blue: blueNexus, red: redNexus },
    hub: { blue: blueHub, red: redHub },
    spawn: {
      blue: { x: (blueNexus.x + blueHub.x) / 2 + 60, y: (blueNexus.y + blueHub.y) / 2 - 60 },
      red: { x: (redNexus.x + redHub.x) / 2 - 60, y: (redNexus.y + redHub.y) / 2 + 60 },
    },
    lanes: {
      top: [blueHub, { x: c, y: c }, redHub],
      mid: [blueHub, redHub],
      bot: [blueHub, { x: S - c, y: S - c }, redHub],
    },
    laneHalfWidth: o.laneHalfWidth,
    neutralHalfWidth: o.neutralHalfWidth,
    baseRadius: o.baseRadius,
  };
}

/** Signed distance from the dividing diagonal: positive on blue's side, negative on red's. */
export function diagonalOffset(x: number, y: number): number {
  return (y - x) / Math.SQRT2;
}

export function territoryAt(layout: ArenaLayout, x: number, y: number): TeamId | 'neutral' {
  const d = diagonalOffset(x, y);
  if (d > layout.neutralHalfWidth) return 'blue';
  if (d < -layout.neutralHalfWidth) return 'red';
  return 'neutral';
}

/** How far inside `team`'s half the point is (negative = on the other half). */
export function depthInto(team: TeamId, x: number, y: number): number {
  const d = diagonalOffset(x, y);
  return team === 'blue' ? d : -d;
}

/** Lane waypoints ordered from `team`'s base towards the enemy base. */
export function lanePath(layout: ArenaLayout, lane: LaneId, team: TeamId): Point[] {
  const points = layout.lanes[lane];
  return team === 'blue' ? points : [...points].reverse();
}

export function distanceToPolyline(points: readonly Point[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    best = Math.min(best, distanceToSegment(points[i], points[i + 1], x, y));
  }
  return best;
}

export function nearestLane(layout: ArenaLayout, x: number, y: number): LaneId {
  let best: LaneId = 'mid';
  let bestDist = Infinity;
  for (const lane of LANES) {
    const d = distanceToPolyline(layout.lanes[lane], x, y);
    if (d < bestDist) {
      bestDist = d;
      best = lane;
    }
  }
  return best;
}

/** Lanes and bases stay free of walls. */
export function isKeptClear(layout: ArenaLayout, x: number, y: number): boolean {
  for (const team of ['blue', 'red'] as const) {
    const n = layout.nexus[team];
    const h = layout.hub[team];
    if ((x - n.x) ** 2 + (y - n.y) ** 2 < layout.baseRadius ** 2) return true;
    if ((x - h.x) ** 2 + (y - h.y) ** 2 < layout.baseRadius ** 2) return true;
  }
  for (const lane of LANES) {
    if (distanceToPolyline(layout.lanes[lane], x, y) < layout.laneHalfWidth) return true;
  }
  return false;
}

function distanceToSegment(a: Point, b: Point, x: number, y: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
}
