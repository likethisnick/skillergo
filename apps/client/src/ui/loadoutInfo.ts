import type { AbilityType, UpgradeStat, WeaponType } from '@skillergo/shared';

export interface OptionInfo {
  name: string;
  description: string;
}

/** Display names and short descriptions for the loadout picker and HUD. */
export const WEAPON_INFO: Readonly<Record<WeaponType, OptionInfo>> = {
  gun: { name: 'Gun', description: 'Fires bullets. Hold to auto-fire.' },
  sword: { name: 'Sword', description: 'Wide close-range swing. Cuts bullets, always heals a little.' },
  beam: { name: 'Beam', description: 'Weak but constant damage. Keep it on the target.' },
};

export const ABILITY_INFO: Readonly<Record<AbilityType, OptionInfo>> = {
  hook: { name: 'Hook', description: 'Hit an enemy directly to pull it to you.' },
  shield: { name: 'Shield', description: 'Blocks all damage from the cursor side for 2 s.' },
  shotgun: { name: 'Shotgun', description: 'Short cone blast with heavy damage.' },
};

/** Upgrade tracks (keys 1 / 2 / 3). The ability line depends on the chosen ability. */
export const UPGRADE_INFO: Readonly<Record<UpgradeStat, OptionInfo>> = {
  weapon: { name: 'Weapon', description: '+15% dmg · +10% atk speed' },
  mobility: { name: 'Mobility', description: '+8% speed · -8% dash cd' },
  ability: { name: 'Ability', description: '' },
};

export const ABILITY_UPGRADE_TEXT: Readonly<Record<AbilityType, string>> = {
  hook: '+range · +speed · -cd',
  shield: '+duration · +width · -cd',
  shotgun: '+range · +damage · -cd',
};
