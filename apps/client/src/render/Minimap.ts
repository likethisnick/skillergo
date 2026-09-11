import { LANES, type EntityId, type GameMap, type WorldView } from '@skillergo/shared';
import type { Camera } from './Camera';
import { TEAM_COLORS } from './teams';

/**
 * Versus minimap in the top-right corner. The static part (territories, lanes,
 * walls) is drawn once into an offscreen canvas; units are drawn every frame.
 */
export class Minimap {
  private background: HTMLCanvasElement | null = null;
  private cachedFor: { map: GameMap; size: number; dpr: number } | null = null;

  draw(
    ctx: CanvasRenderingContext2D,
    view: WorldView,
    localPlayerId: EntityId,
    camera: Camera,
    left: number,
    top: number,
    size: number,
    dpr: number,
  ): void {
    const arena = view.arena;
    if (!arena) return;
    const k = size / arena.size;
    const bg = this.backgroundFor(view, size, dpr);

    ctx.save();
    // Frame.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeStyle = '#cfcfcf';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(left - 4, top - 4, size + 8, size + 8, 8);
    ctx.fill();
    ctx.stroke();
    ctx.drawImage(bg, left, top, size, size);

    const dot = (x: number, y: number, r: number, fill: string, stroke?: string): void => {
      ctx.beginPath();
      ctx.arc(left + x * k, top + y * k, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    };

    // Nexuses: squares with a small HP bar.
    for (const n of view.nexuses.values()) {
      const x = left + n.x * k;
      const y = top + n.y * k;
      ctx.fillStyle = n.hp > 0 ? TEAM_COLORS[n.team].main : '#9e9e9e';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.fillRect(x - 6, y - 6, 12, 12);
      ctx.strokeRect(x - 6, y - 6, 12, 12);
    }

    for (const e of view.enemies.values()) {
      if (e.role === 'farmer') dot(e.x, e.y, 1.8, '#d4a23f');
      else if (e.role === 'guardian') dot(e.x, e.y, 4.5, TEAM_COLORS[e.team].dark, '#ffffff');
      else dot(e.x, e.y, 1.6, TEAM_COLORS[e.team].main);
    }

    for (const p of view.players.values()) {
      if (!p.alive) continue;
      const mine = p.id === localPlayerId;
      dot(p.x, p.y, mine ? 4.5 : 4, p.team === 'blue' ? '#2f6fb8' : '#a82f55', mine ? '#ffd24a' : '#ffffff');
    }

    // Visible part of the world.
    const b = camera.bounds();
    ctx.strokeStyle = 'rgba(60, 60, 60, 0.6)';
    ctx.lineWidth = 1;
    const vx = Math.max(0, b.left);
    const vy = Math.max(0, b.top);
    const vw = Math.min(arena.size, b.right) - vx;
    const vh = Math.min(arena.size, b.bottom) - vy;
    if (vw > 0 && vh > 0) ctx.strokeRect(left + vx * k, top + vy * k, vw * k, vh * k);
    ctx.restore();
  }

  private backgroundFor(view: WorldView, size: number, dpr: number): HTMLCanvasElement {
    const c = this.cachedFor;
    if (this.background && c && c.map === view.map && c.size === size && c.dpr === dpr) return this.background;

    const arena = view.arena!;
    const canvas = this.background ?? document.createElement('canvas');
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const g = canvas.getContext('2d')!;
    const k = (size * dpr) / arena.size;
    g.setTransform(k, 0, 0, k, 0, 0);
    const S = arena.size;
    const edge = arena.neutralHalfWidth * Math.SQRT2;

    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, S, S);
    g.fillStyle = 'rgba(74, 144, 226, 0.18)';
    g.beginPath();
    g.moveTo(0, edge);
    g.lineTo(S - edge, S);
    g.lineTo(0, S);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(229, 83, 75, 0.16)';
    g.beginPath();
    g.moveTo(edge, 0);
    g.lineTo(S, 0);
    g.lineTo(S, S - edge);
    g.closePath();
    g.fill();

    g.strokeStyle = 'rgba(214, 186, 128, 0.35)';
    g.lineWidth = arena.laneHalfWidth;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (const lane of LANES) {
      const pts = arena.lanes[lane];
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    }
    g.stroke();

    const map = view.map;
    g.fillStyle = 'rgba(120, 130, 140, 0.4)';
    for (let r = 0; r < map.rows; r++) {
      for (let col = 0; col < map.cols; col++) {
        if (map.tiles[r * map.cols + col] !== 0) g.fillRect(col * map.tileSize, r * map.tileSize, map.tileSize, map.tileSize);
      }
    }

    this.background = canvas;
    this.cachedFor = { map: view.map, size, dpr };
    return canvas;
  }
}
