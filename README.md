# Skillergo

Agar.io-like browser game. Survival, a training room and a Versus AI match (MOBA-like lanes and nexuses).
Single player for now, structured so the simulation can move to an authoritative server for multiplayer later:
the AI player already plays through the same `PlayerInput` a remote human would send.

## Run

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Vite also prints a LAN address, so you can open the game from a phone on the same Wi-Fi.

Other scripts:

- `npm run build`: typecheck and build the client into `apps/client/dist`
- `npm run typecheck`: typecheck all packages

Where is what (in Russian): see [STRUCTURE.md](STRUCTURE.md).

## Game config

All main balance knobs live in [`game.config.json`](game.config.json) in the project root:
just `"name": number`, nothing else. Delete a line and the default comes back; a typo or a negative
number is ignored (the default is used). Restart `npm run dev` after editing (Vite reloads the page).

| Setting | Meaning |
|---|---|
| `difficultyGrowthRate` | 0 = difficulty never grows, 0.1 = slow, 1 = normal (peak at level 10), 10 = fast, 100 = peak within a second |
| `xpMultiplier` | All XP drops: 1 = normal, 2 = double, 0 = none |
| `playerSpeed`, `dashCooldown`, `dashDistance` | Player movement speed; seconds between dashes and how far one dash goes |
| `obstacleDensity` | Share of the world covered by tetromino walls (0.2 = 20%) |
| `gunDamage`, `swordDamage`, `beamDamagePerSecond` | Base weapon damage |
| `hookDamage`, `shotgunDamage` | Base ability damage (the shield deals none) |
| `enemySpeed` + `<kind>SpeedMultiplier` | Base enemy speed; each enemy type is a multiplier of it (`wanderSpeedMultiplier` = idle walking) |
| `bulletSpeed` + `<kind>BulletSpeedMultiplier` | Base bullet speed; the player's gun and each enemy bullet type are multipliers of it |
| `respawnSeconds`, `respawnSecondsPerLevel` | Versus: respawn after 5 s + 3 s per level |
| `nexusHp`, `nexusUnlockLevel` | Versus: nexus HP and the level needed to damage it |
| `waveIntervalSeconds`, `waveSize` | Versus: a wave per lane per team every 30 s, 6 mobs each |
| `homeDefenseBonus` | Versus: mobs deal +25% damage on their own half |
| `reinforcementSeconds`, `reinforcementSize` | Versus: while you stay on enemy ground, a defender squad comes every 10 s (grows over time) |
| `farmerCount`, `farmerHp`, `farmerXp`, `farmerRespawnSeconds` | Versus: farmers per base, their HP, XP and respawn time |
| `playerKillXp`, `playerKillXpPerLevel` | Versus: XP for killing a player (60 + 8 per victim level) |
| `versusLevelXp`, `versusLevelXpStep` | Versus XP curve: 1500, 1900, 2300... |
| `historyEnabled`, `historyDir`, `historyFile` | Run history log (default `logs/history.jsonl` in the project root) |

The difficulty and enemy speed sliders, upgrades and power-ups all multiply these values.
The file is read by [`packages/shared/src/server.config.ts`](packages/shared/src/server.config.ts), which also holds the
defaults. A multiplayer server can pass overrides at runtime: `new World({ server: { gunDamage: 80 } })`.
`config.ts` holds the detailed tuning (ranges, timings, AI, arena size, lanes).

## Run history

Every finished run (death, match end, restart, main menu or closed tab; not the training room) is appended
to `logs/history.jsonl`, one JSON object per line:

```json
{"version":1,"startedAt":"...","endedAt":"...","durationSeconds":184.2,"endReason":"death",
 "settings":{"difficulty":10,"speed":1},"balance":{"difficultyGrowthRate":1,"xpMultiplier":1},
 "difficultyReached":0.31,"weapon":"gun","ability":"shotgun","level":4,"xp":350,
 "upgrades":{"ranks":{"weapon":2,"mobility":1,"ability":0},"unspentPoints":0,
   "history":[{"stat":"weapon","rank":1,"level":2,"time":61.3}, ...]},
 "kills":{"total":312,"regular":290,"elite":19,"boss":3,"players":0,"byKind":{"grunt":150,"rusher":90, ...}},
 "mode":"normal","result":null,"deaths":1,"loggedAt":"..."}
```

Versus runs have `"mode":"versus"`, `"result":"victory"` / `"defeat"` (or `null` if you left early),
`deaths` and `kills.players`.

The file is written by the Vite dev/preview server (`apps/client/dev/historyLog.ts`), so logging
works with `npm run dev` and `npm run preview`. A static build without a server just skips it.
A multiplayer server can call `buildRunSummary()` from the shared package and write the same format.
`logs/` is in `.gitignore`.

## Controls

| Input | Action |
|---|---|
| WASD / arrows | Move (works with any keyboard layout) |
| Shift | Short tumble in the movement direction (towards the cursor when standing still); 1.5 s cooldown, invulnerable while rolling |
| LMB (hold) | Weapon: gun, sword or beam |
| RMB | Ability: hook, shield or shotgun (unlocks at level 2) |
| 1 / 2 / 3 | Spend an upgrade point: weapon / mobility / ability |
| Esc | Menu: resume, restart, main menu (the game keeps running) |

Weapon and ability are picked on the start screen, left of the Play button.
Difficulty (1-30) and enemy speed (x0.5-x3) are on the right.
**Versus AI** (under Play): a match against an AI player, see below. The difficulty slider sets how well the AI plays.
**Training room**: no auto spawns, you cannot die, a side panel switches
weapon/ability, sets upgrade ranks, spawns dummies, enemies, bosses and power-ups, and shows DPS.

## Map

About 20% of the world is filled with random tetromino-shaped walls (a new layout every run, every free
spot stays reachable, the start area is clear). Regular enemies walk around them (flow-field pathfinding),
and walls stop regular bullets, the beam, the hook and melee hits. Bosses and their attacks ignore walls.

## Levels and upgrades

Every level (1000, 1100, 1200... XP in survival; 1500, 1900, 2300... in versus; drops scale with `xpMultiplier`) gives +30% of the starting HP (healed right away)
and one upgrade point:

| Key | Track | Per rank |
|---|---|---|
| 1 | Weapon | +15% damage, +10% attack speed |
| 2 | Mobility | +8% move speed, -8% dash cooldown |
| 3 | Ability | +12% range/radius, +10% speed, +20% power, -6% cooldown |

## Power-ups

Enemies drop a power-up with a 5% chance (8 s buffs):
damage (randomly x4 damage or x4 attack speed), speed (x2.5 move speed, 0.2 s dash cooldown),
wipe (kills every non-boss enemy and enemy bullet within 900 units).

## Difficulty

Every run starts at the same baseline whatever the difficulty. Spawn rate, enemy count,
HP, damage, fire rate, movement, bullet speed and grunt accuracy then ramp up with your progress
and peak at level 10 (at `difficultyGrowthRate: 1`). The chosen difficulty (1-30) sets how high that peak is; at 30 about
60+ enemies hunt you with perfectly leading shots. Coefficients: `CONFIG.difficulty`.

Enemy speed multiplies enemy movement and enemy bullet speed. The player is not affected.

## Enemies

| Kind | Behaviour |
|---|---|
| Grunt (red) | Keeps medium distance, shoots medium-speed bullets roughly at you (random spread, no leading) |
| Rusher (orange) | Fast, rams you for contact damage, then bounces back |
| Sniper (purple) | Small body, low HP, laser sight, fast bullets that lead your movement, gives 1.5x XP |

Enemies spawn only where no player can see them and walk in from off-screen.
Some spawn as **elites** (gold ring): 5x HP, 5x XP. Any enemy drops a **heal** (+10% HP) with a 10% chance.

## Bosses

One boss at a time, every N regular kills (fewer on higher difficulty), in rotation:

| Boss | Behaviour |
|---|---|
| Colossus | Huge and slow. Charges up and fires a slow ball about half a screen wide |
| Duelist | Darts left and right in short bursts, fires fast shots that lead your movement |
| Blademaster | Closes in fast, telegraphs a wide sword swing (red zone), then leaps back |

Bosses cannot be pulled by the hook and always drop a heal.

## Versus AI

A MOBA-like match on a bigger map (5200 x 5200), you (blue) against an AI player (red).
The map is split along the diagonal: blue owns the bottom-left half, red the top-right half,
with a neutral band in the middle. Three lanes connect the bases: top, mid and bot.

- **Nexus.** Each side has a main building in its corner. Only players of level 10+ can damage the enemy one.
  Every lost third (at 2/3, 1/3 and 0 HP) summons a random guardian boss (Colossus, Duelist, Blademaster,
  never the same one twice). While a guardian lives the nexus takes no damage. Destroy the nexus and kill its
  last guardian to win. Guardians stay near their base and do not chase further than the middle of their half.
- **Waves.** Every 30 s each base sends 6 mobs down each lane. They fight the enemy mobs and mostly die in the
  neutral zone; mobs deal +25% damage on their own half, so no side pushes deep without a player.
- **Farmers.** Harmless NPCs (straw hats) wandering around each nexus. They run away and give the most XP.
- **XP.** Everything drops XP: mobs a little, players more, farmers the most. You cannot pick up drops of your own team.
- **Intruders.** On enemy ground the nearby enemy mobs switch to you, some of your own mobs from the same lane come
  to escort you, and the longer you stay the bigger the enemy defender squads and the harder the AI tries to push you out.
- **AI player.** When you are on your half it pushes with the waves, farms, levels up, and at level 10 sieges your
  nexus; when you intrude it comes back to defend. It dodges bullets with dashes and spends upgrade points.
- **Death.** You respawn at your base after 5 s + 3 s per level, with 1.5 s of spawn protection.

The HUD shows both nexuses (with guardian marks), the match clock, a minimap (top right) and a respawn countdown.

## Structure

```
game.config.json          Main balance knobs: "name": number
packages/shared/          Pure game simulation: no DOM, runs in a browser or Node
  src/server.config.ts    Reads game.config.json, holds the defaults
  src/config.ts           Detailed tuning (ranges, timings, AI, XP curve, arena, lanes)
  src/types.ts            Entities, PlayerInput, GameEvent, WorldView
  src/world.ts            World: owns the entities, step(dt), events
  src/progression.ts      XP curve (1000, 1100, 1200...)
  src/difficulty.ts       Settings + progress -> difficulty ramp modifiers
  src/stats.ts            Player stats from upgrade ranks and buffs
  src/map.ts              Tetromino walls: generation, collision, raycasts, pathfinding
  src/arena.ts            Versus layout: territories, neutral band, lanes, bases
  src/history.ts          Run summary (history log entry) builder
  src/ai/bot.ts           AI player: produces PlayerInput like a human would
  src/systems/            players (upgrades, buffs, move, dash, regen, respawn), weapons, abilities,
                          hook, enemies (AI), projectiles, orbs, power-ups, spawner (survival),
                          arena (versus waves, farmers, defenders), targets (who can hit whom)
apps/client/              Browser client (Vite + TypeScript + Canvas 2D)
  src/session/            GameSession interface + LocalSession (runs World in the browser)
  src/input/              Keyboard/mouse -> PlayerInput
  src/render/             Camera, Canvas renderer, HUD, effects, icons, team colors,
                          versus ground and nexus (Arena.ts), minimap
  src/ui/                 Start screen (loadout, settings, Play), Esc menu, training panel
  src/history/            Sends finished runs to the history endpoint
  dev/historyLog.ts       Vite plugin: POST /api/history -> logs/history.jsonl
```

## Multiplayer path

The client never touches game rules directly. It only does three things:

1. It sends a `PlayerInput` every frame (`session.sendInput`).
2. It reads a read-only `WorldView` to draw it.
3. It reacts to `GameEvent`s (effects, sounds).

To go multiplayer:

1. Add `apps/server` (Node + `uWebSockets.js` or `ws`) that owns a `World`, calls
   `world.step()` at a fixed rate (20-30 Hz), applies client inputs with `world.setInput()`
   and broadcasts snapshots and events.
2. Add `NetworkSession implements GameSession` on the client. It sends inputs over a
   WebSocket and builds a `WorldView` from snapshots, interpolating remote entities and
   predicting the local player.
3. Replace `new LocalSession()` with `new NetworkSession(url)` in `main.ts`.

`packages/shared` has no DOM types on purpose (see its `tsconfig.json`), so it stays
server-compatible. Collisions for fast objects are swept, so lower server tick rates are safe.
