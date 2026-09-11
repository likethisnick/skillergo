import {
  CONFIG,
  type Enemy,
  type EntityId,
  type Orb,
  type Player,
  type Projectile,
  type TeamId,
  type WorldView,
} from '@skillergo/shared';
import { drawArenaGround, drawNexus, drawTower } from './Arena';
import { Camera } from './Camera';
import type { NetOverlay } from '../session/GameSession';
import type { Effects } from './Effects';
import { drawHud } from './Hud';
import { drawIcon } from './icons';
import { Minimap } from './Minimap';
import { PLAYER_STYLE, TEAM_COLORS, mobStyle, type Style } from './teams';

export const COLORS = {
  outside: '#f2f2f2',
  background: '#ffffff',
  grid: '#f0f0f0',
  border: '#d9d9d9',
  beam: '#5ad1ff',
  sword: '#9aa4ad',
  elite: '#f5b921',
  heal: '#ff5d73',
  dummyStroke: '#8a949e',
  powerDamage: '#ff7a2e',
  powerSpeed: '#29b6f6',
  powerWipe: '#7e57c2',
  enemyFlash: '#ffd6d2',
  orb: '#3cc36b',
  /** XP left by a unit no player finished off (cut down). */
  orbReduced: '#f2c12e',
  hook: '#6b5b4b',
  hpBack: '#e6e6e6',
  hpPlayer: '#3cc36b',
  hpEnemy: '#e5534b',
  text: '#555555',
} as const;

const POWER_STYLE = {
  damage: { color: COLORS.powerDamage, icon: 'sword' },
  speed: { color: COLORS.powerSpeed, icon: 'dash' },
  wipe: { color: COLORS.powerWipe, icon: 'wipe' },
} as const;

const GRID_STEP = 100;

/** Wall colors per tetromino (I, O, T, S, Z, J, L): muted, so they read as scenery. */
const WALL_COLORS = [
  { fill: '#a9d6e8', stroke: '#7fb6cc' },
  { fill: '#f1dc93', stroke: '#d6bd67' },
  { fill: '#cbb6e3', stroke: '#a88fc9' },
  { fill: '#b5d9a4', stroke: '#8fbd7b' },
  { fill: '#f0b1ab', stroke: '#d68a82' },
  { fill: '#adc2ea', stroke: '#8aa2d1' },
  { fill: '#f4c69a', stroke: '#d9a571' },
] as const;

/**
 * Canvas 2D renderer. Reads only WorldView, so it works the same for
 * local and online sessions. Can be swapped for PixiJS later.
 */
export class Renderer {
  readonly camera = new Camera();
  private readonly ctx: CanvasRenderingContext2D;
  private readonly minimap = new Minimap();
  private dpr = 1;
  /** Frame state shared by the draw helpers. */
  private versus = false;
  private myTeam: TeamId = 'blue';
  private net: NetOverlay | undefined;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not supported');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  /** `net` is present in online matches (names, ping, connection state). */
  render(view: WorldView, localPlayerId: EntityId, effects: Effects, net?: NetOverlay): void {
    const { ctx, camera } = this;
    const me = view.players.get(localPlayerId);
    if (me) camera.follow(me.x, me.y);
    this.versus = view.mode === 'versus';
    this.myTeam = me?.team ?? 'blue';
    this.net = net;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, camera.width, camera.height);

    // World space.
    ctx.save();
    ctx.translate(camera.width / 2, camera.height / 2);
    ctx.scale(camera.scale, camera.scale);
    ctx.translate(-camera.x, -camera.y);

    this.drawGround(view);
    this.drawWalls(view);
    for (const nexus of view.nexuses.values()) drawNexus(ctx, nexus, view);
    for (const tower of view.towers.values()) drawTower(ctx, tower, view, me);
    for (const orb of view.orbs.values()) {
      // Drops of our own units are for the enemy: we cannot pick them up, so we do not see them.
      if (orb.denyTeam !== this.myTeam) this.drawOrb(orb, view.time);
    }
    for (const enemy of view.enemies.values()) this.drawEnemyTelegraph(enemy, view.time);
    for (const enemy of view.enemies.values()) this.drawEnemy(enemy, view.time, view.server.guardianAuraRadius);
    for (const player of view.players.values()) this.drawPlayerUnderlay(player, view.time);
    for (const pr of view.projectiles.values()) this.drawProjectile(pr);
    for (const player of view.players.values()) this.drawPlayer(player, view.time);
    this.drawEffects(effects);

    ctx.restore();

    // Screen space.
    if (me) {
      this.drawDamageVignette(me, view.time);
      if (view.arena) {
        const size = camera.width < 700 ? 120 : 190;
        this.minimap.draw(ctx, view, localPlayerId, camera, camera.width - size - 20, 64, size, this.dpr);
      }
      drawHud(ctx, me, view, effects, camera.width, camera.height, net);
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
  }

  private readonly resize = (): void => {
    this.dpr = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.camera.resize(width, height);
  };

  // ------------------------------------------------------------------ ground

  private drawGround(view: WorldView): void {
    const { ctx } = this;
    const { width, height } = view;
    const b = this.camera.bounds();

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);
    if (view.arena) drawArenaGround(ctx, view.arena);

    // Faint grid so movement is visible on a white field.
    const left = Math.max(0, Math.floor(b.left / GRID_STEP) * GRID_STEP);
    const right = Math.min(width, b.right);
    const top = Math.max(0, Math.floor(b.top / GRID_STEP) * GRID_STEP);
    const bottom = Math.min(height, b.bottom);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1 / this.camera.scale;
    ctx.beginPath();
    for (let x = left; x <= right; x += GRID_STEP) {
      ctx.moveTo(x, Math.max(0, b.top));
      ctx.lineTo(x, bottom);
    }
    for (let y = top; y <= bottom; y += GRID_STEP) {
      ctx.moveTo(Math.max(0, b.left), y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();

    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, width, height);
  }

  /** Tetromino walls: only the tiles inside the camera view are drawn. */
  private drawWalls(view: WorldView): void {
    const { ctx } = this;
    const map = view.map;
    const ts = map.tileSize;
    const b = this.camera.bounds();
    const minC = Math.max(0, Math.floor(b.left / ts));
    const maxC = Math.min(map.cols - 1, Math.floor(b.right / ts));
    const minR = Math.max(0, Math.floor(b.top / ts));
    const maxR = Math.min(map.rows - 1, Math.floor(b.bottom / ts));
    const inset = 2;
    ctx.save();
    ctx.lineWidth = 2;
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const type = map.tiles[r * map.cols + c];
        if (type === 0) continue;
        const color = WALL_COLORS[(type - 1) % WALL_COLORS.length];
        const x = c * ts + inset;
        const y = r * ts + inset;
        const size = ts - inset * 2;
        ctx.fillStyle = color.fill;
        ctx.strokeStyle = color.stroke;
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, 8);
        ctx.fill();
        ctx.stroke();
        // Inner bevel for the classic block look.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.roundRect(x + 10, y + 10, size - 20, size - 20, 5);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ----------------------------------------------------------------- players

  /** Things drawn below projectiles: dash trail, shield zone, sword swing, beam, hook. */
  private drawPlayerUnderlay(p: Readonly<Player>, time: number): void {
    if (!p.alive) return;
    const { ctx } = this;

    if (p.dashTimer > 0) {
      for (let i = 3; i >= 1; i--) {
        ctx.globalAlpha = 0.12 * (4 - i);
        this.circle(p.x - p.dashDirX * i * 22, p.y - p.dashDirY * i * 22, p.radius, PLAYER_STYLE[p.team].fill);
      }
      ctx.globalAlpha = 1;
    }

    this.drawBuffAura(p, time);
    if (p.shieldTimer > 0) this.drawShield(p);
    if (p.weapon === 'sword') this.drawSwordSwing(p, time);
    if (p.weapon === 'beam' && p.beam.active) this.drawBeam(p, time);
    this.drawHook(p);
  }

  private drawPlayer(p: Readonly<Player>, time: number): void {
    // In versus a dead player is waiting for a respawn at the base: nothing to draw.
    if (!p.alive && this.versus) return;
    const { ctx } = this;
    const style = PLAYER_STYLE[p.team];
    ctx.save();
    if (!p.alive) ctx.globalAlpha = 0.35;
    else if (p.invulnerableTimer > 0) ctx.globalAlpha = 0.5 + 0.2 * Math.sin(time * 20);

    this.drawWeapon(p, time, style);
    const recentlyHit = time - p.lastDamageTime < 0.12;
    this.circle(p.x, p.y, p.radius, recentlyHit ? '#ffffff' : style.fill, style.stroke, 3);
    ctx.restore();

    if (!p.alive) return;
    // Name tag: the player's name online, "AI" for bots.
    const name = this.net?.names.get(p.id) ?? (p.isBot ? 'AI' : null);
    this.drawPlayerPlate(p, style, name);
  }

  /**
   * Player health plate: a framed capsule in the team color with a level badge on the left,
   * a tick every 100 HP and the HP number inside.
   */
  private drawPlayerPlate(p: Readonly<Player>, style: Style, name: string | null): void {
    const { ctx } = this;
    const barW = 64;
    const barH = 12;
    const badgeR = 12;
    const overlap = 7;
    const left = p.x - (badgeR * 2 + barW - overlap) / 2;
    const barX = left + badgeR * 2 - overlap;
    const barY = p.y - p.radius - 24;
    const cy = barY + barH / 2;
    const ratio = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const hpColor = p.team === this.myTeam ? COLORS.hpPlayer : COLORS.hpEnemy;

    ctx.save();
    // Frame.
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(barX - 3, barY - 3, barW + 6, barH + 6, (barH + 6) / 2);
    ctx.fill();
    ctx.stroke();

    // Track, health and a glossy top half.
    ctx.beginPath();
    ctx.roundRect(barX, barY, barW, barH, barH / 2);
    ctx.fillStyle = '#e8ecf0';
    ctx.fill();
    if (ratio > 0) {
      const w = Math.max(barH, barW * ratio);
      ctx.fillStyle = hpColor;
      ctx.beginPath();
      ctx.roundRect(barX, barY, w, barH, barH / 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.beginPath();
      ctx.roundRect(barX + 2, barY + 1.5, Math.max(0, w - 4), barH / 2 - 1.5, 3);
      ctx.fill();
    }
    // A thin notch every 100 HP shows how tanky someone is at a glance.
    const notches = Math.floor((p.maxHp - 1) / 100);
    if (notches > 0 && notches <= 15) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 1; i <= notches; i++) {
        const nx = barX + (barW * i * 100) / p.maxHp;
        ctx.moveTo(nx, barY + 2);
        ctx.lineTo(nx, barY + barH - 2);
      }
      ctx.stroke();
    }
    // HP number inside the bar.
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    const hpText = `${Math.ceil(p.hp)}`;
    ctx.strokeText(hpText, barX + barW / 2 + 4, cy + 0.5);
    ctx.fillStyle = '#2b2f33';
    ctx.fillText(hpText, barX + barW / 2 + 4, cy + 0.5);

    // Level badge.
    const bx = left + badgeR;
    ctx.beginPath();
    ctx.arc(bx, cy, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = style.stroke;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${p.level >= 10 ? 11 : 13}px system-ui, sans-serif`;
    ctx.fillText(`${p.level}`, bx, cy + 0.5);

    if (name) {
      ctx.fillStyle = style.stroke;
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(name, p.x, barY - 7);
    }
    ctx.restore();
  }

  private drawWeapon(p: Readonly<Player>, time: number, style: Style): void {
    const { ctx } = this;
    ctx.save();
    ctx.translate(p.x, p.y);

    switch (p.weapon) {
      case 'gun':
        ctx.rotate(p.aim);
        ctx.fillStyle = style.stroke;
        ctx.beginPath();
        ctx.roundRect(0, -6, p.radius + 14, 12, 4);
        ctx.fill();
        break;
      case 'beam':
        ctx.rotate(p.aim);
        ctx.fillStyle = style.stroke;
        ctx.beginPath();
        ctx.roundRect(0, -8, p.radius + 8, 16, 6);
        ctx.fill();
        ctx.fillStyle = COLORS.beam;
        ctx.beginPath();
        ctx.arc(p.radius + 8, 0, 5, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'sword': {
        // Resting blade next to the body; hidden while the swing arc is drawn.
        if (time - p.lastAttackTime < CONFIG.weapons.sword.swingTime) break;
        ctx.rotate(p.aim + 0.9);
        ctx.strokeStyle = COLORS.sword;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.radius - 4, 0);
        ctx.lineTo(CONFIG.weapons.sword.range - 20, 0);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  /** Glow around a buffed player: orange for damage / attack speed, blue for speed. */
  private drawBuffAura(p: Readonly<Player>, time: number): void {
    const { ctx } = this;
    const auras: string[] = [];
    if (p.buffs.damage > 0 || p.buffs.attackSpeed > 0) auras.push(COLORS.powerDamage);
    if (p.buffs.speed > 0) auras.push(COLORS.powerSpeed);
    auras.forEach((color, i) => {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.25 * Math.sin(time * 10 + i);
      ctx.strokeStyle = color;
      ctx.lineWidth = 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius + 8 + i * 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    });
  }

  private drawSwordSwing(p: Readonly<Player>, time: number): void {
    const C = CONFIG.weapons.sword;
    const t = (time - p.lastAttackTime) / C.swingTime;
    if (t < 0 || t >= 1) return;
    const { ctx } = this;
    const start = p.lastAttackAngle - C.arc / 2;
    const current = start + C.arc * Math.min(1, t * 1.2);

    // Swept area.
    ctx.save();
    ctx.globalAlpha = 0.35 * (1 - t);
    ctx.fillStyle = COLORS.sword;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, C.range, start, current);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Blade.
    ctx.save();
    ctx.strokeStyle = '#6f7a84';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(current) * (p.radius - 4), p.y + Math.sin(current) * (p.radius - 4));
    ctx.lineTo(p.x + Math.cos(current) * C.range, p.y + Math.sin(current) * C.range);
    ctx.stroke();
    ctx.restore();
  }

  private drawBeam(p: Readonly<Player>, time: number): void {
    const { ctx } = this;
    const startX = p.x + Math.cos(p.aim) * (p.radius + 8);
    const startY = p.y + Math.sin(p.aim) * (p.radius + 8);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(90, 209, 255, 0.25)';
    ctx.lineWidth = 12 + Math.sin(time * 40) * 2;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(p.beam.endX, p.beam.endY);
    ctx.stroke();
    ctx.strokeStyle = COLORS.beam;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (p.beam.targetId !== null) {
      ctx.fillStyle = 'rgba(90, 209, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(p.beam.endX, p.beam.endY, 8 + Math.sin(time * 30) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawShield(p: Readonly<Player>): void {
    const C = CONFIG.abilities.shield;
    const { ctx } = this;
    const r = p.radius + C.offset;
    const from = p.aim - p.shieldArc / 2;
    const to = p.aim + p.shieldArc / 2;
    // Blink during the last half second so the player knows it is ending.
    const ending = p.shieldTimer < 0.5 && Math.floor(p.shieldTimer * 12) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = ending ? 0.4 : 1;
    const color = PLAYER_STYLE[p.team].fill;
    ctx.fillStyle = color;
    ctx.globalAlpha *= 0.25;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.arc(p.x, p.y, r + 14, from, to);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = ending ? 0.4 : 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, from, to);
    ctx.stroke();
    ctx.restore();
  }

  private drawHook(p: Readonly<Player>): void {
    const h = p.hook;
    if (h.state === 'idle') return;
    const { ctx } = this;
    ctx.strokeStyle = COLORS.hook;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();

    if (h.state !== 'pulling') {
      // Arrow-like head pointing along the throw direction.
      const r = CONFIG.abilities.hook.radius;
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(Math.atan2(h.dirY, h.dirX));
      ctx.fillStyle = COLORS.hook;
      ctx.beginPath();
      ctx.moveTo(r * 1.4, 0);
      ctx.lineTo(-r, -r);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r, r);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ----------------------------------------------------------------- enemies

  /** Warnings drawn under enemies: laser sights, the Blademaster's swing zone. */
  private drawEnemyTelegraph(e: Readonly<Enemy>, time: number): void {
    const { ctx } = this;

    if ((e.kind === 'sniper' || e.kind === 'duelist') && e.windup > 0) {
      const windup = e.kind === 'sniper' ? CONFIG.enemies.sniper.attack.windup : CONFIG.bosses.duelist.attack.windup;
      const progress = 1 - e.windup / windup;
      // Snipers and the Duelist shoot through walls, so the sight goes through them too.
      const reach = e.kind === 'sniper' ? CONFIG.enemies.sniper.attack.projectileRange : 1400;
      ctx.save();
      ctx.strokeStyle = mobStyle(e.kind, e.team).fill;
      ctx.globalAlpha = 0.15 + 0.55 * progress;
      ctx.lineWidth = 1.5 + progress * 1.5;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + Math.cos(e.aim) * reach, e.y + Math.sin(e.aim) * reach);
      ctx.stroke();
      ctx.restore();
    }

    if (e.kind === 'blademaster') {
      const C = CONFIG.bosses.blademaster;
      if (e.windup > 0) {
        // Danger zone fills up while the swing is being prepared.
        const progress = 1 - e.windup / C.windup;
        ctx.save();
        ctx.fillStyle = `rgba(229, 83, 75, ${0.1 + 0.3 * progress})`;
        ctx.strokeStyle = 'rgba(229, 83, 75, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, C.swingRange, e.aim - C.swingArc / 2, e.aim + C.swingArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      const since = time - e.lastAttackTime;
      if (since >= 0 && since < 0.18) {
        const t = since / 0.18;
        ctx.save();
        ctx.globalAlpha = 0.45 * (1 - t);
        ctx.fillStyle = COLORS.sword;
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.arc(e.x, e.y, C.swingRange, e.aim - C.swingArc / 2, e.aim + C.swingArc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  private drawEnemy(e: Readonly<Enemy>, time: number, auraRadius: number): void {
    const { ctx } = this;
    const style = mobStyle(e.kind, e.team);
    if (e.role === 'guardian' && auraRadius > 0) this.drawGuardianAura(e, time, auraRadius);
    const t = Math.min(1, e.age / CONFIG.enemies.spawnFadeIn);
    const r = e.radius * (0.6 + 0.4 * t);

    ctx.save();
    ctx.globalAlpha = t;

    // Duelist side-dash afterimages.
    if (e.kind === 'duelist' && e.burstTimer > 0) {
      for (let i = 1; i <= 3; i++) {
        ctx.globalAlpha = 0.12 * (4 - i);
        this.circle(e.x - e.vx * 0.02 * i, e.y - e.vy * 0.02 * i, r, style.fill);
      }
      ctx.globalAlpha = t;
    }

    this.drawEnemyWeapon(e, r, time);
    this.circle(e.x, e.y, r, e.hitFlash > 0 ? COLORS.enemyFlash : style.fill, style.stroke, e.boss ? 5 : 3);
    if (e.kind === 'dummy') {
      // Bullseye target.
      this.circle(e.x, e.y, r * 0.66, 'transparent', COLORS.dummyStroke, 3);
      this.circle(e.x, e.y, r * 0.3, COLORS.hpEnemy);
    }
    if (e.kind === 'farmer') this.drawFarmerHat(e.x, e.y, r);
    if (e.elite) this.circle(e.x, e.y, r + 6, 'transparent', COLORS.elite, 3);
    if (e.boss) this.circle(e.x, e.y, r * 0.55, 'transparent', 'rgba(255, 255, 255, 0.35)', 3);
    if (this.versus && (e.boss || e.kind === 'farmer')) {
      // Bosses and farmers look the same on both sides: a team ring tells them apart.
      ctx.save();
      if (e.role === 'guardian') {
        ctx.setLineDash([14, 9]);
        ctx.lineDashOffset = -time * 30;
      }
      this.circle(e.x, e.y, r + (e.boss ? 12 : 5), 'transparent', TEAM_COLORS[e.team].main, e.boss ? 5 : 3);
      ctx.restore();
    }
    if (e.pulledBy !== null) this.circle(e.x, e.y, r + 5, 'transparent', COLORS.hook, 2);
    ctx.restore();

    // In survival bosses show their HP in the big bar at the top of the screen instead.
    if (!e.boss || this.versus) {
      const barW = e.boss ? 140 : Math.max(40, e.radius * 2 + 8);
      const allied = this.versus && e.team === this.myTeam;
      const color = e.elite ? COLORS.elite : allied ? TEAM_COLORS[e.team].main : COLORS.hpEnemy;
      this.drawHpBar(e.x, e.y - e.radius - (e.boss ? 26 : 16), barW, e.hp / e.maxHp, color, Math.ceil(e.hp));
    }
  }

  /** The burning zone around a guardian: mobs that step in melt. */
  private drawGuardianAura(e: Readonly<Enemy>, time: number, radius: number): void {
    const { ctx } = this;
    const color = TEAM_COLORS[e.team];
    ctx.save();
    ctx.fillStyle = color.tint;
    ctx.beginPath();
    ctx.arc(e.x, e.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(time * 5);
    ctx.strokeStyle = color.main;
    ctx.lineWidth = 4;
    ctx.setLineDash([10, 14]);
    ctx.lineDashOffset = time * 40;
    ctx.stroke();
    ctx.restore();
  }

  /** Farmers wear a straw hat so they read as harmless at a glance. */
  private drawFarmerHat(x: number, y: number, r: number): void {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#c9962f';
    ctx.strokeStyle = '#8e6a1f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.35, r * 1.05, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8c36b';
    ctx.beginPath();
    ctx.ellipse(x, y - r * 0.55, r * 0.55, r * 0.42, 0, Math.PI, 0);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Kind-specific silhouette details: barrels, spikes, blades. */
  private drawEnemyWeapon(e: Readonly<Enemy>, r: number, time: number): void {
    const { ctx } = this;
    const style = mobStyle(e.kind, e.team);
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.aim);
    ctx.fillStyle = style.stroke;

    switch (e.kind) {
      case 'grunt':
        ctx.beginPath();
        ctx.roundRect(0, -5, r + 10, 10, 3);
        ctx.fill();
        if (e.windup > 0) {
          ctx.fillStyle = '#ffb199';
          ctx.beginPath();
          ctx.arc(r + 12, 0, 3 + 4 * (1 - e.windup / CONFIG.enemies.grunt.attack.windup), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'sniper':
        ctx.fillRect(0, -2.5, r + 24, 5);
        break;
      case 'rusher':
        ctx.beginPath();
        ctx.moveTo(r + 12, 0);
        ctx.lineTo(Math.cos(0.7) * r, Math.sin(0.7) * r);
        ctx.lineTo(Math.cos(-0.7) * r, Math.sin(-0.7) * r);
        ctx.closePath();
        ctx.fill();
        break;
      case 'colossus': {
        ctx.beginPath();
        ctx.roundRect(0, -20, r + 34, 40, 8);
        ctx.fill();
        if (e.windup > 0) {
          // Charging the giant shot.
          const A = CONFIG.bosses.colossus.attack;
          const progress = 1 - e.windup / A.windup;
          ctx.fillStyle = 'rgba(139, 38, 53, 0.45)';
          ctx.beginPath();
          ctx.arc(r + 40, 0, 12 + 50 * progress, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'duelist':
        ctx.fillRect(0, -3, r + 28, 6);
        break;
      case 'dummy':
      case 'farmer':
        break;
      case 'blademaster': {
        const since = time - e.lastAttackTime;
        const swinging = since >= 0 && since < 0.18;
        const C = CONFIG.bosses.blademaster;
        // Blade rests at the side, is raised during windup, sweeps during the swing.
        const angle = swinging
          ? -C.swingArc / 2 + C.swingArc * Math.min(1, since / 0.12)
          : e.windup > 0 ? -C.swingArc / 2 - 0.3 : 1.1;
        ctx.rotate(angle);
        ctx.strokeStyle = '#8a949e';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(r - 4, 0);
        ctx.lineTo(C.swingRange - 10, 0);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------ projectiles & orbs

  private drawProjectile(pr: Readonly<Projectile>): void {
    const { ctx } = this;
    const color = pr.source === 'player' ? PLAYER_STYLE[pr.team].stroke : mobStyle(pr.source, pr.team).fill;
    if (pr.radius > 40) {
      // Giant Colossus shot: translucent body with a solid rim.
      ctx.save();
      ctx.globalAlpha = 0.28;
      this.circle(pr.x, pr.y, pr.radius, color);
      ctx.globalAlpha = 0.9;
      this.circle(pr.x, pr.y, pr.radius, 'transparent', color, 6);
      ctx.restore();
      return;
    }
    // Short trail helps reading direction and speed of fast bullets.
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = pr.radius * 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pr.x - pr.vx * 0.035, pr.y - pr.vy * 0.035);
    ctx.lineTo(pr.x, pr.y);
    ctx.stroke();
    ctx.restore();
    this.circle(pr.x, pr.y, pr.radius, color);
  }

  private drawOrb(orb: Readonly<Orb>, time: number): void {
    const { ctx } = this;
    const pulse = 1 + 0.12 * Math.sin(time * 6 + orb.id);
    ctx.save();
    // Blink during the last seconds before the orb disappears.
    if (orb.life < 5 && Math.floor(orb.life * 6) % 2 === 0) ctx.globalAlpha = 0.3;

    if (orb.kind === 'power' && orb.power) {
      const style = POWER_STYLE[orb.power];
      const r = orb.radius * pulse;
      ctx.shadowColor = style.color;
      ctx.shadowBlur = 20;
      this.circle(orb.x, orb.y, r, style.color);
      ctx.shadowBlur = 0;
      // Rotating dashed ring makes power-ups stand out from XP and heals.
      ctx.save();
      ctx.translate(orb.x, orb.y);
      ctx.rotate(time * 2);
      ctx.setLineDash([6, 5]);
      this.circle(0, 0, r + 7, 'transparent', style.color, 2);
      ctx.restore();
      drawIcon(ctx, style.icon, orb.x, orb.y, r * 1.6, '#ffffff');
    } else if (orb.kind === 'heal') {
      const r = orb.radius * pulse;
      ctx.shadowColor = COLORS.heal;
      ctx.shadowBlur = 14;
      this.circle(orb.x, orb.y, r, COLORS.heal);
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      const arm = r * 0.55;
      const thick = r * 0.28;
      ctx.fillRect(orb.x - arm, orb.y - thick / 2, arm * 2, thick);
      ctx.fillRect(orb.x - thick / 2, orb.y - arm, thick, arm * 2);
    } else {
      // Bigger XP (elites, bosses) means a bigger orb.
      const size = orb.xp >= 300 ? 2.2 : orb.xp >= 50 ? 1.6 : orb.xp > 10 ? 1.25 : 1;
      const color = orb.reduced ? COLORS.orbReduced : COLORS.orb;
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      this.circle(orb.x, orb.y, orb.radius * pulse * size, color);
    }
    ctx.restore();
  }

  // ----------------------------------------------------------------- effects

  private drawEffects(effects: Effects): void {
    const { ctx } = this;

    // Tower shots: a short bright line from the turret to the target.
    for (const b of effects.beams) {
      const k = 1 - b.age / b.life;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = k;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 10 * k + 2;
      ctx.globalAlpha = 0.3 * k;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.targetX, b.targetY);
      ctx.stroke();
      ctx.globalAlpha = k;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    for (const cone of effects.cones) {
      const k = 1 - cone.age / cone.life;
      const C = { range: cone.range, arc: cone.arc };
      ctx.save();
      ctx.globalAlpha = 0.35 * k;
      ctx.fillStyle = '#ffcc55';
      ctx.beginPath();
      ctx.moveTo(cone.x, cone.y);
      ctx.arc(cone.x, cone.y, C.range, cone.angle - C.arc / 2, cone.angle + C.arc / 2);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#e59a1a';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const pellet of cone.pellets) {
        const len = pellet.length * Math.min(1, cone.age / cone.life * 3);
        ctx.beginPath();
        ctx.moveTo(cone.x + Math.cos(pellet.angle) * len * 0.7, cone.y + Math.sin(pellet.angle) * len * 0.7);
        ctx.lineTo(cone.x + Math.cos(pellet.angle) * len, cone.y + Math.sin(pellet.angle) * len);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const ring of effects.rings) {
      const k = ring.age / ring.life;
      const radius = 8 + (ring.radius - 8) * Math.sqrt(k);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.radius > 100 ? 10 : 3;
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      if (ring.radius > 100) {
        // Wipe shockwave: faint fill behind the edge.
        ctx.globalAlpha = 0.12 * (1 - k);
        ctx.fillStyle = ring.color;
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of effects.texts) {
      ctx.globalAlpha = 1 - t.age / t.life;
      ctx.fillStyle = t.color;
      ctx.font = `bold ${t.size}px system-ui, sans-serif`;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }

  /** Red screen edges right after the local player takes damage. */
  private drawDamageVignette(me: Readonly<Player>, time: number): void {
    const since = time - me.lastDamageTime;
    if (since > 0.35) return;
    const { ctx, camera } = this;
    const k = 1 - since / 0.35;
    const gradient = ctx.createRadialGradient(
      camera.width / 2, camera.height / 2, Math.min(camera.width, camera.height) * 0.35,
      camera.width / 2, camera.height / 2, Math.max(camera.width, camera.height) * 0.75,
    );
    gradient.addColorStop(0, 'rgba(229, 83, 75, 0)');
    gradient.addColorStop(1, `rgba(229, 83, 75, ${0.35 * k})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, camera.width, camera.height);
  }

  // ----------------------------------------------------------------- helpers

  private drawHpBar(cx: number, y: number, width: number, ratio: number, color: string, value: number): void {
    const { ctx } = this;
    const h = 7;
    const x = cx - width / 2;
    ctx.save();
    ctx.fillStyle = COLORS.hpBack;
    ctx.beginPath();
    ctx.roundRect(x, y, width, h, 3);
    ctx.fill();
    if (ratio > 0) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, width * Math.min(1, ratio), h, 3);
      ctx.fill();
    }
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${value}`, cx, y - 3);
    ctx.restore();
  }

  private circle(x: number, y: number, r: number, fill: string, stroke?: string, lineWidth = 2): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }
}
