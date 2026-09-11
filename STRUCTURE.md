# Где что лежит

Короткая шпаргалка: какой файл за что отвечает и куда лезть, чтобы что-то поменять.

## Два слоя

- **`packages/shared/src/`** — вся игровая логика: движение, бой, враги, опыт. Здесь нет браузера и отрисовки, этот же код потом запустится на сервере.
- **`apps/client/src/`** — всё, что видит игрок: отрисовка, клавиатура и мышь, меню, HUD.
- **`apps/server/src/`** — игровой сервер для онлайна: вход, очередь, матчи, рейтинг. Как запустить и задеплоить — [MULTIPLAYER.md](MULTIPLAYER.md).
- **`game.config.json`** (в корне) — главные цифры баланса: `"название": число`.

Клиент ничего не решает сам. Он отправляет в симуляцию нажатые клавиши (`PlayerInput`), читает состояние мира и рисует его.

## Один тик игры

`World.step()` в `packages/shared/src/world.ts` 60 раз в секунду вызывает системы строго по порядку:

0. (один раз при создании мира) `GameMap.generate` в `map.ts` — расставляет стены-тетрамино; в режиме Versus ещё `setupArena` в `systems/arena.ts` — нексусы, башни и фермеры
1. `BotBrain.update` в `ai/bot.ts` — ИИ-игрок решает, что «нажать» (тот же `PlayerInput`, что у человека)
2. `updatePlayers` — прокачка, баффы, движение, рывок, реген, оружие, нажатие способности, воскрешение
3. `updateAbilities` — полёт и притягивание крюка, таймер щита
4. `updateEnemies` — ИИ мобов, их выстрелы и удары
5. `separateEnemies` — мобы расталкивают друг друга
6. `updateTowers` (только Versus) — башни выбирают цель и стреляют
7. `updateProjectiles` — полёт пуль и попадания
8. `updateOrbs` — опыт, хилки и усиления летят к игроку
9. `updateSpawner` (выживание) или `updateArena` (Versus) — появление врагов, боссы / волны, фермеры, защитники

Когда в Versus кто-то победил, `step` замораживает игру (время идёт только для эффектов).

## Настройки (что крутить в первую очередь)

| Что | Файл |
|---|---|
| Главные цифры: урон, скорости, рывок, рост сложности, опыт, воскрешение, нексус, волны, фермеры, логи | `game.config.json` в корне (только `"название": число`) |
| Значения по умолчанию и чтение `game.config.json` | `packages/shared/src/server.config.ts` (`FALLBACK`) |
| Всё остальное: радиусы, кулдауны, HP врагов, тайминги ИИ, боссы, дроп, опыт за уровень, размер карты Versus, ширина линий | `packages/shared/src/config.ts` (`arena`, `versus`) |
| Как сложность 1–30 превращается в число врагов, их HP, урон, точность | `packages/shared/src/difficulty.ts` |

## Игровая логика (`packages/shared/src/`)

| Хочу поменять | Файл → функция |
|---|---|
| Движение игрока, рывок, реген (и постоянный реген с мечом — `swordRegenPercent` в конфиге) | `systems/players.ts` → `move`, `handleDashRequest`, `regenerate` |
| +30% HP за уровень | `world.ts` → `grantXp` (доля — `config.ts` → `progression.hpPerLevel`) |
| Стены: генерация, плотность, форма фигур | `map.ts` → `generate`, `TETROMINOES` (плотность — `server.config.ts` → `obstacleDensity`) |
| Столкновения со стенами, лучи, «видит ли» | `map.ts` → `resolveCircle`, `raycast`, `lineOfSight` |
| Как враги обходят стены | `map.ts` → `buildFlowField`, `nextStep`; кэш — `world.ts` → `pathStepTo`; выбор пути — `systems/enemies.ts` → `navigate` |
| Как враги распределяются вокруг игрока | `systems/enemies.ts` → `slotPoint` (у каждого своё место `slotAngle`) и спавн с пустой стороны — `systems/spawner.ts` → `findHiddenSpawnPoint` |
| Прокачка по кнопкам 1/2/3 | `systems/players.ts` → `applyUpgradeRequests`; начисление очков — `world.ts` → `grantXp`, `upgrade` |
| Как ранги и баффы влияют на урон, скорость атаки, скорость, рывок | `stats.ts` |
| Оружие: пушка, меч, луч | `systems/weapons.ts` → `fireGun`, `swingSword`, `updateBeam` |
| Меч срезает пули во время взмаха (кроме атак боссов) | `systems/weapons.ts` → `cutProjectiles` |
| Способности: щит, дробь | `systems/abilities.ts` → `tryUseAbility`, `fireShotgun`, `shieldCovers` |
| Крюк | `systems/hook.ts` |
| Движение и стрельба врагов | `systems/enemies.ts`: `updateShooter` (обычный стрелок, снайпер, Колосс), `updateRusher`, `updateDuelist`, `updateBlademaster` |
| Прицеливание врагов (упреждение, разброс) | `systems/enemies.ts` → `updateAttack`, `leadAngle` |
| Скорость врагов и их пуль | `systems/enemies.ts` → `enemySpeed`, `bulletSpeed` (базы в `server.config.ts`) |
| Где и сколько появляется врагов, когда приходит босс | `systems/spawner.ts` |
| Попадания пуль | `systems/projectiles.ts` |
| Опыт, хилки, усиления: притягивание и подбор | `systems/orbs.ts` |
| Что делают усиления (урон ×4, скорость, вайп) | `systems/powerups.ts` |
| Урон по игроку, смерть | `world.ts` → `damagePlayer` |
| Урон по врагу, смерть врага, дроп | `world.ts` → `damageEnemy`, `killEnemy` |
| Создание врага, элитки | `world.ts` → `spawnEnemy` |
| Опыт до следующего уровня | `world.ts` → `xpToNext` (выживание — `progression.ts` → `xpToNextLevel`, Versus — `versusLevelXp` в конфиге) |
| Запись в историю забегов | `history.ts` → `buildRunSummary` |
| Кто кого может бить (команды), урон по любой цели | `systems/targets.ts` → `forEachHostile`, `damageTarget` |
| Все типы данных: игрок, враг, пуля, нексус, команды, события, ввод | `types.ts` |
| Математика: векторы, конусы, попадания | `math/vec2.ts` |

## Режим Versus (`packages/shared/src/`)

| Хочу поменять | Файл → функция |
|---|---|
| Разметка карты: половины, нейтральная полоса, линии top/mid/bot, базы, точки спавна | `arena.ts` → `createArenaLayout`, `territoryAt`, `lanePath`; размеры — `config.ts` → `arena` |
| Нексус: неуязвимость при живом страже, 3 этапа, какой босс, победа | `world.ts` → `isNexusShielded`, `damageNexus`, `summonGuardian`, `onGuardianKilled` |
| Где стоят башни (сколько на линии, насколько далеко от центра) | `arena.ts` → `towerSpots`; числа — `config.ts` → `versus.outerTowerPosition`, `innerTowerPosition`, `towerSideOffset`; количество — `towersPerLane` в конфиге |
| В кого стреляет башня (мобы, игрок, «защита союзника») | `systems/towers.ts` → `pickTarget` |
| Урон по башне, её падение: +1 уровень врагу, взрыв, вычищающий мобов | `world.ts` → `damageTower`, `destroyTower` |
| Мобы идут бить башни и нексус, когда рядом нет врагов | `systems/enemies.ts` → `chooseTarget` (пункт 3) |
| Аура стража, которая сжигает мобов, и неуязвимость боссов к мобам | `systems/enemies.ts` → `burnAura`; `world.ts` → `damageEnemy` |
| Урезанный опыт (жёлтые шарики) и отключённые усиления в Versus | `world.ts` → `killEnemy` (доля — `nonPlayerKillXpMultiplier` в конфиге) |
| Снайперы: дальность, стрельба сквозь стены и здания | `config.ts` → `enemies.sniper`; `systems/enemies.ts` → `updateShooter`, `SNIPER_SCREEN_REACH`; пролёт сквозь здания — `systems/projectiles.ts` → `hitSomething` |
| Волны мобов по линиям, фермеры и их респаун | `systems/arena.ts` → `updateArena`, `spawnWave`, `spawnFarmer`, `respawnFarmers`; состав волны — `config.ts` → `versus.waveComposition` |
| Реакция на игрока на чужой территории: защитники, свои мобы-сопровождение | `systems/arena.ts` → `sendDefenders`, `callEscorts` |
| Кого выбирает целью моб (нарушитель, ближайший враг, нексус) | `systems/enemies.ts` → `chooseTarget` |
| Марш мобов по линии, сопровождение своего игрока | `systems/enemies.ts` → `march`, `joinNearestLane` |
| Поведение фермера (бродит у нексуса, убегает) | `systems/enemies.ts` → `updateFarmer` |
| Боссы-стражи не уходят далеко от базы | `systems/enemies.ts` → `leash` (радиус — `config.ts` → `versus.bossLeash`) |
| Бонус урона мобов на своей половине | `systems/enemies.ts` → `mobDamage` (`homeDefenseBonus` в конфиге) |
| Смерть и воскрешение игрока, опыт за убийство игрока | `world.ts` → `killPlayer`, `respawnPlayer` |
| ИИ-игрок: когда пушит, защищается, отступает, осаждает | `ai/bot.ts` → `think` (состояния `push` / `defend` / `retreat` / `siege` / `raid`; осада начинается, когда на линии снесены обе башни) |
| ИИ-игрок и башни: когда бить башню, как не стоять под её огнём | `ai/bot.ts` → `canHitTower`, `towerThreat` |
| ИИ-игрок: выбор цели, движение, стрельба, уклонение рывком, прокачка | `ai/bot.ts` → `pickTarget`, `move`, `attack`, `dodge`, `spendUpgrades` |
| Насколько хорошо играет ИИ | `ai/bot.ts` → конструктор (`skill` из ползунка сложности) |

## Клиент (`apps/client/src/`)

| Хочу поменять | Файл → функция |
|---|---|
| Главный цикл: старт, рестарт, смерть, победа, выход в меню | `main.ts` → `startGame`, `frame`, `leaveToMenu` |
| Кто играет за красных в Versus AI, его оружие | `session/LocalSession.ts` (бот с `bot: true`) |
| Клавиши и мышь | `input/InputController.ts` (`DIRECTION_KEYS`, `DASH_KEYS`, `UPGRADE_KEYS`) |
| Как рисуются игрок, враги, пули, орбы | `render/Renderer.ts` → `drawPlayer`, `drawEnemy`, `drawEnemyWeapon`, `drawProjectile`, `drawOrb` |
| Плашка игрока: рамка HP, значок уровня слева, имя | `render/Renderer.ts` → `drawPlayerPlate` |
| Какие шарики опыта видны (свои дропы, которые не подобрать, скрыты) | `render/Renderer.ts` → `render` (цикл по `view.orbs`) |
| Как рисуются стены и их цвета | `render/Renderer.ts` → `drawWalls`, `WALL_COLORS` |
| Цвета | `render/Renderer.ts` → `COLORS`; цвета команд, игроков и мобов — `render/teams.ts` (`TEAM_COLORS`, `PLAYER_STYLE`, `RED_MOBS`, `BLUE_MOBS`) |
| Карта Versus: подсветка половин, линии, базы, нексус, башни и их радиус | `render/Arena.ts` → `drawArenaGround`, `drawNexus`, `drawTower` |
| Аура стража, жёлтые шарики опыта | `render/Renderer.ts` → `drawGuardianAura`, `drawOrb` |
| Миникарта | `render/Minimap.ts` |
| Предупреждения врагов (лазер снайпера, красная зона Blademaster) | `render/Renderer.ts` → `drawEnemyTelegraph` |
| HUD: уровень, HP, опыт, слоты, карточки прокачки, полоса босса, полосы нексусов, таймер воскрешения | `render/Hud.ts` (`drawNexusBars`, `drawRespawnOverlay`) |
| Всплывающие цифры урона, выстрелы башен, взрыв башни, баннеры (босс, страж, башня, победа), счётчик DPS | `render/Effects.ts` |
| Иконки оружия и способностей | `render/icons.ts` |
| Камера и зум | `render/Camera.ts` |
| Стартовый экран: выбор оружия, ползунки | `ui/StartScreen.ts`, вёрстка — `index.html`, стили — `style.css` |
| Названия и описания оружия и способностей | `ui/loadoutInfo.ts` |
| Меню по Esc | `ui/PauseMenu.ts` |
| Панель тренировочной комнаты | `ui/TrainingPanel.ts` |
| Где запускается симуляция (локально или по сети) | `session/LocalSession.ts`, `session/NetworkSession.ts`, интерфейс — `session/GameSession.ts` |
| Отправка истории забегов | `history/HistoryReporter.ts`; запись в файл — `apps/client/dev/historyLog.ts` |

## Онлайн 1v1

| Хочу поменять | Файл → функция |
|---|---|
| Рейтинг: старт, +за победу, −за поражение | `game.config.json` → `startRating`, `ratingWin`, `ratingLoss` |
| Кто с кем играет (очередь, матчмейкинг) | `apps/server/src/lobby.ts` → `enqueue`, `matchmake` |
| Сколько ждать отключившегося игрока, что происходит при выходе | `apps/server/src/match.ts` → `RECONNECT_GRACE_MS`, `surrender`, `checkDropped` |
| Начисление рейтинга после матча | `apps/server/src/match.ts` → `end` |
| Вход через GitHub / Google | `apps/server/src/oauth.ts`; ключи — переменные окружения (см. MULTIPLAYER.md) |
| Где хранятся игроки и рейтинг | `apps/server/src/store.ts` → `users.json` в `DATA_DIR` |
| Какие сообщения ходят между клиентом и сервером | `packages/shared/src/net/protocol.ts` (при изменении подними `PROTOCOL_VERSION`) |
| Что попадает в снимок мира | `packages/shared/src/net/snapshot.ts` → `encodeSnapshotBody`, `decode*` |
| Частота снимков, задержка интерполяции | `protocol.ts` → `TICKS_PER_SNAPSHOT`; `apps/client/src/session/NetworkSession.ts` → `MIN_INTERP_DELAY`, `MAX_INTERP_DELAY`, `measureClock` |
| Предсказание своего движения и выстрелов, сглаживание поправок | `NetworkSession.ts` → `predictStep`, `spawnGhost`, `updateGhosts`, `reconcile`, `buildPlayers` |
| Мгновенные «мультяшные» урон, смерть мобов, подбор опыта, срезание пуль; чужие пули «в твоём времени» | `apps/client/src/session/Anticipation.ts` (сроки отката — константы вверху файла) |
| Мгновенный щит и дробовик | `NetworkSession.ts` → `predictAbility` |
| Карточка «Online 1v1» в меню (вход, Find match, пинг) | `apps/client/src/ui/OnlinePanel.ts` |
| Пинг и имена в HUD, плашка «соперник отключился» | `render/Hud.ts` → `drawNetInfo`, `drawNetStatus` |
| Адрес игрового сервера для клиента | `apps/client/src/net/serverUrl.ts` (или `VITE_GAME_SERVER_URL` в Vercel) |
| Какие страницы пускает сервер | `fly.toml` → `CLIENT_ORIGINS` |

## Рецепты

**Новый обычный враг:**

1. `types.ts` — добавь имя в `RegularEnemyKind` и `REGULAR_ENEMY_KINDS`.
2. `config.ts` — блок в `enemies` (HP, радиус, опыт, вес спавна, атака).
3. `server.config.ts` — поле `<имя>SpeedMultiplier` в `ServerConfig` и `FALLBACK`; если стреляет, то и `<имя>BulletSpeedMultiplier`. Эти же строки можно добавить в `game.config.json`.
4. `systems/enemies.ts` — ветка в `switch` внутри `updateEnemies`.
5. `render/teams.ts` — цвета в `RED_MOBS` (и при желании в `BLUE_MOBS`), внешний вид — `render/Renderer.ts` → `drawEnemyWeapon`.
6. Чтобы он ходил в волнах Versus — добавь его в `config.ts` → `versus.waveComposition`.
7. По желанию: кнопка в `ui/TrainingPanel.ts` (`SPAWNS`).

**Новое оружие:**

1. `types.ts` — добавь имя в `WeaponType` и `WEAPON_TYPES`.
2. `server.config.ts` — поле урона (`<имя>Damage`) в `ServerConfig` и `FALLBACK`, строка в `game.config.json`; `config.ts` — кулдаун и дальность в `weapons`.
   Чтобы им пользовался ИИ-игрок — дистанции в `ai/bot.ts` → `WEAPON_RANGE`.
3. `systems/weapons.ts` — ветка в `updateWeapon`.
4. `render/Renderer.ts` → `drawWeapon`, `render/icons.ts` → `drawIcon`.
5. `ui/loadoutInfo.ts` — название и описание; `render/Hud.ts` → `weaponStatLine`.

**Новая способность** делается так же, только вместо `weapons.ts` правится `systems/abilities.ts` → `tryUseAbility`.

## Проверка после правок

```bash
npm run typecheck   # TypeScript подсветит всё, что ты забыл обновить
npm run dev         # запусти и проверь в тренировочной комнате
npm run dev:server  # (второй терминал) локальный сервер, чтобы проверить онлайн: два окна → Play as guest → Find match
```

Если добавил новый тип (врага, оружие) и забыл прописать его в таблицах цветов, названий или иконок, `typecheck` покажет, где именно. Ветки в `switch` в системах (`updateEnemies`, `updateWeapon`) он не проверяет, их пройди по рецепту выше.
