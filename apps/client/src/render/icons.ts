import type { AbilityType, WeaponType } from '@skillergo/shared';

export type IconName = WeaponType | AbilityType | 'dash' | 'wipe';

/**
 * Tiny vector icons drawn with Canvas 2D. Shared by the HUD and the start menu,
 * so both always show the same picture. `size` is the icon box in pixels.
 */
export function drawIcon(ctx: CanvasRenderingContext2D, icon: IconName, cx: number, cy: number, size: number, color: string): void {
  const s = size / 32;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (icon) {
    case 'gun':
      ctx.beginPath();
      ctx.arc(-6, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-2, -3, 16, 6);
      break;
    case 'sword':
      ctx.beginPath();
      ctx.moveTo(-9, 9);
      ctx.lineTo(11, -11);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, 2);
      ctx.lineTo(-2, 10);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-9, 9);
      ctx.lineTo(-13, 13);
      ctx.stroke();
      break;
    case 'beam':
      ctx.beginPath();
      ctx.arc(-9, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-4, 0);
      for (let x = -4; x <= 12; x += 4) ctx.lineTo(x, x % 8 === 0 ? -3 : 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(13, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'hook':
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(4, -13);
      ctx.lineTo(4, 4);
      ctx.arc(-3, 4, 7, 0, Math.PI, false);
      ctx.lineTo(-10, -2);
      ctx.stroke();
      break;
    case 'shield':
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(-8, 0, 16, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-8, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'shotgun':
      ctx.lineWidth = 2;
      for (const angle of [-0.45, -0.15, 0.15, 0.45]) {
        ctx.beginPath();
        ctx.moveTo(-11, 0);
        ctx.lineTo(-11 + Math.cos(angle) * 22, Math.sin(angle) * 22);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(-11 + Math.cos(angle) * 24, Math.sin(angle) * 24, 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'wipe':
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * 12, Math.sin(a) * 12);
        ctx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
        ctx.stroke();
      }
      break;
    case 'rifle':
      ctx.beginPath();
      ctx.arc(-10, 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(-8, -2, 22, 4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-2, -3);
      ctx.lineTo(-6, -9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(11, -9, 5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(11, -14);
      ctx.lineTo(11, -4);
      ctx.moveTo(6, -9);
      ctx.lineTo(16, -9);
      ctx.stroke();
      break;
    case 'fireball':
      ctx.beginPath();
      ctx.arc(3, 0, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.5;
      for (const a of [-0.6, 0, 0.6]) {
        ctx.beginPath();
        ctx.moveTo(-6 + Math.cos(Math.PI + a) * 4, Math.sin(Math.PI + a) * 6);
        ctx.lineTo(-16 + Math.cos(Math.PI + a) * 4, Math.sin(Math.PI + a) * 10);
        ctx.stroke();
      }
      break;
    case 'blink':
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(-9, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(9, 0, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-2, 0);
      ctx.lineTo(2, 0);
      ctx.moveTo(-1, -4);
      ctx.lineTo(3, 0);
      ctx.lineTo(-1, 4);
      ctx.stroke();
      break;
    case 'cloak':
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, -2, 9, Math.PI, 0);
      ctx.lineTo(9, 10);
      ctx.lineTo(-9, 10);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-4, -2, 2, 0, Math.PI * 2);
      ctx.arc(4, -2, 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'rally':
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 12, -Math.PI * 0.8, Math.PI * 0.8);
      ctx.stroke();
      for (const dx of [-7, 0, 7]) {
        ctx.beginPath();
        ctx.arc(dx, 4, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(0, -4);
      ctx.moveTo(-4, -9);
      ctx.lineTo(0, -13);
      ctx.lineTo(4, -9);
      ctx.stroke();
      break;
    case 'whirlwind':
      ctx.lineWidth = 3;
      for (const turn of [0, Math.PI]) {
        ctx.beginPath();
        ctx.arc(0, 0, 11, turn + 0.4, turn + Math.PI - 0.4);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(Math.cos(turn + 0.4) * 11, Math.sin(turn + 0.4) * 11);
        ctx.lineTo(Math.cos(turn + 0.1) * 16, Math.sin(turn + 0.1) * 14);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dash':
      ctx.lineWidth = 3.5;
      for (const offset of [-6, 4]) {
        ctx.beginPath();
        ctx.moveTo(offset - 4, -8);
        ctx.lineTo(offset + 4, 0);
        ctx.lineTo(offset - 4, 8);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}
