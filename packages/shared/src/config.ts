const deg = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Detailed gameplay tuning. The main knobs (damage, speeds, dash cooldown, difficulty
 * growth rate) live in `server.config.ts`; values here are ranges, timings and
 * multipliers relative to those. Shared verbatim by the client and a future server.
 * Distances are in world units, times in seconds, speeds in units per second,
 * angles in radians (use `deg()` for readability).
 */
export const CONFIG = {
  /** Fixed simulation rate. A network server would typically run 20-30 Hz. */
  tickRate: 60,

  /** Survival and training world. */
  world: { width: 4000, height: 4000 },

  /** Versus map (see arena.ts): corner bases, three lanes, diagonal split. */
  arena: {
    size: 5200,
    cornerInset: 600,
    nexusInset: 360,
    laneHalfWidth: 300,
    neutralHalfWidth: 450,
    baseRadius: 900,
  },

  versus: {
    nexusRadius: 90,
    /** Mobs notice hostile units within this distance. */
    engageRadius: 650,
    /** Mobs defend their half against a player within this radius... */
    defendRadius: 800,
    /** ...which grows by this much per second the intruder stays... */
    defendRadiusGrowth: 90,
    defendRadiusMax: 2400,
    /** Own wave mobs on the same lane within this distance escort an intruding player. */
    escortRadius: 1600,
    /** Seconds of intrusion before the first reinforcement squad. */
    reinforcementDelay: 6,
    waypointReach: 180,
    /** Guardian bosses never chase farther than this from their nexus. */
    bossLeash: 1700,
    /** Guardians are tougher than survival bosses: they defend a whole base. */
    guardianHpMultiplier: 3,
    farmerRadius: 24,
    farmerWanderRadius: 480,
    farmerFleeRadius: 360,
    farmerContactDamage: 4,
    waveComposition: ['grunt', 'rusher', 'grunt', 'sniper', 'grunt', 'rusher'],
    firstWaveDelay: 4,
    maxMobsPerTeam: 120,
  },

  /** World area visible around a player. Used for fair-shot checks and client zoom. */
  view: { width: 1280, height: 720 },

  player: {
    radius: 28,
    maxHp: 100,
    /** Health regeneration starts after this many seconds without taking damage. */
    regenDelay: 4,
    regenPerSecond: 4,
  },

  /** Dash distance and cooldown are in server.config.ts; speed = distance / duration. */
  dash: {
    duration: 0.14,
    /** Player cannot be damaged while dashing (lets you dodge through bullets). */
    invulnerable: true,
  },

  progression: {
    startLevel: 1,
    /** XP needed for the first level-up (100 regular kills); every next level needs `xpStep` more. */
    baseXp: 1000,
    xpStep: 100,
    /** Every level-up raises max HP by this share of the starting max HP and heals the same amount. */
    hpPerLevel: 0.3,
  },

  map: {
    /** Walls are made of square tiles of this size; 1-tile gaps fit every non-boss unit. */
    tileSize: 80,
    /** No walls this close to the player start. */
    clearRadius: 360,
    /** Enemy path maps to a player are rebuilt at most this often (and when he changes tile). */
    flowFieldRefresh: 0.4,
  },

  /** Every level-up gives upgrade points, spent with keys 1 / 2 / 3. */
  upgrades: {
    pointsPerLevel: 1,
    maxRank: 10,
    /** Key 1: weapon damage and attack speed. */
    weapon: { damagePerRank: 0.15, attackSpeedPerRank: 0.1 },
    /** Key 2: movement speed and dash cooldown. */
    /** Dash cooldown never drops below `minDashCooldownFactor` x the base cooldown. */
    mobility: { moveSpeedPerRank: 0.08, dashCooldownPerRank: 0.08, minDashCooldownFactor: 0.5 },
    /** Key 3: ability radius / range, speed, power (damage or duration) and cooldown. */
    ability: { radiusPerRank: 0.12, speedPerRank: 0.1, powerPerRank: 0.2, cooldownPerRank: 0.06, minCooldownMultiplier: 0.4 },
  },

  /** Temporary buffs dropped by enemies. */
  powerUps: {
    dropChance: 0.05,
    radius: 14,
    duration: 8,
    /** "Damage" power-up randomly gives one of these two. */
    damageMultiplier: 4,
    attackSpeedMultiplier: 4,
    moveSpeedMultiplier: 2.5,
    dashCooldown: 0.2,
    /**
     * Wipe kills every non-boss enemy and enemy bullet within this radius.
     * A fixed world radius (not "the screen") keeps it fair in multiplayer;
     * it covers the default 1280x720 view (half diagonal ~734).
     */
    wipeRadius: 900,
  },

  weapons: {
    gun: {
      cooldown: 0.25,
      projectileRadius: 6,
      range: 900,
    },
    sword: {
      cooldown: 0.45,
      /** Reach from the player's center. */
      range: 115,
      arc: deg(130),
      /** Visual swing duration. Damage is applied instantly at swing start. */
      swingTime: 0.15,
    },
    beam: {
      range: 520,
      /** How often accumulated beam damage is reported as a floating number. */
      reportInterval: 0.3,
    },
  },

  abilities: {
    /** RMB ability slot unlocks at this level, whatever ability is chosen. */
    unlockLevel: 2,
    hook: {
      cooldown: 3,
      radius: 10,
      speed: 1400,
      range: 650,
      pullSpeed: 900,
      retractSpeed: 1800,
      /** Pulled enemy stops this far from the player's edge. */
      releaseGap: 12,
      /** A pull that gets stuck on a wall gives up after this long. */
      maxPullTime: 1.2,
    },
    shield: {
      duration: 2,
      /** Cooldown starts after the shield expires. */
      cooldown: 5,
      arc: deg(120),
      /** Distance of the shield band from the player's edge. */
      offset: 16,
    },
    shotgun: {
      cooldown: 4,
      /** About a quarter of the default view width. */
      range: 320,
      arc: deg(50),
    },
  },

  enemies: {
    grunt: {
      radius: 26,
      hp: 100,
      xp: 10,
      /** Acceleration = own speed x this factor (per second): higher = snappier turns. */
      accelerationFactor: 4.5,
      preferredDistance: 340,
      spawnWeight: 5,
      /** Shoots roughly towards the player: no leading, random spread (narrows with difficulty). */
      aim: { lead: 0, spread: deg(14) },
      attack: {
        range: 650,
        cooldownMin: 1.6,
        cooldownMax: 2.4,
        /** Aim phase before the shot. Aim locks for the last `aimLock` seconds. */
        windup: 0.35,
        aimLock: 0.12,
        projectileRadius: 7,
        projectileRange: 1000,
        damage: 10,
      },
    },
    rusher: {
      radius: 20,
      hp: 60,
      xp: 10,
      /** Limited acceleration makes charges dodgeable with a sidestep or a dash. */
      accelerationFactor: 2.8,
      spawnWeight: 3,
      contactDamage: 15,
      contactCooldown: 1,
      /** After a hit the rusher bounces back for this long before charging again. */
      retreatTime: 0.5,
    },
    sniper: {
      radius: 16,
      hp: 50,
      xp: 15,
      accelerationFactor: 4.4,
      preferredDistance: 520,
      spawnWeight: 2,
      /** Always leads a moving target (full intercept), almost no spread. */
      aim: { lead: 1, spread: deg(1) },
      attack: {
        range: 900,
        cooldownMin: 2.4,
        cooldownMax: 3.2,
        windup: 0.7,
        aimLock: 0.2,
        projectileRadius: 5,
        projectileRange: 1300,
        damage: 20,
      },
    },
    /** Seconds between random direction changes while no player is around. */
    wanderMin: 1.5,
    wanderMax: 4,
    /** Enemies notice players within this distance. */
    aggroRange: 1400,
    /**
     * Every enemy picks its own spot around the player (an angle) and slowly orbits it,
     * so crowds surround the player across the whole screen instead of clumping.
     */
    slotDrift: 0.15,
    /** Preferred distance is scaled per enemy by a random factor in this range. */
    distanceJitter: [0.75, 1.2],
    /** Rushers aim for a flank point this far from the player until they are within `rushRange`. */
    flankDistance: 260,
    rushRange: 380,
    /** Extra personal space between regular enemies. */
    separationGap: 12,
    spawnFadeIn: 0.4,
    /** Elite version of a regular enemy: bigger, much tougher, more XP. */
    elite: {
      hpMultiplier: 5,
      radiusMultiplier: 1.35,
      xpMultiplier: 5,
    },
  },

  bosses: {
    /** Slow giant. Fires a huge but slow projectile about half a screen wide. */
    colossus: {
      name: 'Colossus',
      radius: 70,
      hp: 3000,
      xp: 300,
      accelerationFactor: 1.33,
      preferredDistance: 420,
      aim: { lead: 0, spread: 0 },
      contactDamage: 25,
      contactCooldown: 1,
      attack: {
        range: 1100,
        cooldownMin: 3.5,
        cooldownMax: 4.5,
        windup: 1,
        aimLock: 0.3,
        projectileRadius: 170,
        projectileRange: 1800,
        damage: 40,
      },
    },
    /** Jittery sniper: dashes left/right in bursts and leads its fast shots. */
    duelist: {
      name: 'Duelist',
      radius: 34,
      hp: 1500,
      xp: 300,
      accelerationFactor: 6,
      preferredDistance: 450,
      aim: { lead: 1, spread: 0 },
      burstTime: 0.18,
      burstPauseMin: 0.3,
      burstPauseMax: 0.65,
      attack: {
        range: 950,
        cooldownMin: 0.8,
        cooldownMax: 1.2,
        windup: 0.25,
        aimLock: 0.08,
        projectileRadius: 6,
        projectileRange: 1300,
        damage: 14,
      },
    },
    /** Melee: closes in fast, telegraphs a wide sword swing, then leaps back. */
    blademaster: {
      name: 'Blademaster',
      radius: 38,
      hp: 2000,
      xp: 300,
      accelerationFactor: 4,
      swingRange: 175,
      swingArc: deg(150),
      windup: 0.4,
      damage: 30,
      /** Leap-back speed relative to its movement speed. */
      leapSpeedFactor: 2.33,
      leapTime: 0.35,
      recoverTime: 1,
      /** Distance kept while recovering between attacks. */
      orbitDistance: 320,
    },
  },

  drops: {
    healChance: 0.1,
    /** Heal orb restores this fraction of max HP. */
    healFraction: 0.1,
    /** Orbs disappear after this many seconds (they blink during the last 5). */
    orbLifetime: 60,
  },

  /**
   * Difficulty 1..30. The game starts at the same baseline for every difficulty and
   * ramps up with player progress until `peakLevel`. Each pair is [baseline, peak on 30];
   * difficulty d reaches baseline + (peak - baseline) * d / 30 at the peak level.
   */
  difficulty: {
    min: 1,
    max: 30,
    default: 10,
    peakLevel: 10,
    population: [2.5, 21],
    spawnRate: [2, 10],
    enemyHp: [1, 2.2],
    enemyDamage: [1, 2.5],
    fireRate: [1, 2],
    enemySpeed: [1, 1.3],
    projectileSpeed: [1, 1.35],
    /** 0..1, narrows the grunts' random spread (see `accuracy` below). Snipers always lead. */
    accuracy: [0, 1],
    eliteChance: [0.02, 0.2],
    /** Regular kills needed before a boss shows up. */
    bossEveryKills: [60, 15],
    /** Hard cap on alive enemies, whatever the difficulty. */
    maxEnemies: 150,
  },

  /** The difficulty ramp's accuracy narrows the random spread of inaccurate shooters (grunts). */
  accuracy: {
    spreadReductionAtPeak: 0.5,
  },

  /** Enemy speed multiplier: enemy movement and enemy bullets. The player is not affected. */
  speedSetting: {
    min: 0.5,
    max: 3,
    step: 0.1,
    default: 1,
  },

  spawner: {
    interval: 1.2,
    /** Regular enemies kept around each player = basePopulation x difficulty population factor. */
    basePopulation: 3,
    /** Regular enemies around a player are counted within this radius. */
    activityRadius: 1500,
    /**
     * Enemies spawn at least this far from every player, i.e. outside any screen.
     * Must exceed half of the view diagonal (~734 for 1280x720) plus enemy radius.
     */
    hiddenRadius: 850,
    spawnRingWidth: 350,
    /** Enemies farther than this from every player are removed. */
    despawnDistance: 2000,
  },

  training: {
    /** Target dummy: never dies, never attacks, heals back to full after a short break. */
    dummy: { name: 'Dummy', radius: 34, hp: 5000, regenDelay: 2 },
    spawnDistance: 380,
  },

  orb: {
    radius: 8,
    healRadius: 11,
    /** Orbs start flying to a player once he is this close. */
    magnetRadius: 140,
    magnetStartSpeed: 250,
    magnetAcceleration: 1600,
  },
} as const;
