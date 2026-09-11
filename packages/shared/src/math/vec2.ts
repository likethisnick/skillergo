export interface Vec2 {
  x: number;
  y: number;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt(distanceSq(ax, ay, bx, by));
}

export function circlesOverlap(
  ax: number, ay: number, ar: number,
  bx: number, by: number, br: number,
): boolean {
  const r = ar + br;
  return distanceSq(ax, ay, bx, by) <= r * r;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Normalizes (x, y); returns a zero vector for zero input. */
export function normalize(x: number, y: number): Vec2 {
  const len = length(x, y);
  return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
}

/**
 * Swept hit test: does the segment (x0,y0)->(x1,y1) pass within `r` of (cx,cy)?
 * Used for fast-moving objects so they never tunnel through targets,
 * even at low server tick rates.
 */
export function segmentCircleHit(
  x0: number, y0: number, x1: number, y1: number,
  cx: number, cy: number, r: number,
): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? ((cx - x0) * dx + (cy - y0) * dy) / lenSq : 0;
  t = clamp(t, 0, 1);
  return distanceSq(x0 + dx * t, y0 + dy * t, cx, cy) <= r * r;
}

/** Wraps an angle to [-PI, PI]. */
export function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Does a circle (cx, cy, r) touch the cone that starts at (ox, oy),
 * points along `angle`, spans `arc` radians and reaches `range`?
 */
export function circleInCone(
  ox: number, oy: number, angle: number, arc: number, range: number,
  cx: number, cy: number, r: number,
): boolean {
  const dx = cx - ox;
  const dy = cy - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist - r > range) return false;
  if (dist <= r) return true;
  const diff = Math.abs(wrapAngle(Math.atan2(dy, dx) - angle));
  return diff <= arc / 2 + Math.asin(Math.min(1, r / dist));
}

/**
 * Distance along a ray (origin, unit direction) to the first intersection with a circle,
 * or null if the ray misses. Returns 0 when the origin is inside the circle.
 */
export function rayCircleDistance(
  ox: number, oy: number, dirX: number, dirY: number,
  cx: number, cy: number, r: number,
): number | null {
  const toX = cx - ox;
  const toY = cy - oy;
  const proj = toX * dirX + toY * dirY;
  const distSq = toX * toX + toY * toY;
  if (distSq <= r * r) return 0;
  if (proj < 0) return null;
  const perpSq = distSq - proj * proj;
  if (perpSq > r * r) return null;
  return proj - Math.sqrt(r * r - perpSq);
}
