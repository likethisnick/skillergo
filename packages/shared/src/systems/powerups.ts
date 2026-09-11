import { CONFIG } from '../config';
import { distanceSq } from '../math/vec2';
import type { Player, PowerUpKind } from '../types';
import type { World } from '../world';

const PU = CONFIG.powerUps;

/** Applies a picked-up power-up. Buffs refresh their duration when picked up again. */
export function applyPowerUp(world: World, p: Player, kind: PowerUpKind): void {
  switch (kind) {
    case 'damage': {
      // Randomly either damage x4 or attack speed x4.
      const buff = world.rng.next() < 0.5 ? 'damage' : 'attackSpeed';
      p.buffs[buff] = PU.duration;
      world.emit({ type: 'powerUp', playerId: p.id, buff });
      break;
    }
    case 'speed':
      p.buffs.speed = PU.duration;
      world.emit({ type: 'powerUp', playerId: p.id, buff: 'speed' });
      break;
    case 'wipe':
      wipe(world, p);
      world.emit({ type: 'powerUp', playerId: p.id, buff: 'wipe' });
      break;
  }
}

/** Kills every non-boss enemy and removes every enemy bullet within the wipe radius. */
function wipe(world: World, p: Player): void {
  const R = PU.wipeRadius;
  let count = 0;
  for (const e of world.enemies.values()) {
    // Only hostile rank-and-file units: not bosses, farmers or training dummies.
    if (e.team === p.team || e.boss || e.kind === 'dummy' || e.role === 'farmer') continue;
    const reach = R + e.radius;
    if (distanceSq(e.x, e.y, p.x, p.y) <= reach * reach) {
      world.killEnemy(e, p.id, false);
      count++;
    }
  }
  for (const pr of world.projectiles.values()) {
    if (pr.team !== p.team && distanceSq(pr.x, pr.y, p.x, p.y) <= (R + pr.radius) ** 2) {
      world.projectiles.delete(pr.id);
    }
  }
  world.emit({ type: 'wipe', playerId: p.id, x: p.x, y: p.y, radius: R, count });
}
