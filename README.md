# Skillergo

Agar.io-like browser game. Survival, a training room, a Versus AI match (MOBA-like lanes and nexuses)
and ranked online 1v1 on the same Versus map against another human (authoritative game server, see below).

## Run

Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open http://localhost:5173. Vite also prints a LAN address, so you can open the game from a phone on the same Wi-Fi.

Other scripts:

- `npm run dev:server`: local game server for online matches on :8080 (guest login enabled)
- `npm run build`: typecheck and build the client into `apps/client/dist`
- `npm run build:server`: bundle the game server into `apps/server/dist/server.cjs`
- `npm run typecheck`: typecheck all packages

Online setup and deployment (Fly.io, GitHub / Google login), in Russian: see [MULTIPLAYER.md](MULTIPLAYER.md).

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
| `nexusHp` | Versus: nexus HP (anybody hostile can damage it, players and mobs) |
| `towersPerLane`, `towerHp`, `towerRange` | Versus: towers per lane per team, their HP and firing range |
| `towerDamage`, `towerAttackSeconds` | Versus: damage of one tower shot and seconds between shots |
| `towerBlastRadius` | Versus: a falling tower wipes the attacking mobs within this radius (2560 = two screens) |
| `guardianAuraRadius`, `guardianAuraDamagePerSecond` | Versus: the guardian boss burns hostile mobs around it |
| `nonPlayerKillXpMultiplier` | XP left when no player finished the unit off (0.4 = cut by 60%, yellow orb) |
| `waveIntervalSeconds`, `waveSize` | Versus: a wave per lane per team every 30 s, 6 mobs each |
| `homeDefenseBonus` | Versus: mobs deal +25% damage on their own half |
| `reinforcementSeconds`, `reinforcementSize` | Versus: while you stay on enemy ground, a defender squad comes every 10 s (grows over time) |
| `farmerCount`, `farmerHp`, `farmerXp`, `farmerRespawnSeconds` | Versus: farmers per base, their HP, XP and respawn time |
| `playerKillXp`, `playerKillXpPerLevel` | Versus: XP for killing a player (60 + 8 per victim level) |
| `versusLevelXp`, `versusLevelXpStep` | Versus XP curve: 1500, 1900, 2300... |
| `startRating`, `ratingWin`, `ratingLoss` | Online: rating of a new player (1300), change for a win (+20) and a loss (-20) |
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
`deaths`, `kills.players` and `kills.towers`.

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
| Sniper (purple) | Small body, low HP, laser sight, fast bullets that lead your movement, gives 1.5x XP. Shoots 1.5x farther (even from just off-screen) and through walls and buildings |

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

- **Nexus.** Each side has a main building in its corner, very tanky (30000 HP) and always vulnerable: players
  of any level and mobs can damage it. Every lost third (at 2/3, 1/3 and 0 HP) summons a random guardian boss
  (Colossus, Duelist, Blademaster, never the same one twice). While a guardian lives the nexus takes no damage.
  Destroy the nexus and kill its last guardian to win. Guardians stay near their base, do not chase further than
  the middle of their half, cannot be hurt by mobs and burn every hostile mob that comes close (aura).
- **Towers.** Two towers per lane per team, standing beside the lane on their own half. Lane mobs attack them.
  A tower shoots the nearest enemy mob; it switches to a player when no mob is around, or at once when a player
  attacks an allied player under it. When a tower falls, every player of the other team gets a whole level,
  and the blast wipes all attacking mobs within two screens, so one tower does not cascade into the next.
- **Waves.** Every 30 s each base sends 6 mobs down each lane. They fight the enemy mobs and mostly die in the
  neutral zone; mobs deal +25% damage on their own half, so no side pushes deep without a player. Mobs that
  win their fight go on to the enemy towers and then the nexus.
- **Farmers.** Harmless NPCs (straw hats) wandering around each nexus. They run away and give the most XP.
- **XP.** Everything drops XP: mobs a little, players more, farmers the most. You cannot pick up drops of your own team.
  A mob finished off by another mob, a tower or a boss leaves only 40% of its XP (a yellow orb).
  Power-ups (damage, speed, wipe) never drop in this mode; heals do.
- **Intruders.** On enemy ground the nearby enemy mobs switch to you, some of your own mobs from the same lane come
  to escort you, and the longer you stay the bigger the enemy defender squads and the harder the AI tries to push you out.
- **AI player.** When you are on your half it pushes with the waves, hits towers while its mobs tank them, farms,
  levels up, and once a lane is open (both towers down) sieges your nexus; when you intrude it comes back to defend.
  It stays out of tower fire, dodges bullets with dashes and spends upgrade points.
- **Death.** You respawn at your base after 5 s + 3 s per level, with 1.5 s of spawn protection.

The HUD shows both nexuses (towers left, guardian marks), the match clock, a minimap (top right) and a respawn countdown.
An enemy tower shows its range when you come close, in red when it is aiming at you.

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
  src/net/                Online protocol (messages, validation, build fingerprint) and snapshot encoding
  src/collision.ts        Walls + buildings collision shared by the server and client prediction
  src/systems/            players (upgrades, buffs, move, dash, regen, respawn), weapons, abilities,
                          hook, enemies (AI), projectiles, orbs, power-ups, spawner (survival),
                          arena (versus setup, waves, farmers, defenders), towers (versus tower fire),
                          targets (who can hit whom)
apps/client/              Browser client (Vite + TypeScript + Canvas 2D)
  src/session/            GameSession interface, LocalSession (runs World in the browser),
                          NetworkSession (online: prediction + snapshot interpolation)
  src/net/                WebSocket connection, snapshot-backed WorldView, login token, server URL
  src/input/              Keyboard/mouse -> PlayerInput
  src/render/             Camera, Canvas renderer, HUD, effects, icons, team colors,
                          versus ground, nexus and towers (Arena.ts), minimap
  src/ui/                 Start screen (loadout, settings, Play), online panel, Esc menu, training panel
  src/history/            Sends finished runs to the history endpoint
  dev/historyLog.ts       Vite plugin: POST /api/history -> logs/history.jsonl
apps/server/              Game server (Node + ws), deployed to Fly.io (fly.toml, Dockerfile)
  src/main.ts             HTTP (/health, /auth/*) + WebSocket (/ws)
  src/lobby.ts            Connections, hello / login, matchmaking queue, the 60 Hz loop
  src/match.ts            One 1v1 match: World, input queues, snapshots, reconnects, rating
  src/oauth.ts            GitHub / Google login (OAuth code flow)
  src/store.ts            users.json: accounts and ratings
```

## Multiplayer

The client never touches game rules directly. It only does three things:

1. It sends a `PlayerInput` every frame (`session.sendInput`).
2. It reads a read-only `WorldView` to draw it.
3. It reacts to `GameEvent`s (effects, sounds).

Online, `apps/server` owns the `World` and steps it at 60 Hz. The client (`NetworkSession`):

- turns frame input into fixed 60 Hz commands with sequence numbers; the server applies one per tick
  and returns the last applied number (`ack`) in every snapshot;
- predicts its own movement with the shared `stepMovement` and replays unconfirmed commands on top
  of each server state, blending small corrections away;
- predicts its own gun shots, sword swings and beam too (the server's copies of its bullets are hidden),
  so attacks react on the same frame;
- draws everything else slightly in the past, interpolating between snapshots (60 per second); the delay
  adapts to measured jitter (~35-50 ms on a stable connection, up to 150 ms);
- releases `GameEvent`s when the drawn time reaches them, except its own hits and level-ups, shown on arrival.

Client and server compare a fingerprint of the protocol and all balance values on connect, so a
client built from different code is asked to reload instead of desyncing.
`packages/shared` has no DOM types on purpose (see its `tsconfig.json`), so it stays server-compatible.
