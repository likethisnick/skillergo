import { CONFIG } from './config';
import type { AbilityType, ClassId, WeaponType } from './types';

export interface ClassInfo {
  id: ClassId;
  name: string;
  weapon: WeaponType;
  ability: AbilityType;
  /** How much of the world this class sees (1 = standard). */
  viewScale: number;
  description: string;
}

/** Weapon + ability pair of a class. */
export function classInfo(id: ClassId): ClassInfo {
  const c = CONFIG.classes[id];
  return { id, name: c.name, weapon: c.weapon, ability: c.ability, viewScale: c.viewScale, description: c.description };
}

/** Rifle range follows the tower range, so both stay in step when the config changes. */
export function rifleRange(towerRange: number): number {
  return towerRange * CONFIG.weapons.rifle.rangeTowerShare;
}
