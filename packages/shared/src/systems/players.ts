import { CONFIG } from '../config';
import { clamp, length, normalize } from '../math/vec2';
import type { ServerConfig } from '../server.config';
import { dashCooldown, moveSpeed } from '../stats';
import { UPGRADE_STATS, type Player } from '../types';
import type { World } from '../world';
import { tryUseAbility } from './abilities';
import { updateWeapon } from './weapons';

const EPS = 1e-6;
/** Protects against a huge counter jump (e.g. a reconnecting client) replaying many presses. */
const MAX_UPGRADE_BACKLOG = 20;

/**
 * What player movement needs from the world. `World` implements it; a network client
 * implements it too, so it can predict its own movement with exactly the same code.
 */
export interface MovementEnv {
  readonly server: Readonly<ServerConfig>;
  readonly width: number;
  readonly height: number;
  /** Pushes a circle out of walls and buildings. */
  resolveObstacles(x: number, y: number, radius: number): { x: number; y: number };
}

export function updatePlayers(world: World, dt: number): void {
  for (const p of world.players.values()) {
    if (!p.alive) {
      // Versus: the dead come back after a level-dependent delay.
      if (world.isVersus) {
        p.respawnTimer = Math.max(0, p.respawnTimer - dt);
        if (p.respawnTimer <= 0) world.respawnPlayer(p);
      }
      continue;
    }

    applyUpgradeRequests(world, p);
    tickBuffs(p, dt);
    if (stepMovement(world, p, dt)) world.emit({ type: 'dash', playerId: p.id });
    p.aim = p.input.aim;
    regenerate(world, p, dt);

    updateWeapon(world, p, dt);

    // Ability fires on button press, not while held.
    p.abilityCooldown = Math.max(0, p.abilityCooldown - dt);
    const abilityPressed = p.input.ability && !p.prevAbilityHeld;
    p.prevAbilityHeld = p.input.ability;
    if (abilityPressed) tryUseAbility(world, p);
  }
}

/** Keys 1/2/3: each new press spends one point (presses without points are simply dropped). */
function applyUpgradeRequests(world: World, p: Player): void {
  for (const stat of UPGRADE_STATS) {
    const requested = p.input.upgrades[stat];
    if (requested - p.upgradeRequests[stat] > MAX_UPGRADE_BACKLOG) {
      p.upgradeRequests[stat] = requested - MAX_UPGRADE_BACKLOG;
    }
    while (p.upgradeRequests[stat] < requested) {
      p.upgradeRequests[stat]++;
      world.upgrade(p, stat);
    }
    // A counter that went backwards means the client restarted its counters.
    if (requested < p.upgradeRequests[stat]) p.upgradeRequests[stat] = requested;
  }
}

function tickBuffs(p: Player, dt: number): void {
  p.buffs.damage = Math.max(0, p.buffs.damage - dt);
  p.buffs.attackSpeed = Math.max(0, p.buffs.attackSpeed - dt);
  p.buffs.speed = Math.max(0, p.buffs.speed - dt);
}

/**
 * Dash request + movement of one player for one tick, driven by `p.input`.
 * Shared by the simulation and client-side prediction. Returns true when a dash started.
 */
export function stepMovement(env: MovementEnv, p: Player, dt: number): boolean {
  const dashed = handleDashRequest(env, p, dt);
  move(env, p, dt);
  return dashed;
}

function handleDashRequest(env: MovementEnv, p: Player, dt: number): boolean {
  const D = CONFIG.dash;
  // The speed power-up shortens the cooldown right away, even mid-cooldown.
  p.dashCooldown = Math.min(Math.max(0, p.dashCooldown - dt), dashCooldown(p, env.server));
  const input = p.input;
  if (input.dashSeq === p.lastDashSeq) return false;
  p.lastDashSeq = input.dashSeq;

  const dir = normalize(input.dashX, input.dashY);
  if (p.dashCooldown > EPS || p.dashTimer > 0 || (dir.x === 0 && dir.y === 0)) return false;

  p.dashTimer = D.duration;
  p.dashDirX = dir.x;
  p.dashDirY = dir.y;
  p.dashCooldown = dashCooldown(p, env.server);
  if (D.invulnerable) p.invulnerableTimer = D.duration;
  return true;
}

function move(env: MovementEnv, p: Player, dt: number): void {
  const { width, height } = env;
  p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);

  let dx: number;
  let dy: number;
  if (p.dashTimer > 0) {
    // Short tumble: covers `dashDistance` over `dash.duration`.
    const dashSpeed = env.server.dashDistance / CONFIG.dash.duration;
    const t = Math.min(dt, p.dashTimer);
    dx = p.dashDirX * dashSpeed * t;
    dy = p.dashDirY * dashSpeed * t;
    p.dashTimer = Math.max(0, p.dashTimer - dt);
  } else {
    // Clamp to unit length so diagonals are not faster,
    // but keep analog magnitude (< 1) for a future touch joystick.
    const len = length(p.input.moveX, p.input.moveY);
    const scale = (len > 1 ? 1 / len : 1) * moveSpeed(p, env.server) * dt;
    dx = p.input.moveX * scale;
    dy = p.input.moveY * scale;
  }
  // Walls and buildings stop the player; he slides along them.
  const resolved = env.resolveObstacles(p.x + dx, p.y + dy, p.radius);
  const x = clamp(resolved.x, p.radius, width - p.radius);
  const y = clamp(resolved.y, p.radius, height - p.radius);
  p.vx = dt > 0 ? (x - p.x) / dt : 0;
  p.vy = dt > 0 ? (y - p.y) / dt : 0;
  p.x = x;
  p.y = y;
}

function regenerate(world: World, p: Player, dt: number): void {
  const C = CONFIG.player;
  let perSecond = world.time - p.lastDamageTime >= C.regenDelay ? C.regenPerSecond : 0;
  // Melee compensation: the sword heals a little all the time, even in the middle of a fight.
  if (p.weapon === 'sword') perSecond += (p.maxHp * world.server.swordRegenPercent) / 100;
  if (perSecond > 0 && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + perSecond * dt);
}
