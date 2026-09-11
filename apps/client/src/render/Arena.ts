import { LANES, type ArenaLayout, type Nexus, type Player, type WorldView } from '@skillergo/shared';
import { TEAM_COLORS } from './teams';

/**
 * World-space drawing for the versus map: territories, lanes, bases and nexuses.
 * Survival and training do not use it.
 */

/** Tinted halves, the neutral band, lane corridors and base circles. */
export function drawArenaGround(ctx: CanvasRenderingContext2D, arena: Readonly<ArenaLayout>): void {
  const S = arena.size;
  // The neutral band is |y - x| / sqrt(2) <= neutralHalfWidth, so its edges are y = x +- n * sqrt(2).
  const edge = arena.neutralHalfWidth * Math.SQRT2;

  ctx.save();
  // Blue owns the bottom-left half, red the top-right half.
  ctx.fillStyle = TEAM_COLORS.blue.tint;
  polygon(ctx, [[0, edge], [S - edge, S], [0, S]]);
  ctx.fill();
  ctx.fillStyle = TEAM_COLORS.red.tint;
  polygon(ctx, [[edge, 0], [S, 0], [S, S - edge]]);
  ctx.fill();

  // Lane corridors: a soft path under everything else. One stroke for all lanes,
  // so the translucent color does not get darker where they cross.
  ctx.strokeStyle = 'rgba(222, 200, 150, 0.2)';
  ctx.lineWidth = arena.laneHalfWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const lane of LANES) {
    const points = arena.lanes[lane];
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Neutral band borders.
  ctx.setLineDash([30, 22]);
  ctx.lineWidth = 4;
  ctx.strokeStyle = TEAM_COLORS.blue.soft;
  line(ctx, 0, edge, S - edge, S);
  ctx.strokeStyle = TEAM_COLORS.red.soft;
  line(ctx, edge, 0, S, S - edge);

  // Base circles around each nexus.
  ctx.setLineDash([18, 14]);
  for (const team of ['blue', 'red'] as const) {
    const n = arena.nexus[team];
    ctx.strokeStyle = TEAM_COLORS[team].soft;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(n.x, n.y, arena.baseRadius * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** The main building: crystal, HP bar with stage marks, guardian shield and a lock for low levels. */
export function drawNexus(
  ctx: CanvasRenderingContext2D,
  n: Readonly<Nexus>,
  view: WorldView,
  me: Readonly<Player> | undefined,
): void {
  const colors = TEAM_COLORS[n.team];
  const time = view.time;
  const r = n.radius;
  const destroyed = n.hp <= 0;
  const flash = time - n.lastHitTime < 0.1;

  ctx.save();
  // Platform.
  ctx.fillStyle = colors.tint;
  ctx.strokeStyle = colors.soft;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(n.x, n.y, r + 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Body: an octagon.
  ctx.fillStyle = destroyed ? '#b9b9b9' : flash ? '#ffffff' : colors.main;
  ctx.strokeStyle = destroyed ? '#8a8a8a' : colors.dark;
  ctx.lineWidth = 6;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const px = n.x + Math.cos(a) * r;
    const py = n.y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (!destroyed) {
    // Slowly spinning core crystal.
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(time * 0.6);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.38, 0);
    ctx.lineTo(0, r * 0.55);
    ctx.lineTo(-r * 0.38, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Shield bubble while a guardian lives.
  if (n.guardianId !== null && view.enemies.has(n.guardianId)) {
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(-time * 0.8);
    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(time * 4);
    ctx.setLineDash([16, 10]);
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(0, 0, r + 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // A padlock for players who cannot hurt this nexus yet.
  if (!destroyed && me && me.team !== n.team && me.level < view.server.nexusUnlockLevel) {
    drawLock(ctx, n.x, n.y, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(`Lv ${view.server.nexusUnlockLevel}`, n.x, n.y + 26);
  }
  ctx.restore();

  drawNexusBar(ctx, n, n.x, n.y - r - 50, 240);
}

function drawNexusBar(ctx: CanvasRenderingContext2D, n: Readonly<Nexus>, cx: number, y: number, width: number): void {
  const colors = TEAM_COLORS[n.team];
  const h = 14;
  const x = cx - width / 2;
  ctx.save();
  ctx.fillStyle = '#e6e6e6';
  ctx.beginPath();
  ctx.roundRect(x, y, width, h, 5);
  ctx.fill();
  const ratio = Math.max(0, n.hp / n.maxHp);
  if (ratio > 0) {
    ctx.fillStyle = colors.main;
    ctx.beginPath();
    ctx.roundRect(x, y, width * ratio, h, 5);
    ctx.fill();
  }
  // Marks at 2/3 and 1/3: every mark summons a guardian.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (const k of [1 / 3, 2 / 3]) line(ctx, x + width * k, y - 2, x + width * k, y + h + 2);

  ctx.fillStyle = '#333';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.ceil(n.hp)} / ${n.maxHp}`, cx, y - 4);
  ctx.restore();
}

function drawLock(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(40, 40, 40, 0.75)';
  ctx.strokeStyle = 'rgba(40, 40, 40, 0.75)';
  ctx.lineWidth = size * 0.16;
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.2, size * 0.32, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.5, cy - size * 0.2, size, size * 0.75, 5);
  ctx.fill();
  ctx.restore();
}

function polygon(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}
