import { LANES, type ArenaLayout, type Nexus, type Player, type Tower, type WorldView } from '@skillergo/shared';
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

/** The main building: crystal, HP bar with stage marks and the guardian shield. */
export function drawNexus(ctx: CanvasRenderingContext2D, n: Readonly<Nexus>, view: WorldView): void {
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

  ctx.restore();

  drawBuildingBar(ctx, n.team, n.hp, n.maxHp, n.x, n.y - r - 50, 240, [1 / 3, 2 / 3]);
}

/**
 * Lane tower: a round base with a turret that turns to its target. Enemy players see its
 * range when they come close, in red when the tower is aiming at them.
 */
export function drawTower(
  ctx: CanvasRenderingContext2D,
  t: Readonly<Tower>,
  view: WorldView,
  me: Readonly<Player> | undefined,
): void {
  const colors = TEAM_COLORS[t.team];
  const time = view.time;
  const r = t.radius;
  const range = view.server.towerRange;
  const flash = time - t.lastHitTime < 0.1;

  // Range circle for an enemy player nearby.
  if (me && me.alive && me.team !== t.team) {
    const d = Math.hypot(me.x - t.x, me.y - t.y);
    if (d < range + 450) {
      const aimedAtMe = t.targetKind === 'player' && t.targetId === me.id;
      ctx.save();
      ctx.globalAlpha = aimedAtMe ? 0.8 : Math.max(0.15, 0.5 * (1 - (d - range) / 450));
      ctx.strokeStyle = aimedAtMe ? '#e5534b' : colors.dark;
      ctx.lineWidth = aimedAtMe ? 5 : 3;
      if (!aimedAtMe) ctx.setLineDash([18, 12]);
      ctx.beginPath();
      ctx.arc(t.x, t.y, range, 0, Math.PI * 2);
      ctx.stroke();
      if (aimedAtMe) {
        ctx.fillStyle = 'rgba(229, 83, 75, 0.06)';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  ctx.save();
  // Base.
  ctx.fillStyle = colors.tint;
  ctx.strokeStyle = colors.soft;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(t.x, t.y, r + 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = flash ? '#ffffff' : colors.main;
  ctx.strokeStyle = colors.dark;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Turret facing the current target.
  const target = findTarget(t, view);
  const angle = target ? Math.atan2(target.y - t.y, target.x - t.x) : t.team === 'blue' ? -Math.PI / 4 : (Math.PI * 3) / 4;
  ctx.translate(t.x, t.y);
  ctx.rotate(angle);
  ctx.fillStyle = colors.dark;
  ctx.beginPath();
  ctx.roundRect(0, -9, r + 22, 18, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawBuildingBar(ctx, t.team, t.hp, t.maxHp, t.x, t.y - r - 40, 150, []);
}

function findTarget(t: Readonly<Tower>, view: WorldView): { x: number; y: number } | undefined {
  if (t.targetId === null) return undefined;
  if (t.targetKind === 'player') return view.players.get(t.targetId);
  if (t.targetKind === 'enemy') return view.enemies.get(t.targetId);
  return undefined;
}

function drawBuildingBar(
  ctx: CanvasRenderingContext2D, team: Nexus['team'], hp: number, maxHp: number,
  cx: number, y: number, width: number, marks: number[],
): void {
  const colors = TEAM_COLORS[team];
  const h = 14;
  const x = cx - width / 2;
  ctx.save();
  ctx.fillStyle = '#e6e6e6';
  ctx.beginPath();
  ctx.roundRect(x, y, width, h, 5);
  ctx.fill();
  const ratio = Math.max(0, hp / maxHp);
  if (ratio > 0) {
    ctx.fillStyle = colors.main;
    ctx.beginPath();
    ctx.roundRect(x, y, width * ratio, h, 5);
    ctx.fill();
  }
  // Nexus: marks at 2/3 and 1/3, every mark summons a guardian.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  for (const k of marks) line(ctx, x + width * k, y - 2, x + width * k, y + h + 2);

  ctx.fillStyle = '#333';
  ctx.font = 'bold 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.ceil(hp)} / ${maxHp}`, cx, y - 4);
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
