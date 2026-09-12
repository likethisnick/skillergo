import { CLASS_IDS, classInfo, type AbilityType, type ClassId, type UpgradeStat, type WeaponType } from '@skillergo/shared';

export interface OptionInfo {
  name: string;
  description: string;
}

/** Display names and short descriptions for the loadout picker and HUD. */
export const WEAPON_INFO: Readonly<Record<WeaponType, OptionInfo>> = {
  gun: { name: 'Gun', description: 'Fires bullets. Hold to auto-fire.' },
  sword: { name: 'Sword', description: 'Wide close-range swing. Hits everything in the arc.' },
  beam: { name: 'Beam', description: 'Weak but constant damage. Keep it on the target.' },
  rifle: { name: 'Rifle', description: 'One heavy, very fast shot per cooldown, at tower range.' },
  fireball: { name: 'Fireball', description: 'Slow ball that bursts on contact or at the end of its flight.' },
  blink: { name: 'Blink', description: 'Short teleport that hurts everything where you land.' },
};

export const ABILITY_INFO: Readonly<Record<AbilityType, OptionInfo>> = {
  hook: { name: 'Hook', description: 'Hit an enemy directly to pull it to you.' },
  shield: { name: 'Shield', description: 'Blocks all damage from the cursor side for 2 s.' },
  shotgun: { name: 'Shotgun', description: 'Short cone blast with heavy damage.' },
  cloak: { name: 'Cloak', description: 'Invisible for 3 s. Attacking gives you away.' },
  rally: { name: 'Rally', description: 'Your mobs nearby get faster and stronger and go for the marked target.' },
  whirlwind: { name: 'Whirlwind', description: 'One sweep that hits everything around you.' },
};

/** Class cards on the start screen: weapon + ability pair with a one-line pitch. */
export const CLASS_INFO: Readonly<Record<ClassId, OptionInfo>> = Object.fromEntries(
  CLASS_IDS.map((id) => {
    const info = classInfo(id);
    return [id, { name: info.name, description: info.description }];
  }),
) as Record<ClassId, OptionInfo>;

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
  cloak: '+duration · -cd',
  rally: '+radius · +duration · -cd',
  whirlwind: '+radius · +damage · -cd',
};
