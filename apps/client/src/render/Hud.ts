import {
  CONFIG,
  UPGRADE_STATS,
  abilityScaling,
  attackSpeedMultiplier,
  dashCooldown,
  difficultyLabel,
  isBossKind,
  weaponDamageMultiplier,
  type Enemy,
  type Nexus,
  type Player,
  type ServerConfig,
  type UpgradeStat,
  type WorldView,
} from '@skillergo/shared';
import { ABILITY_INFO, ABILITY_UPGRADE_TEXT, UPGRADE_INFO, WEAPON_INFO } from '../ui/loadoutInfo';
import type { Effects } from './Effects';
import { drawIcon, type IconName } from './icons';
import { PLAYER_STYLE, TEAM_COLORS } from './teams';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const SLOT_RADIUS = 26;
const SLOT_SPACING = 80;

/** Screen-space UI: stats, settings, boss bar, ability/dash slots, banners, controls hint. */
export function drawHud(
  ctx: CanvasRenderingContext2D,
  me: Readonly<Player>,
  view: WorldView,
  effects: Effects,
  width: number,
  height: number,
): void {
  const training = view.mode === 'training';
  const versus = view.mode === 'versus';
  drawStats(ctx, me, view);
  if (training) drawTrainingInfo(ctx, effects, width);
  else drawSettings(ctx, view, width);
  if (versus) drawNexusBars(ctx, me, view, width);
  else drawBossBar(ctx, view, width);
  if (versus && !me.alive) drawRespawnOverlay(ctx, me, width, height);
  if (me.upgradePoints > 0 && !training) drawUpgradeChoices(ctx, me, width / 2, height - 190);
  drawSlots(ctx, me, view.server, width / 2, height - 62);
  drawBanners(ctx, effects, width, height);
  // The controls hint only makes sense for keyboard + mouse screens.
  if (width >= 1100) drawHint(ctx, height);
}

function drawStats(ctx: CanvasRenderingContext2D, me: Readonly<Player>, view: WorldView): void {
  const x = 20;
  const barW = 220;
  const needed = view.xpToNext(me.level);

  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#333';
  ctx.font = `bold 22px ${FONT}`;
  ctx.fillText(`Level ${me.level}`, x, 20);

  drawBar(ctx, x, 52, barW, 16, me.hp / me.maxHp, '#e5534b', `${Math.ceil(me.hp)} / ${me.maxHp} HP`);
  drawBar(ctx, x, 74, barW, 12, me.xp / needed, '#3cc36b', `${me.xp} / ${needed} XP`);

  ctx.fillStyle = '#666';
  ctx.font = `14px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(weaponStatLine(me, view.server), x, 96);
  ctx.fillText(`Kills ${me.kills}`, x, 116);
  const r = me.ranks;
  ctx.fillText(`Upgrades  1·${r.weapon}  2·${r.mobility}  3·${r.ability}`, x, 136);

  let y = 162;
  if (view.mode === 'versus') {
    ctx.fillText(`Players ${me.killStats.players} · Towers ${me.killStats.towers} · Deaths ${me.deaths}`, x, y);
    y += 26;
  }

  // Active power-ups with their remaining time.
  ctx.font = `bold 13px ${FONT}`;
  for (const buff of BUFF_LABELS) {
    const left = me.buffs[buff.key];
    if (left <= 0) continue;
    ctx.fillStyle = buff.color;
    ctx.fillText(`${buff.label}  ${left.toFixed(1)} s`, x, y);
    y += 18;
  }
  ctx.restore();
}

const BUFF_LABELS = [
  { key: 'damage', label: 'DAMAGE x4', color: '#e8590c' },
  { key: 'attackSpeed', label: 'ATTACK SPEED x4', color: '#e8590c' },
  { key: 'speed', label: 'SPEED x2.5', color: '#1e88e5' },
] as const;

function drawTrainingInfo(ctx: CanvasRenderingContext2D, effects: Effects, width: number): void {
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#2f6fb8';
  ctx.font = `bold 13px ${FONT}`;
  // Leaves room for the training panel on the right.
  const x = width - 290;
  ctx.fillText('TRAINING ROOM', x, 20);
  ctx.fillStyle = '#333';
  ctx.font = `bold 18px ${FONT}`;
  ctx.fillText(`DPS ${Math.round(effects.dps())}`, x, 38);
  ctx.fillStyle = '#999';
  ctx.font = `12px ${FONT}`;
  ctx.fillText('last 3 s · you cannot die here', x, 60);
  ctx.restore();
}

/** Level-up cards: press 1 / 2 / 3 to spend points. */
function drawUpgradeChoices(ctx: CanvasRenderingContext2D, me: Readonly<Player>, cx: number, top: number): void {
  const cardW = 190;
  const cardH = 58;
  const gap = 12;
  const totalW = cardW * 3 + gap * 2;
  const left = cx - totalW / 2;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#2e9e5b';
  ctx.font = `bold 14px ${FONT}`;
  const points = me.upgradePoints === 1 ? '1 point' : `${me.upgradePoints} points`;
  ctx.fillText(`LEVEL UP · ${points} · press 1 / 2 / 3`, cx, top - 8);

  UPGRADE_STATS.forEach((stat: UpgradeStat, i) => {
    const x = left + i * (cardW + gap);
    const maxed = me.ranks[stat] >= CONFIG.upgrades.maxRank;
    ctx.fillStyle = maxed ? '#f3f3f3' : 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = maxed ? '#ddd' : '#4a90e2';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, top, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = maxed ? '#aaa' : '#2f6fb8';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillText(`${i + 1}  ${UPGRADE_INFO[stat].name}`, x + 12, top + 9);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#999';
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillText(maxed ? 'MAX' : `rank ${me.ranks[stat]}`, x + cardW - 12, top + 10);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#777';
    ctx.font = `11px ${FONT}`;
    const text = stat === 'ability' ? ABILITY_UPGRADE_TEXT[me.ability] : UPGRADE_INFO[stat].description;
    ctx.fillText(text, x + 12, top + 33);
  });
  ctx.restore();
}

function drawSettings(ctx: CanvasRenderingContext2D, view: WorldView, width: number): void {
  const { difficulty, speed } = view.settings;
  ctx.save();
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#888';
  ctx.font = `bold 13px ${FONT}`;
  const prefix = view.mode === 'versus' ? 'AI difficulty' : 'Difficulty';
  ctx.fillText(`${prefix} ${difficulty} · ${difficultyLabel(difficulty)}`, width - 20, 20);
  ctx.font = `13px ${FONT}`;
  ctx.fillText(`Enemy speed x${speed.toFixed(1)}`, width - 20, 38);
  ctx.restore();
}

function drawBossBar(ctx: CanvasRenderingContext2D, view: WorldView, width: number): void {
  let boss: Readonly<Enemy> | undefined;
  for (const e of view.enemies.values()) {
    if (e.boss) {
      boss = e;
      break;
    }
  }
  if (!boss || !isBossKind(boss.kind)) return;

  // On narrow screens the bar goes below the stats block.
  const barW = Math.min(460, width - 40);
  const x = (width - barW) / 2;
  const y = width < 1000 ? 150 : 34;

  ctx.save();
  ctx.fillStyle = '#333';
  ctx.font = `bold 14px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(CONFIG.bosses[boss.kind].name.toUpperCase(), width / 2, y - 4);
  drawBar(ctx, x, y, barW, 14, boss.hp / boss.maxHp, '#8b2635', `${Math.ceil(boss.hp)} / ${boss.maxHp}`);
  ctx.restore();
}

const BANNER_LAYOUT = {
  boss: { y: 0.3, title: 56, subtitle: 22, gap: 44 },
  power: { y: 0.2, title: 34, subtitle: 16, gap: 30 },
  tower: { y: 0.24, title: 40, subtitle: 17, gap: 34 },
  result: { y: 0.4, title: 84, subtitle: 24, gap: 60 },
} as const;

function drawBanners(ctx: CanvasRenderingContext2D, effects: Effects, width: number, height: number): void {
  for (const banner of effects.banners) {
    const t = banner.age / banner.life;
    // Quick fade-in, hold, fade-out.
    const alpha = Math.min(1, t * 6, (1 - t) * 3);
    const layout = BANNER_LAYOUT[banner.kind];
    const y = height * layout.y;
    // Long subtitles must fit on phones too.
    const titleSize = Math.min(layout.title, width / 8);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = banner.color;
    ctx.font = `900 ${titleSize}px ${FONT}`;
    ctx.fillText(banner.title, width / 2, y);
    if (banner.subtitle) {
      ctx.fillStyle = '#555';
      ctx.font = `bold ${layout.subtitle}px ${FONT}`;
      ctx.fillText(banner.subtitle, width / 2, y + layout.gap, width - 40);
    }
    ctx.restore();
  }
}

/** Versus: both nexuses side by side at the top, match clock between them. */
function drawNexusBars(ctx: CanvasRenderingContext2D, me: Readonly<Player>, view: WorldView, width: number): void {
  const nexuses = [...view.nexuses.values()].sort((a, b) => (a.team === 'blue' ? -1 : b.team === 'blue' ? 1 : 0));
  if (nexuses.length === 0) return;
  const narrow = width < 1000;
  const gap = 70;
  const barW = Math.max(110, Math.min(220, (width - 80 - gap) / 2));
  const y = narrow ? 230 : 40;
  const cx = width / 2;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#555';
  ctx.font = `bold 16px ${FONT}`;
  ctx.fillText(formatClock(view.time), cx, y + 7);

  nexuses.forEach((n, i) => {
    const x = i === 0 ? cx - gap / 2 - barW : cx + gap / 2;
    drawNexusBar(ctx, n, me, view, x, y, barW);
  });
  ctx.restore();
}

function drawNexusBar(
  ctx: CanvasRenderingContext2D,
  n: Readonly<Nexus>,
  me: Readonly<Player>,
  view: WorldView,
  x: number, y: number, w: number,
): void {
  const colors = TEAM_COLORS[n.team];
  const h = 14;
  let owner = n.team === me.team ? 'YOUR BASE' : 'ENEMY BASE';
  for (const p of view.players.values()) {
    if (p.team === n.team && p.id !== me.id) owner += ` · ${p.isBot ? 'AI ' : ''}Lv ${p.level}${p.alive ? '' : ' (dead)'}`;
  }

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = colors.dark;
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText(owner, x + w / 2, y - 4, w + 40);

  ctx.fillStyle = '#ececec';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  const ratio = Math.max(0, n.hp / n.maxHp);
  if (ratio > 0) {
    ctx.fillStyle = colors.main;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(h, w * ratio), h, h / 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (const k of [1 / 3, 2 / 3]) {
    ctx.beginPath();
    ctx.moveTo(x + w * k, y);
    ctx.lineTo(x + w * k, y + h);
    ctx.stroke();
  }
  ctx.fillStyle = '#333';
  ctx.font = `bold 10px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(`${Math.ceil(n.hp)} / ${n.maxHp}`, x + w / 2, y + h / 2 + 1);

  // Guardian status under the bar.
  const guardian = n.guardianId !== null ? view.enemies.get(n.guardianId) : undefined;
  ctx.textBaseline = 'top';
  ctx.font = `bold 11px ${FONT}`;
  if (guardian && isBossKind(guardian.kind)) {
    ctx.fillStyle = colors.dark;
    ctx.fillText(`${CONFIG.bosses[guardian.kind].name} guards it · ${Math.ceil(guardian.hp)} HP`, x + w / 2, y + h + 4, w + 40);
  } else {
    let towers = 0;
    for (const t of view.towers.values()) if (t.team === n.team) towers++;
    const total = 3 * Math.max(0, Math.round(view.server.towersPerLane));
    ctx.fillStyle = '#999';
    ctx.fillText(n.hp <= 0 ? 'Destroyed' : `Towers ${towers} / ${total} · Guardians ${n.stage} / 3`, x + w / 2, y + h + 4, w + 40);
  }
  ctx.restore();
}

function drawRespawnOverlay(ctx: CanvasRenderingContext2D, me: Readonly<Player>, width: number, height: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PLAYER_STYLE[me.team].stroke;
  ctx.font = `900 44px ${FONT}`;
  ctx.fillText('YOU DIED', width / 2, height * 0.38);
  ctx.fillStyle = '#444';
  ctx.font = `bold 24px ${FONT}`;
  ctx.fillText(`Respawn in ${Math.ceil(me.respawnTimer)}`, width / 2, height * 0.38 + 52);
  ctx.restore();
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function weaponStatLine(me: Readonly<Player>, server: Readonly<ServerConfig>): string {
  const W = CONFIG.weapons;
  const dmg = weaponDamageMultiplier(me);
  const speed = attackSpeedMultiplier(me);
  const name = WEAPON_INFO[me.weapon].name;
  switch (me.weapon) {
    case 'gun':
      return `${name} · ${Math.round(server.gunDamage * dmg)} dmg · ${(speed / W.gun.cooldown).toFixed(1)}/s`;
    case 'sword':
      return `${name} · ${Math.round(server.swordDamage * dmg)} dmg · ${(speed / W.sword.cooldown).toFixed(1)}/s`;
    case 'beam':
      return `${name} · ${Math.round(server.beamDamagePerSecond * dmg * speed)} dmg/s`;
  }
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  ratio: number, color: string, label: string,
): void {
  ctx.save();
  ctx.fillStyle = '#ececec';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  if (ratio > 0) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, Math.max(h, w * Math.min(1, ratio)), h, h / 2);
    ctx.fill();
  }
  ctx.fillStyle = '#333';
  ctx.font = `bold ${h > 13 ? 11 : 10}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
  ctx.restore();
}

function drawSlots(ctx: CanvasRenderingContext2D, me: Readonly<Player>, server: Readonly<ServerConfig>, cx: number, cy: number): void {
  const A = CONFIG.abilities;

  // LMB weapon.
  drawSlot(ctx, cx - SLOT_SPACING, cy, me.weapon, 'LMB', { enabled: true });

  // RMB ability.
  const unlocked = me.abilityUnlocked;
  const shieldActive = me.ability === 'shield' && me.shieldTimer > 0;
  drawSlot(ctx, cx, cy, me.ability, unlocked ? `RMB · ${ABILITY_INFO[me.ability].name}` : `Lvl ${A.unlockLevel}`, {
    enabled: unlocked,
    active: shieldActive ? me.shieldTimer / (A.shield.duration * abilityScaling(me).power) : undefined,
    cooldown: unlocked && !shieldActive && me.abilityCooldown > 0
      ? { left: me.abilityCooldown, ratio: Math.min(1, me.abilityCooldown / me.abilityCooldownTotal) }
      : undefined,
  });

  // Dash.
  drawSlot(ctx, cx + SLOT_SPACING, cy, 'dash', 'Shift · Dash', {
    enabled: true,
    cooldown: me.dashCooldown > 0 ? { left: me.dashCooldown, ratio: Math.min(1, me.dashCooldown / dashCooldown(me, server)) } : undefined,
  });
}

interface SlotState {
  enabled: boolean;
  /** 0..1 remaining duration of an active effect (shield). */
  active?: number;
  cooldown?: { left: number; ratio: number };
}

function drawSlot(ctx: CanvasRenderingContext2D, cx: number, cy: number, icon: IconName, label: string, state: SlotState): void {
  const r = SLOT_RADIUS;
  const accent = state.enabled ? '#6b5b4b' : '#c8c8c8';

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = state.enabled ? '#ffffff' : '#f0f0f0';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = accent;
  ctx.stroke();

  if (state.cooldown) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + state.cooldown.ratio * Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(state.cooldown.left.toFixed(1), cx, cy);
  } else {
    drawIcon(ctx, icon, cx, cy, 30, state.enabled ? '#4a4a4a' : '#bdbdbd');
  }

  if (state.active !== undefined) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 4, -Math.PI / 2, -Math.PI / 2 + state.active * Math.PI * 2);
    ctx.strokeStyle = '#4a90e2';
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  ctx.fillStyle = '#888';
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(label, cx, cy + r + 7);
  ctx.restore();
}

function drawHint(ctx: CanvasRenderingContext2D, height: number): void {
  ctx.save();
  ctx.fillStyle = '#aaa';
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('WASD move · Shift dash · 1/2/3 upgrade · Esc menu', 20, height - 16);
  ctx.restore();
}
