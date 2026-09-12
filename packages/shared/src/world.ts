import { createArenaLayout, isKeptClear, type ArenaLayout } from './arena';
import { classInfo } from './classes';
import { BotBrain } from './ai/bot';
import { CONFIG } from './config';
import {
  DEFAULT_SETTINGS,
  getModifiers,
  levelProgress,
  normalizeSettings,
  rampIntensity,
  type DifficultyModifiers,
} from './difficulty';
import { GameMap, type FlowField } from './map';
import { Rng } from './math/rng';
import { distanceSq } from './math/vec2';
import { xpToNextLevel } from './progression';
import { resolveServerConfig, type ServerConfig } from './server.config';
import { shieldCovers, updateAbilities } from './systems/abilities';
import { setupArena, updateArena } from './systems/arena';
import { pickWanderDirection, separateEnemies, updateEnemies } from './systems/enemies';
import { releaseHook } from './systems/hook';
import { updateOrbs } from './systems/orbs';
import { updatePlayers } from './systems/players';
import { updateProjectiles } from './systems/projectiles';
import { updateSpawner } from './systems/spawner';
import { updateTowers } from './systems/towers';
import {
  BOSS_KINDS,
  DEFAULT_LOADOUT,
  EMPTY_INPUT,
  POWER_UP_KINDS,
  isBossKind,
  otherTeam,
  type BossKind,
  type Enemy,
  type EnemyKind,
  type EnemyRole,
  type EntityId,
  type GameEvent,
  type GameMode,
  type GameSettings,
  type Loadout,
  type Nexus,
  type Orb,
  type OrbKind,
  type Player,
  type PlayerInput,
  type PowerUpKind,
  type Projectile,
  type ProjectileSource,
  type TeamId,
  type Tower,
  type UpgradeStat,
  type WorldView,
} from './types';
import type { LaneId } from './arena';

/** What happened to an attempt to damage a player. */
export type DamageResult = 'hit' | 'blocked' | 'ignored';

export interface WorldOptions {
  settings?: Partial<GameSettings>;
  mode?: GameMode;
  /** Overrides for the values in game.config.json (a server would load them from a file). */
  server?: Partial<ServerConfig>;
  seed?: number;
}

export interface PlayerOptions {
  team?: TeamId;
  /** Controlled by the built-in AI (versus opponent). */
  bot?: boolean;
  x?: number;
  y?: number;
}

export interface EnemyOptions {
  team?: TeamId;
  role?: EnemyRole;
  lane?: LaneId | null;
  homeX?: number;
  homeY?: number;
  escortId?: EntityId | null;
}

export interface ProjectileSpec {
  ownerId: EntityId;
  team: TeamId;
  source: ProjectileSource;
  x: number;
  y: number;
  angle: number;
  speed: number;
  radius: number;
  damage: number;
  range: number;
  /** Boss attacks and sniper shots fly through walls. */
  ignoresWalls?: boolean;
  /** Sniper shots also fly through buildings, except `aimedAt`. */
  piercesBuildings?: boolean;
  aimedAt?: EntityId | null;
  /** Fireball: area damage where the shot stops. */
  blastRadius?: number;
  blastDamage?: number;
}

/**
 * Authoritative game simulation. Pure logic: no DOM, no timers, no rendering.
 * Survival / training / versus all run here; the client only sends inputs and draws.
 */
export class World implements WorldView {
  time = 0;
  tick = 0;
  spawnTimer = 1;
  /** Regular kills since the last boss died (survival). */
  killsSinceBoss = 0;
  bossIndex = 0;
  /** Training room: when false, enemies stand still and do not attack. */
  enemyAI = true;
  winner: TeamId | null = null;
  /** Versus: seconds until the next wave. */
  waveTimer = 0;
  /** Versus: farmers waiting to come back. */
  readonly farmerRespawns: { team: TeamId; at: number }[] = [];

  readonly settings: GameSettings;
  readonly server: ServerConfig;
  readonly mode: GameMode;
  readonly width: number;
  readonly height: number;
  readonly map: GameMap;
  readonly arena: ArenaLayout | null;
  mods: DifficultyModifiers;

  readonly players = new Map<EntityId, Player>();
  readonly enemies = new Map<EntityId, Enemy>();
  readonly projectiles = new Map<EntityId, Projectile>();
  readonly orbs = new Map<EntityId, Orb>();
  readonly nexuses = new Map<EntityId, Nexus>();
  readonly towers = new Map<EntityId, Tower>();
  /** AI brains of bot players, by player id. */
  readonly bots = new Map<EntityId, BotBrain>();
  readonly rng: Rng;

  private nextId = 1;
  private events: GameEvent[] = [];
  /** Path maps towards target tiles, shared by all enemies (rebuilt when stale). */
  private readonly flowFields = new Map<number, { field: FlowField; builtAt: number }>();

  constructor(options: WorldOptions = {}) {
    this.settings = normalizeSettings({ ...DEFAULT_SETTINGS, ...options.settings });
    this.server = resolveServerConfig(options.server);
    this.mode = options.mode ?? 'normal';
    this.mods = getModifiers(this.settings, 0);
    this.rng = new Rng(options.seed ?? (Math.random() * 2 ** 32) >>> 0);

    if (this.mode === 'versus') {
      const A = CONFIG.arena;
      this.arena = createArenaLayout(A);
      this.width = A.size;
      this.height = A.size;
    } else {
      this.arena = null;
      this.width = CONFIG.world.width;
      this.height = CONFIG.world.height;
    }

    this.map = new GameMap(this.width, this.height, CONFIG.map.tileSize);
    const arena = this.arena;
    const start = arena ? arena.spawn.blue : { x: this.width / 2, y: this.height / 2 };
    const clear = CONFIG.map.clearRadius;
    this.map.generate(this.rng, {
      density: this.server.obstacleDensity,
      startX: start.x,
      startY: start.y,
      keepClear: arena
        ? (x, y) => isKeptClear(arena, x, y)
        : (x, y) => (x - start.x) ** 2 + (y - start.y) ** 2 < clear * clear,
    });

    if (this.arena) setupArena(this);
  }

  get intensity(): number {
    return this.mods.intensity;
  }

  /** What a standard player sees. Versus is played on a far bigger map, so the camera pulls back. */
  get view(): { width: number; height: number } {
    const scale = this.isVersus ? CONFIG.versusViewScale : 1;
    return { width: CONFIG.view.width * scale, height: CONFIG.view.height * scale };
  }

  get isTraining(): boolean {
    return this.mode === 'training';
  }

  get isVersus(): boolean {
    return this.mode === 'versus';
  }

  xpToNext(level: number): number {
    if (this.isVersus) return this.server.versusLevelXp + this.server.versusLevelXpStep * (level - 1);
    return xpToNextLevel(level);
  }

  // ---------------------------------------------------------------- lifecycle

  step(dt: number = 1 / CONFIG.tickRate): void {
    if (this.winner) {
      // The match is over: keep time running for effects, but freeze gameplay.
      this.time += dt;
      this.tick++;
      return;
    }
    this.updateDifficulty();
    for (const [id, brain] of this.bots) {
      const p = this.players.get(id);
      if (p) this.setInput(id, brain.update(this, p, dt));
    }
    updatePlayers(this, dt); // upgrades, buffs, movement, dash, regen, weapon, ability, respawn
    updateAbilities(this, dt); // hook flight / pull, shield timer
    updateEnemies(this, dt); // AI, enemy shots, contact damage
    separateEnemies(this); // keep crowds from stacking into one blob
    if (this.isVersus) updateTowers(this, dt); // lane towers shoot mobs and intruders
    updateProjectiles(this, dt);
    updateOrbs(this, dt);
    if (this.isVersus) updateArena(this, dt);
    else updateSpawner(this, dt);
    this.time += dt;
    this.tick++;
  }

  /** Returns events produced since the last call and clears the queue. */
  drainEvents(): GameEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Survival ramp follows the most advanced alive player. Versus and training stay at the baseline. */
  private updateDifficulty(): void {
    let progress = 0;
    for (const p of this.players.values()) if (p.alive) progress = Math.max(progress, levelProgress(p));
    const flat = this.isTraining || this.isVersus;
    const intensity = flat ? 0 : rampIntensity(progress, this.time, this.server.difficultyGrowthRate);
    if (intensity !== this.mods.intensity) this.mods = getModifiers(this.settings, intensity);
  }

  // ------------------------------------------------------------------ players

  addPlayer(loadout: Loadout = DEFAULT_LOADOUT, options: PlayerOptions = {}): Player {
    const team = options.team ?? 'blue';
    const klass = classInfo(loadout.classId);
    const spawn = this.spawnPointOf(team);
    const x = options.x ?? spawn.x;
    const y = options.y ?? spawn.y;
    const H = CONFIG.abilities.hook;
    const player: Player = {
      id: this.newId(),
      team,
      isBot: options.bot ?? false,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: CONFIG.player.radius,
      aim: 0,
      kills: 0,
      deaths: 0,
      hp: CONFIG.player.maxHp,
      maxHp: CONFIG.player.maxHp,
      alive: true,
      lastDamageTime: -Infinity,
      lastHitBy: null,
      respawnTimer: 0,
      intrusionTime: 0,
      reinforcementTimer: 0,
      level: CONFIG.progression.startLevel,
      xp: 0,
      upgradePoints: 0,
      ranks: { weapon: 0, mobility: 0, ability: 0 },
      upgradeLog: [],
      killStats: { regular: 0, elite: 0, boss: 0, players: 0, towers: 0, byKind: {} },
      upgradeRequests: { weapon: 0, mobility: 0, ability: 0 },
      buffs: { damage: 0, attackSpeed: 0, speed: 0 },
      classId: klass.id,
      weapon: klass.weapon,
      ability: klass.ability,
      viewScale: klass.viewScale,
      attackCooldown: 0,
      lastAttackTime: -Infinity,
      lastAttackAngle: 0,
      beam: { active: false, endX: x, endY: y, targetId: null, pendingDamage: 0, reportTimer: 0 },
      abilityUnlocked: this.isTraining || CONFIG.progression.startLevel >= CONFIG.abilities.unlockLevel,
      abilityCooldown: 0,
      abilityCooldownTotal: 1,
      shieldTimer: 0,
      shieldArc: CONFIG.abilities.shield.arc,
      cloakTimer: 0,
      rallyX: x,
      rallyY: y,
      whirlTimer: 0,
      hook: {
        state: 'idle', x, y, dirX: 0, dirY: 0, traveled: 0, targetId: null,
        range: H.range, speed: H.speed, pullSpeed: H.pullSpeed, damage: 0, pullTime: 0,
      },
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: 0,
      dashDirY: 0,
      lastDashSeq: 0,
      invulnerableTimer: 0,
      input: { ...EMPTY_INPUT },
      prevAbilityHeld: false,
    };
    this.players.set(player.id, player);
    if (player.isBot) this.bots.set(player.id, new BotBrain(this, player));
    return player;
  }

  spawnPointOf(team: TeamId): { x: number; y: number } {
    if (this.arena) return this.arena.spawn[team];
    return { x: this.width / 2, y: this.height / 2 };
  }

  removePlayer(id: EntityId): void {
    const player = this.players.get(id);
    if (!player) return;
    releaseHook(this, player);
    this.players.delete(id);
    this.bots.delete(id);
  }

  setInput(playerId: EntityId, input: PlayerInput): void {
    const player = this.players.get(playerId);
    if (player) player.input = { ...input, upgrades: { ...input.upgrades } };
  }

  grantXp(player: Player, amount: number): void {
    player.xp += amount;
    let needed = this.xpToNext(player.level);
    while (player.xp >= needed) {
      player.xp -= needed;
      player.level++;
      player.upgradePoints += CONFIG.upgrades.pointsPerLevel;
      // Tougher every level: +30% of the starting HP, and that much is healed right away.
      const bonus = CONFIG.player.maxHp * CONFIG.progression.hpPerLevel;
      player.maxHp += bonus;
      if (player.alive) player.hp = Math.min(player.maxHp, player.hp + bonus);
      if (player.level >= CONFIG.abilities.unlockLevel) player.abilityUnlocked = true;
      this.emit({ type: 'levelUp', playerId: player.id, level: player.level });
      needed = this.xpToNext(player.level);
    }
  }

  /** Exactly one level up, keeping the progress towards the next one (tower reward). */
  grantLevel(player: Player): void {
    this.grantXp(player, this.xpToNext(player.level));
  }

  /** Spends a point on an upgrade track. Free in the training room. */
  upgrade(player: Player, stat: UpgradeStat): boolean {
    const free = this.isTraining;
    if (player.ranks[stat] >= CONFIG.upgrades.maxRank || (!free && player.upgradePoints <= 0)) return false;
    if (!free) player.upgradePoints--;
    player.ranks[stat]++;
    player.upgradeLog.push({ stat, rank: player.ranks[stat], level: player.level, time: Math.round(this.time * 10) / 10 });
    this.emit({ type: 'upgrade', playerId: player.id, stat, rank: player.ranks[stat] });
    return true;
  }

  /** Nearest alive player, optionally within `maxDistance` and not of `exceptTeam`. */
  nearestPlayer(
    x: number, y: number, maxDistance = Infinity,
    exceptTeam: TeamId | null = null, visibleOnly = false,
  ): Player | undefined {
    let best: Player | undefined;
    let bestSq = maxDistance * maxDistance;
    for (const p of this.players.values()) {
      if (!p.alive || p.team === exceptTeam) continue;
      if (visibleOnly && p.cloakTimer > 0) continue;
      const d = distanceSq(x, y, p.x, p.y);
      if (d <= bestSq) {
        best = p;
        bestSq = d;
      }
    }
    return best;
  }

  /**
   * Direction to walk from (x, y) towards (tx, ty) around walls, or null when already there.
   * Path maps are cached per target tile and rebuilt when stale.
   */
  pathStepTo(tx: number, ty: number, x: number, y: number): { x: number; y: number } | null {
    const tile = this.map.tileIndexAt(tx, ty);
    let entry = this.flowFields.get(tile);
    if (!entry || this.time - entry.builtAt >= CONFIG.map.flowFieldRefresh * 5) {
      entry = { field: this.map.buildFlowField(tx, ty), builtAt: this.time };
      this.flowFields.set(tile, entry);
      if (this.flowFields.size > 256) {
        // Forget the oldest maps; targets move, and memory should stay small.
        for (const [key, value] of this.flowFields) {
          if (this.time - value.builtAt > 2) this.flowFields.delete(key);
        }
      }
    }
    return this.map.nextStep(entry.field, x, y);
  }

  /** Pushes a circle out of walls and buildings. */
  resolveObstacles(x: number, y: number, radius: number): { x: number; y: number } {
    const resolved = this.map.resolveCircle(x, y, radius);
    const push = (b: { x: number; y: number; radius: number }): void => {
      const dx = resolved.x - b.x;
      const dy = resolved.y - b.y;
      const min = b.radius + radius;
      const distSq = dx * dx + dy * dy;
      if (distSq < min * min) {
        const d = Math.sqrt(distSq) || 1;
        resolved.x = b.x + (dx / d) * min;
        resolved.y = b.y + (dy / d) * min;
      }
    };
    for (const n of this.nexuses.values()) push(n);
    for (const t of this.towers.values()) push(t);
    return resolved;
  }

  /** Nearest wall-free spot for a circle, searching outwards from (x, y). */
  findFreeSpot(x: number, y: number, radius: number): { x: number; y: number } {
    if (this.map.circleFree(x, y, radius)) return { x, y };
    for (let ring = 1; ring <= 12; ring++) {
      const d = ring * CONFIG.map.tileSize * 0.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const px = x + Math.cos(a) * d;
        const py = y + Math.sin(a) * d;
        if (this.map.circleFree(px, py, radius)) return { x: px, y: py };
      }
    }
    return { x, y };
  }

  /**
   * Single entry point for all damage dealt to players.
   * `fromX/fromY` is where the damage comes from (used by the directional shield);
   * `sourceId` gets the kill credit.
   */
  damagePlayer(
    player: Player, damage: number, fromX: number, fromY: number,
    sourceId: EntityId | null = null, silent = false,
  ): DamageResult {
    if (!player.alive || player.invulnerableTimer > 0 || this.winner) return 'ignored';

    if (shieldCovers(player, fromX, fromY)) {
      const angle = Math.atan2(fromY - player.y, fromX - player.x);
      const r = player.radius + CONFIG.abilities.shield.offset;
      this.emit({
        type: 'blocked',
        playerId: player.id,
        x: player.x + Math.cos(angle) * r,
        y: player.y + Math.sin(angle) * r,
      });
      return 'blocked';
    }

    // Training room: hits are shown but HP never drops.
    if (!this.isTraining) player.hp = Math.max(0, player.hp - damage);
    player.lastDamageTime = this.time;
    if (sourceId !== null) player.lastHitBy = sourceId;
    if (!silent) this.emit({ type: 'playerHit', playerId: player.id, x: player.x, y: player.y, damage: Math.round(damage) });

    if (player.hp <= 0) this.killPlayer(player);
    return 'hit';
  }

  private killPlayer(player: Player): void {
    player.alive = false;
    player.shieldTimer = 0;
    player.cloakTimer = 0;
    player.whirlTimer = 0;
    player.dashTimer = 0;
    player.beam.active = false;
    player.buffs = { damage: 0, attackSpeed: 0, speed: 0 };
    releaseHook(this, player);

    player.deaths++;
    if (this.isVersus) {
      // Respawn later; the killer's team gets a big XP drop.
      player.respawnTimer = this.server.respawnSeconds + this.server.respawnSecondsPerLevel * player.level;
      const xp = (this.server.playerKillXp + this.server.playerKillXpPerLevel * player.level) * this.server.xpMultiplier;
      this.spawnOrb('xp', player.x, player.y, Math.round(xp), null, player.team);
      const killer = player.lastHitBy !== null ? this.players.get(player.lastHitBy) : undefined;
      if (killer && killer.team !== player.team) {
        killer.kills++;
        killer.killStats.players++;
      }
    }
    this.emit({ type: 'playerDied', playerId: player.id, level: player.level });
  }

  /** Versus: brings a dead player back at his base with full HP. */
  respawnPlayer(player: Player): void {
    const spawn = this.spawnPointOf(player.team);
    player.alive = true;
    player.hp = player.maxHp;
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.lastHitBy = null;
    player.intrusionTime = 0;
    player.invulnerableTimer = 1.5; // spawn protection
    this.emit({ type: 'playerRespawned', playerId: player.id });
  }

  // ------------------------------------------------------------------ enemies

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite = false, options: EnemyOptions = {}): Enemy {
    const S = this.server;
    const stats = isBossKind(kind)
      ? CONFIG.bosses[kind]
      : kind === 'dummy'
        ? CONFIG.training.dummy
        : kind === 'farmer'
          ? { radius: CONFIG.versus.farmerRadius, hp: S.farmerHp, xp: S.farmerXp }
          : CONFIG.enemies[kind];
    const E = CONFIG.enemies.elite;
    const hpScale = kind === 'dummy' || kind === 'farmer' ? 1 : this.mods.enemyHp;
    const roleScale = options.role === 'guardian' ? CONFIG.versus.guardianHpMultiplier : 1;
    const hp = Math.round(stats.hp * hpScale * roleScale * (elite ? E.hpMultiplier : 1));
    const xp = 'xp' in stats ? stats.xp : 0;
    const team = options.team ?? 'red';
    // Its own spot around the nearest hostile player: roughly the side it came from.
    const near = this.nearestPlayer(x, y, Infinity, team);
    const fromAngle = near ? Math.atan2(y - near.y, x - near.x) : this.rng.angle();
    const [jitterMin, jitterMax] = CONFIG.enemies.distanceJitter;
    const enemy: Enemy = {
      id: this.newId(),
      kind,
      team,
      role: options.role ?? (isBossKind(kind) ? 'survival' : 'survival'),
      boss: isBossKind(kind),
      elite,
      lane: options.lane ?? null,
      waypoint: 1,
      homeX: options.homeX ?? x,
      homeY: options.homeY ?? y,
      targetKind: null,
      targetId: null,
      retargetTimer: 0,
      escortId: options.escortId ?? null,
      x,
      y,
      radius: stats.radius * (elite ? E.radiusMultiplier : 1),
      hp,
      maxHp: hp,
      xp: xp * (elite ? E.xpMultiplier : 1),
      vx: 0,
      vy: 0,
      wanderTimer: 0,
      strafeDir: this.rng.next() < 0.5 ? -1 : 1,
      slotAngle: fromAngle + this.rng.range(-0.7, 0.7),
      distanceScale: this.rng.range(jitterMin, jitterMax),
      rallyTimer: 0,
      age: 0,
      hitFlash: 0,
      pulledBy: null,
      aim: 0,
      // Small delay so enemies do not shoot the moment they appear.
      attackCooldown: this.rng.range(0.5, 1.5),
      windup: 0,
      contactCooldown: 0,
      retreatTimer: 0,
      burstTimer: 0,
      lastAttackTime: -Infinity,
      lastHitTime: -Infinity,
    };
    if (kind !== 'dummy') pickWanderDirection(this, enemy);
    this.enemies.set(enemy.id, enemy);
    if (isBossKind(kind) && (enemy.role === 'survival' || this.isTraining)) {
      this.emit({ type: 'bossSpawned', enemyId: enemy.id, kind });
    }
    return enemy;
  }

  /** Survival boss currently alive (versus guardians are tracked by their nexus). */
  aliveBoss(): Enemy | undefined {
    for (const e of this.enemies.values()) if (e.boss && e.role !== 'guardian') return e;
    return undefined;
  }

  /** `silent` skips the hit event and flash (used by the beam, which reports damage in batches). */
  damageEnemy(enemy: Enemy, damage: number, sourceId: EntityId, silent = false): void {
    if (this.winner) return;
    // Versus bosses shrug off mobs and towers: only players can bring them down.
    if (this.isVersus && enemy.boss && !this.players.has(sourceId)) return;
    enemy.lastHitTime = this.time;
    // Dummies never die.
    enemy.hp = Math.max(enemy.kind === 'dummy' ? 1 : 0, enemy.hp - damage);
    if (!silent) {
      enemy.hitFlash = 0.12;
      this.emit({ type: 'hit', targetId: enemy.id, sourceId, x: enemy.x, y: enemy.y, damage: Math.round(damage) });
    }
    if (enemy.hp <= 0) this.killEnemy(enemy, sourceId);
  }

  /** `allowPowerUps` is false for wipe kills, so one wipe cannot chain into another. */
  killEnemy(enemy: Enemy, killerId: EntityId, allowPowerUps = true): void {
    if (!this.enemies.has(enemy.id)) return;
    this.enemies.delete(enemy.id);
    const killer = this.players.get(killerId);
    if (killer) {
      killer.kills++;
      const stats = killer.killStats;
      if (enemy.boss) stats.boss++;
      else if (enemy.elite) stats.elite++;
      else stats.regular++;
      stats.byKind[enemy.kind] = (stats.byKind[enemy.kind] ?? 0) + 1;
    }
    if (!enemy.boss && enemy.role === 'survival') this.killsSinceBoss++;

    // Drops are for the other team: players cannot pick up what their own units leave.
    // A unit finished off by a mob, a tower or a boss leaves much less XP (a yellow orb).
    const reduced = !killer && enemy.kind !== 'dummy';
    const share = reduced ? this.server.nonPlayerKillXpMultiplier : 1;
    const xp = Math.round(enemy.xp * this.server.xpMultiplier * share);
    if (xp > 0) this.spawnOrb('xp', enemy.x, enemy.y, xp, null, enemy.team, reduced);
    if (enemy.kind !== 'farmer') {
      // Bosses always drop a heal; everybody else with a small chance.
      if (enemy.boss || this.rng.next() < CONFIG.drops.healChance) this.dropNear(enemy, 'heal');
      // No power-ups in versus: they would decide fights by luck.
      if (allowPowerUps && !this.isVersus && !enemy.boss && this.rng.next() < CONFIG.powerUps.dropChance) {
        const power = POWER_UP_KINDS[Math.floor(this.rng.next() * POWER_UP_KINDS.length)];
        this.dropNear(enemy, 'power', power);
      }
    }
    this.emit({ type: 'kill', targetId: enemy.id, killerId, x: enemy.x, y: enemy.y, kind: enemy.kind });

    if (enemy.role === 'guardian') this.onGuardianKilled(enemy, killerId);
  }

  private dropNear(enemy: Enemy, kind: OrbKind, power: PowerUpKind | null = null): void {
    const angle = this.rng.angle();
    this.spawnOrb(kind, enemy.x + Math.cos(angle) * 26, enemy.y + Math.sin(angle) * 26, 0, power, enemy.team);
  }

  // -------------------------------------------------------------------- nexus

  createNexus(team: TeamId, x: number, y: number): Nexus {
    // Every guardian kind appears once, in random order.
    const queue = [...BOSS_KINDS];
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    const nexus: Nexus = {
      id: this.newId(),
      team,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: CONFIG.versus.nexusRadius,
      hp: this.server.nexusHp,
      maxHp: this.server.nexusHp,
      stage: 0,
      guardianId: null,
      bossQueue: queue,
      lastHitTime: -Infinity,
    };
    this.nexuses.set(nexus.id, nexus);
    return nexus;
  }

  /** A nexus is immune only while its guardian lives. */
  isNexusShielded(nexus: Readonly<Nexus>): boolean {
    return nexus.guardianId !== null && this.enemies.has(nexus.guardianId);
  }

  /** Team of a player or unit, or null when it is gone (e.g. a bullet of a dead mob). */
  teamOf(id: EntityId): TeamId | null {
    return this.players.get(id)?.team ?? this.enemies.get(id)?.team ?? this.towers.get(id)?.team ?? null;
  }

  /**
   * Anybody hostile hurts a nexus (players and mobs), but never while its guardian lives.
   * Each lost third summons the next guardian boss; the last one guards the ruins.
   */
  damageNexus(nexus: Nexus, damage: number, sourceId: EntityId, x: number, y: number): void {
    if (this.winner || nexus.hp <= 0) return;
    if (this.teamOf(sourceId) === nexus.team) return;
    if (this.isNexusShielded(nexus)) {
      if (this.players.has(sourceId)) this.emit({ type: 'nexusImmune', nexusId: nexus.id, sourceId, x, y });
      return;
    }
    const threshold = (nexus.maxHp * (2 - nexus.stage)) / 3;
    nexus.hp = Math.max(threshold, nexus.hp - damage);
    nexus.lastHitTime = this.time;
    this.emit({ type: 'nexusHit', nexusId: nexus.id, sourceId, x, y, damage: Math.round(damage) });
    if (nexus.hp <= threshold) this.summonGuardian(nexus);
  }

  private summonGuardian(nexus: Nexus): void {
    const kind: BossKind = nexus.bossQueue.shift() ?? BOSS_KINDS[Math.floor(this.rng.next() * BOSS_KINDS.length)];
    // Appears between the nexus and the middle of the map.
    const cx = this.width / 2 - nexus.x;
    const cy = this.height / 2 - nexus.y;
    const len = Math.hypot(cx, cy) || 1;
    const x = nexus.x + (cx / len) * 320;
    const y = nexus.y + (cy / len) * 320;
    const boss = this.spawnEnemy(kind, x, y, false, { team: nexus.team, role: 'guardian', homeX: x, homeY: y });
    nexus.guardianId = boss.id;
    nexus.stage++;
    this.emit({ type: 'nexusStage', nexusId: nexus.id, team: nexus.team, stage: nexus.stage, boss: kind });
  }

  private onGuardianKilled(guardian: Enemy, killerId: EntityId): void {
    for (const nexus of this.nexuses.values()) {
      if (nexus.guardianId !== guardian.id) continue;
      nexus.guardianId = null;
      if (nexus.hp <= 0) {
        // Nexus destroyed and its last guardian slain: the attackers win.
        const killer = this.players.get(killerId);
        this.winner = killer ? killer.team : otherTeam(nexus.team);
        this.emit({ type: 'victory', team: this.winner });
      }
    }
  }

  // ------------------------------------------------------------------- towers

  createTower(team: TeamId, lane: LaneId, order: number, x: number, y: number): Tower {
    const tower: Tower = {
      id: this.newId(),
      team,
      lane,
      order,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: CONFIG.versus.towerRadius,
      hp: this.server.towerHp,
      maxHp: this.server.towerHp,
      lastHitTime: -Infinity,
      attackCooldown: 0,
      targetKind: null,
      targetId: null,
    };
    this.towers.set(tower.id, tower);
    return tower;
  }

  damageTower(tower: Tower, damage: number, sourceId: EntityId, x: number, y: number): void {
    if (this.winner || !this.towers.has(tower.id)) return;
    if (this.teamOf(sourceId) === tower.team) return;
    tower.hp = Math.max(0, tower.hp - damage);
    tower.lastHitTime = this.time;
    this.emit({ type: 'towerHit', towerId: tower.id, sourceId, x, y, damage: Math.round(damage) });
    if (tower.hp <= 0) this.destroyTower(tower, sourceId);
  }

  /**
   * A falling tower gives every enemy player a whole level, and its blast wipes
   * the attacking mobs around it, so one lost tower does not cascade into the next.
   */
  private destroyTower(tower: Tower, killerId: EntityId): void {
    this.towers.delete(tower.id);
    const radius = this.server.towerBlastRadius;
    let wiped = 0;
    for (const e of this.enemies.values()) {
      if (e.team === tower.team || e.boss || e.role === 'farmer') continue;
      if (distanceSq(e.x, e.y, tower.x, tower.y) > radius * radius) continue;
      this.enemies.delete(e.id);
      wiped++;
      this.emit({ type: 'kill', targetId: e.id, killerId: tower.id, x: e.x, y: e.y, kind: e.kind });
    }
    const killer = this.players.get(killerId);
    if (killer && killer.team !== tower.team) killer.killStats.towers++;
    for (const p of this.players.values()) if (p.team !== tower.team) this.grantLevel(p);
    this.emit({
      type: 'towerDestroyed', towerId: tower.id, team: tower.team, lane: tower.lane,
      x: tower.x, y: tower.y, blastRadius: radius, wiped,
    });
  }

  // ------------------------------------------------------- projectiles & orbs

  spawnProjectile(spec: ProjectileSpec): Projectile {
    const dirX = Math.cos(spec.angle);
    const dirY = Math.sin(spec.angle);
    const projectile: Projectile = {
      id: this.newId(),
      ownerId: spec.ownerId,
      team: spec.team,
      source: spec.source,
      x: spec.x,
      y: spec.y,
      vx: dirX * spec.speed,
      vy: dirY * spec.speed,
      radius: spec.radius,
      life: spec.range / spec.speed,
      damage: spec.damage,
      ignoresWalls: spec.ignoresWalls ?? false,
      piercesBuildings: spec.piercesBuildings ?? false,
      aimedAt: spec.aimedAt ?? null,
      blastRadius: spec.blastRadius ?? 0,
      blastDamage: spec.blastDamage ?? 0,
    };
    this.projectiles.set(projectile.id, projectile);
    return projectile;
  }

  spawnOrb(
    kind: OrbKind, x: number, y: number, xp: number,
    power: PowerUpKind | null = null, denyTeam: TeamId | null = null, reduced = false,
  ): Orb {
    const radius = kind === 'heal' ? CONFIG.orb.healRadius : kind === 'power' ? CONFIG.powerUps.radius : CONFIG.orb.radius;
    const orb: Orb = {
      id: this.newId(),
      kind,
      x,
      y,
      radius,
      xp,
      power,
      denyTeam,
      reduced,
      attractedTo: null,
      speed: 0,
      life: CONFIG.drops.orbLifetime,
    };
    this.orbs.set(orb.id, orb);
    return orb;
  }

  // ------------------------------------------------------------ training room

  /** Training room: switch the class on the fly. */
  setLoadout(playerId: EntityId, loadout: Loadout): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const klass = classInfo(loadout.classId);
    releaseHook(this, p);
    p.shieldTimer = 0;
    p.cloakTimer = 0;
    p.whirlTimer = 0;
    p.beam.active = false;
    p.classId = klass.id;
    p.weapon = klass.weapon;
    p.ability = klass.ability;
    p.viewScale = klass.viewScale;
    p.abilityCooldown = 0;
    p.attackCooldown = 0;
  }

  setRank(playerId: EntityId, stat: UpgradeStat, rank: number): void {
    const p = this.players.get(playerId);
    if (p) p.ranks[stat] = Math.max(0, Math.min(CONFIG.upgrades.maxRank, Math.round(rank)));
  }

  /** Spawns an enemy (or dummy) in view, at a random angle around the player. */
  spawnNear(playerId: EntityId, kind: EnemyKind, elite = false): Enemy | undefined {
    const p = this.players.get(playerId);
    if (!p) return undefined;
    const angle = this.rng.angle();
    const d = CONFIG.training.spawnDistance;
    const x = Math.max(100, Math.min(this.width - 100, p.x + Math.cos(angle) * d));
    const y = Math.max(100, Math.min(this.height - 100, p.y + Math.sin(angle) * d * 0.6));
    const spot = isBossKind(kind) ? { x, y } : this.findFreeSpot(x, y, 50);
    return this.spawnEnemy(kind, spot.x, spot.y, elite, { team: otherTeam(p.team) });
  }

  spawnPowerUpNear(playerId: EntityId, power: PowerUpKind): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const angle = this.rng.angle();
    const spot = this.findFreeSpot(p.x + Math.cos(angle) * 220, p.y + Math.sin(angle) * 160, 20);
    this.spawnOrb('power', spot.x, spot.y, 0, power);
  }

  clearEnemies(): void {
    for (const p of this.players.values()) releaseHook(this, p);
    this.enemies.clear();
    for (const pr of this.projectiles.values()) {
      const owner = this.players.get(pr.ownerId);
      if (!owner) this.projectiles.delete(pr.id);
    }
  }

  // ------------------------------------------------------------------ helpers

  newId(): EntityId {
    return this.nextId++;
  }

  emit(event: GameEvent): void {
    this.events.push(event);
  }
}
