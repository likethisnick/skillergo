import { CONFIG } from './config';
import type { ServerConfig } from './server.config';
import type { Player } from './types';

const U = CONFIG.upgrades;
const PU = CONFIG.powerUps;

/**
 * Derived player stats: server base values x upgrade ranks x active buffs.
 * Every system (and the HUD) reads stats through these helpers so the rules live in one place.
 */

/** Weapon damage multiplier (key 1 upgrades, damage power-up). */
export function weaponDamageMultiplier(p: Readonly<Player>): number {
  return (1 + U.weapon.damagePerRank * p.ranks.weapon) * (p.buffs.damage > 0 ? PU.damageMultiplier : 1);
}

/** Attack speed multiplier; divides weapon cooldowns (key 1 upgrades, attack speed power-up). */
export function attackSpeedMultiplier(p: Readonly<Player>): number {
  return (1 + U.weapon.attackSpeedPerRank * p.ranks.weapon) * (p.buffs.attackSpeed > 0 ? PU.attackSpeedMultiplier : 1);
}

/** Movement speed in units per second (key 2 upgrades, speed power-up). */
export function moveSpeed(p: Readonly<Player>, server: Readonly<ServerConfig>): number {
  return server.playerSpeed
    * (1 + U.mobility.moveSpeedPerRank * p.ranks.mobility)
    * (p.buffs.speed > 0 ? PU.moveSpeedMultiplier : 1);
}

/** Dash cooldown in seconds (key 2 upgrades, speed power-up). */
export function dashCooldown(p: Readonly<Player>, server: Readonly<ServerConfig>): number {
  const M = U.mobility;
  const upgraded = Math.max(
    server.dashCooldown * M.minDashCooldownFactor,
    server.dashCooldown * (1 - M.dashCooldownPerRank * p.ranks.mobility),
  );
  return p.buffs.speed > 0 ? Math.min(PU.dashCooldown, upgraded) : upgraded;
}

export interface AbilityScaling {
  /** Range, radius and arc multiplier. */
  radius: number;
  /** Projectile / pull speed multiplier. */
  speed: number;
  /** Damage or duration multiplier. */
  power: number;
  cooldown: number;
}

/** Ability multipliers from key 3 upgrades. */
export function abilityScaling(p: Readonly<Player>): AbilityScaling {
  const r = p.ranks.ability;
  const A = U.ability;
  return {
    radius: 1 + A.radiusPerRank * r,
    speed: 1 + A.speedPerRank * r,
    power: 1 + A.powerPerRank * r,
    cooldown: Math.max(A.minCooldownMultiplier, 1 - A.cooldownPerRank * r),
  };
}

/** Ability damage: server base x ability power; the damage power-up boosts it too. */
export function abilityDamage(p: Readonly<Player>, base: number): number {
  return base * abilityScaling(p).power * (p.buffs.damage > 0 ? PU.damageMultiplier : 1);
}
