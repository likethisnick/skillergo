import type { Rng } from './math/rng';

/** Tetromino shapes as [col, row] cells. Index + 1 is stored in the grid (for coloring). */
const TETROMINOES: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0], [1, 0], [2, 0], [3, 0]], // I
  [[0, 0], [1, 0], [0, 1], [1, 1]], // O
  [[0, 0], [1, 0], [2, 0], [1, 1]], // T
  [[1, 0], [2, 0], [0, 1], [1, 1]], // S
  [[0, 0], [1, 0], [1, 1], [2, 1]], // Z
  [[0, 0], [0, 1], [1, 1], [2, 1]], // J
  [[2, 0], [0, 1], [1, 1], [2, 1]], // L
];

export const TETROMINO_NAMES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as const;

export interface MapGenerationOptions {
  /** Target share of the buildable ground covered by walls, 0..1. */
  density: number;
  /** Connectivity is measured from here (the player start); it is always kept clear. */
  startX: number;
  startY: number;
  /** Returns true where no wall may be placed (start area, lanes, bases). */
  keepClear: (x: number, y: number) => boolean;
}

/**
 * Tile grid with impassable tetromino-shaped walls.
 * Provides everything that has to respect walls: circle collision, raycasts,
 * line of sight and flow-field pathfinding.
 */
export class GameMap {
  readonly cols: number;
  readonly rows: number;
  /** 0 = free, 1..7 = wall (tetromino type + 1, used for coloring). */
  readonly tiles: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly tileSize: number,
  ) {
    this.cols = Math.ceil(width / tileSize);
    this.rows = Math.ceil(height / tileSize);
    this.tiles = new Uint8Array(this.cols * this.rows);
  }

  // ------------------------------------------------------------ generation

  /**
   * Scatters random tetrominoes until `density` of the tiles are walls.
   * A piece is rejected if it would cut off any free area, so every free tile
   * stays reachable (nothing can spawn in a sealed pocket).
   */
  generate(rng: Rng, options: MapGenerationOptions): void {
    this.tiles.fill(0);
    const ts = this.tileSize;
    let buildable = 0;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) if (!options.keepClear((c + 0.5) * ts, (r + 0.5) * ts)) buildable++;
    }
    const target = Math.floor(buildable * Math.max(0, Math.min(0.6, options.density)));
    const startTile = this.tileIndexAt(options.startX, options.startY);
    let solid = 0;
    let attempts = target * 30;

    while (solid < target && attempts-- > 0) {
      const type = Math.floor(rng.next() * TETROMINOES.length);
      const cells = rotate(TETROMINOES[type], Math.floor(rng.next() * 4));
      const baseC = Math.floor(rng.next() * this.cols);
      const baseR = Math.floor(rng.next() * this.rows);

      const placed: number[] = [];
      let ok = true;
      for (const [dc, dr] of cells) {
        const c = baseC + dc;
        const r = baseR + dr;
        if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) { ok = false; break; }
        const index = r * this.cols + c;
        if (this.tiles[index] !== 0) { ok = false; break; }
        if (options.keepClear((c + 0.5) * ts, (r + 0.5) * ts)) { ok = false; break; }
        placed.push(index);
      }
      if (!ok) continue;

      for (const index of placed) this.tiles[index] = type + 1;
      if (this.countReachable(startTile) === this.tiles.length - solid - placed.length) {
        solid += placed.length;
      } else {
        for (const index of placed) this.tiles[index] = 0;
      }
    }
  }

  /** Share of tiles that are walls. */
  density(): number {
    let solid = 0;
    for (const t of this.tiles) if (t !== 0) solid++;
    return solid / this.tiles.length;
  }

  // ----------------------------------------------------------------- queries

  tileIndexAt(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.tileSize)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.tileSize)));
    return r * this.cols + c;
  }

  isSolidTile(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return false;
    return this.tiles[r * this.cols + c] !== 0;
  }

  isSolidAt(x: number, y: number): boolean {
    return this.isSolidTile(Math.floor(x / this.tileSize), Math.floor(y / this.tileSize));
  }

  /** True if a circle does not touch any wall. */
  circleFree(x: number, y: number, radius: number): boolean {
    const ts = this.tileSize;
    const minC = Math.floor((x - radius) / ts);
    const maxC = Math.floor((x + radius) / ts);
    const minR = Math.floor((y - radius) / ts);
    const maxR = Math.floor((y + radius) / ts);
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (!this.isSolidTile(c, r)) continue;
        const nx = Math.max(c * ts, Math.min(x, (c + 1) * ts));
        const ny = Math.max(r * ts, Math.min(y, (r + 1) * ts));
        if ((x - nx) ** 2 + (y - ny) ** 2 < radius * radius) return false;
      }
    }
    return true;
  }

  /**
   * Pushes a circle out of walls. Returns the corrected position and whether it touched a wall.
   * Units slide along walls instead of sticking to them.
   */
  resolveCircle(x: number, y: number, radius: number): { x: number; y: number; hit: boolean } {
    const ts = this.tileSize;
    let hit = false;
    for (let iteration = 0; iteration < 3; iteration++) {
      let moved = false;
      const minC = Math.floor((x - radius) / ts);
      const maxC = Math.floor((x + radius) / ts);
      const minR = Math.floor((y - radius) / ts);
      const maxR = Math.floor((y + radius) / ts);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (!this.isSolidTile(c, r)) continue;
          const left = c * ts;
          const top = r * ts;
          const nx = Math.max(left, Math.min(x, left + ts));
          const ny = Math.max(top, Math.min(y, top + ts));
          const dx = x - nx;
          const dy = y - ny;
          const distSq = dx * dx + dy * dy;
          if (distSq >= radius * radius) continue;
          hit = true;
          moved = true;
          if (distSq > 1e-9) {
            const dist = Math.sqrt(distSq);
            x += (dx / dist) * (radius - dist);
            y += (dy / dist) * (radius - dist);
          } else {
            // Center inside the tile: leave through the nearest edge.
            const exits = [x - left, left + ts - x, y - top, top + ts - y];
            const min = Math.min(...exits);
            if (min === exits[0]) x = left - radius;
            else if (min === exits[1]) x = left + ts + radius;
            else if (min === exits[2]) y = top - radius;
            else y = top + ts + radius;
          }
        }
      }
      if (!moved) break;
    }
    return { x, y, hit };
  }

  /**
   * First wall hit along the segment (x0,y0)->(x1,y1), as a fraction 0..1 of the segment,
   * or null if the segment is clear. Grid traversal (DDA), exact and cheap.
   */
  raycast(x0: number, y0: number, x1: number, y1: number): number | null {
    const ts = this.tileSize;
    let c = Math.floor(x0 / ts);
    let r = Math.floor(y0 / ts);
    if (this.isSolidTile(c, r)) return 0;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const stepC = Math.sign(dx);
    const stepR = Math.sign(dy);
    const tDeltaX = dx !== 0 ? ts / Math.abs(dx) : Infinity;
    const tDeltaY = dy !== 0 ? ts / Math.abs(dy) : Infinity;
    let tMaxX = dx > 0 ? ((c + 1) * ts - x0) / dx : dx < 0 ? (c * ts - x0) / dx : Infinity;
    let tMaxY = dy > 0 ? ((r + 1) * ts - y0) / dy : dy < 0 ? (r * ts - y0) / dy : Infinity;

    for (let guard = 0; guard < 4096; guard++) {
      let t: number;
      if (tMaxX < tMaxY) {
        t = tMaxX;
        c += stepC;
        tMaxX += tDeltaX;
      } else {
        t = tMaxY;
        r += stepR;
        tMaxY += tDeltaY;
      }
      if (t > 1) return null;
      if (this.isSolidTile(c, r)) return t;
    }
    return null;
  }

  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    return this.raycast(x0, y0, x1, y1) === null;
  }

  // ------------------------------------------------------------ pathfinding

  /**
   * Distance (in tiles, 4-neighbour steps) from every free tile to the tile at (x, y).
   * -1 = wall. Recomputed only when the target moves to another tile.
   */
  buildFlowField(x: number, y: number): FlowField {
    const dist = new Int32Array(this.tiles.length).fill(-1);
    const start = this.tileIndexAt(x, y);
    const queue = new Int32Array(this.tiles.length);
    let head = 0;
    let tail = 0;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      const index = queue[head++];
      const c = index % this.cols;
      const r = (index - c) / this.cols;
      const next = dist[index] + 1;
      if (c > 0) tail = this.visit(index - 1, next, dist, queue, tail);
      if (c < this.cols - 1) tail = this.visit(index + 1, next, dist, queue, tail);
      if (r > 0) tail = this.visit(index - this.cols, next, dist, queue, tail);
      if (r < this.rows - 1) tail = this.visit(index + this.cols, next, dist, queue, tail);
    }
    return { targetTile: start, dist };
  }

  /**
   * Unit direction from (x, y) towards the flow-field target, following the grid
   * around walls (diagonals allowed only when both side tiles are free), or null.
   */
  nextStep(field: FlowField, x: number, y: number): { x: number; y: number } | null {
    const index = this.tileIndexAt(x, y);
    const here = field.dist[index];
    if (here <= 0) return null;
    const c = index % this.cols;
    const r = (index - c) / this.cols;
    let best = here;
    let bestC = -1;
    let bestR = -1;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dc === 0 && dr === 0) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
        const d = field.dist[nr * this.cols + nc];
        if (d < 0) continue;
        if (dc !== 0 && dr !== 0 && (this.isSolidTile(c + dc, r) || this.isSolidTile(c, r + dr))) continue;
        // Diagonal steps skip a tile, so they win ties against straight ones.
        const score = dc !== 0 && dr !== 0 ? d - 0.5 : d;
        if (score < best) {
          best = score;
          bestC = nc;
          bestR = nr;
        }
      }
    }
    if (bestC < 0) return null;
    const tx = (bestC + 0.5) * this.tileSize - x;
    const ty = (bestR + 0.5) * this.tileSize - y;
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    return { x: tx / len, y: ty / len };
  }

  // ------------------------------------------------------------------ helpers

  private visit(index: number, value: number, dist: Int32Array, queue: Int32Array, tail: number): number {
    if (dist[index] !== -1 || this.tiles[index] !== 0) return tail;
    dist[index] = value;
    queue[tail] = index;
    return tail + 1;
  }

  private countReachable(start: number): number {
    if (this.tiles[start] !== 0) return 0;
    const seen = new Uint8Array(this.tiles.length);
    const stack = [start];
    seen[start] = 1;
    let count = 0;
    while (stack.length) {
      const index = stack.pop()!;
      count++;
      const c = index % this.cols;
      const neighbours = [
        c > 0 ? index - 1 : -1,
        c < this.cols - 1 ? index + 1 : -1,
        index - this.cols,
        index + this.cols,
      ];
      for (const n of neighbours) {
        if (n < 0 || n >= this.tiles.length || seen[n] || this.tiles[n] !== 0) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    return count;
  }
}

export interface FlowField {
  targetTile: number;
  /** Steps to the target per tile; -1 for walls. */
  dist: Int32Array;
}

function rotate(cells: readonly (readonly [number, number])[], turns: number): [number, number][] {
  let result = cells.map(([c, r]) => [c, r] as [number, number]);
  for (let i = 0; i < turns; i++) result = result.map(([c, r]) => [-r, c] as [number, number]);
  const minC = Math.min(...result.map(([c]) => c));
  const minR = Math.min(...result.map(([, r]) => r));
  return result.map(([c, r]) => [c - minC, r - minR]);
}
