import type { GameMap } from './map';

interface Circle {
  x: number;
  y: number;
  radius: number;
}

/**
 * Pushes a circle out of walls, then out of round buildings (nexuses, towers).
 * Used by the simulation and by client-side prediction, so both collide identically.
 */
export function resolveObstacles(
  map: GameMap,
  buildings: readonly Iterable<Readonly<Circle>>[],
  x: number, y: number, radius: number,
): { x: number; y: number } {
  const resolved = map.resolveCircle(x, y, radius);
  for (const group of buildings) {
    for (const b of group) {
      const dx = resolved.x - b.x;
      const dy = resolved.y - b.y;
      const min = b.radius + radius;
      const distSq = dx * dx + dy * dy;
      if (distSq < min * min) {
        const d = Math.sqrt(distSq) || 1;
        resolved.x = b.x + (dx / d) * min;
        resolved.y = b.y + (dy / d) * min;
      }
    }
  }
  return resolved;
}
