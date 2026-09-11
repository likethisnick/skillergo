# Онлайн 1v1: как это устроено и как запустить

## Как устроено

```
Браузер (Vercel)                         Игровой сервер (Fly.io)
apps/client                              apps/server
  OnlinePanel  "Find match"  ──WS──▶      Lobby: вход, очередь, первые двое → матч
  NetworkSession  инпуты 60/с ──WS──▶     Match: World (тот же код, что в игре), 60 тиков/с
               ◀── снапшоты 30/с ──       users.json на диске (рейтинг)
  "Sign in with GitHub/Google" ──HTTP──▶  /auth/... (OAuth)
```

- **Сервер решает всё.** Клиент шлёт только нажатые кнопки (`PlayerInput`), сервер крутит `World` и 30 раз в секунду рассылает снимок мира.
- **Своё движение без задержки.** Клиент сразу двигает своего персонажа тем же кодом (`stepMovement` из `systems/players.ts`), а когда приходит ответ сервера, пересчитывает неподтверждённые инпуты поверх него. Расхождения на тестах с пингом 66 мс — до 4 пикселей, их не видно.
- **Всё остальное рисуется на 0.1 с в прошлом.** Между двумя снимками идёт плавная интерполяция: мобы, пули и соперник двигаются ровно даже при скачущем пинге.
- **Рейтинг:** старт 1300, победа +20, поражение −20 (`startRating`, `ratingWin`, `ratingLoss` в `game.config.json`). При поиске рейтинг не учитывается: матч получают первые двое в очереди.
- **Выход из матча = поражение.** Если у игрока пропал интернет, у него есть 30 секунд, чтобы вернуться (достаточно открыть страницу заново), иначе победа уходит сопернику.
- **Версии.** Клиент и сервер сверяют «отпечаток» кода и баланса (`buildFingerprint`). Если после правок в `game.config.json` задеплоен только клиент, в меню будет написано, что сервер на другой версии. Лечится деплоем сервера (с GitHub Action ниже он деплоится сам).

## Локально (без аккаунтов)

```bash
npm install            # один раз: подтянет ws, esbuild, tsx и обновит package-lock.json
npm run dev:server     # терминал 1: сервер на :8080 (вход «Play as guest» включён)
npm run dev            # терминал 2: клиент на :5173
```

Открой игру в обычном окне и в инкогнито, в обоих нажми **Play as guest**, потом **Find match**.
Рейтинги локального сервера лежат в `apps/server/data/users.json` (в git не попадает).

## Продакшн: один раз настроить

Везде ниже имя приложения — `skillergo-server`. Если оно на Fly занято, возьми другое и поменяй его в `fly.toml` (`app`, `PUBLIC_URL`) и в `apps/client/src/net/serverUrl.ts` (`PRODUCTION_SERVER`). Вместо правки файла можно задать в Vercel переменную `VITE_GAME_SERVER_URL`.

### 1. Fly.io

```powershell
iwr https://fly.io/install.ps1 -useb | iex      # установить flyctl (PowerShell)
fly auth login                                    # или fly auth signup
cd C:\skillergo\skillergo
fly apps create skillergo-server
fly volumes create skillergo_data --region fra --size 1 -a skillergo-server   # на вопрос про один volume ответить y
```

### 2. Вход через GitHub

GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App:

- Homepage URL: адрес игры на Vercel
- Authorization callback URL: `https://skillergo-server.fly.dev/auth/github/callback`

Потом **Generate a new client secret**. Понадобятся Client ID и Client secret.

### 3. Вход через Google

[console.cloud.google.com](https://console.cloud.google.com) → создать проект → **Google Auth Platform**:

- **Branding:** название игры и твоя почта.
- **Audience:** External. Пока приложение в режиме Testing, войти могут только добавленные test users: добавь себя и друга. Либо нажми **Publish app** (для имени и аватарки проверка Google не нужна).
- **Clients** → Create client → Web application → Authorized redirect URIs: `https://skillergo-server.fly.dev/auth/google/callback`

Понадобятся Client ID и Client secret.

### 4. Секреты и первый деплой

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # скопируй вывод в SESSION_SECRET
fly secrets set -a skillergo-server SESSION_SECRET=<вывод> GITHUB_CLIENT_ID=<...> GITHUB_CLIENT_SECRET=<...> GOOGLE_CLIENT_ID=<...> GOOGLE_CLIENT_SECRET=<...>
fly deploy
```

Проверка: `https://skillergo-server.fly.dev/` должен ответить `Skillergo game server · build ...`.
Можно настроить только GitHub или только Google: кнопка появится только для того, у которого есть ключи.
`SESSION_SECRET` не меняй без нужды: при смене все разлогинятся.

### 5. Автодеплой сервера из GitHub

```powershell
fly tokens create deploy -a skillergo-server
```

GitHub → репозиторий → Settings → Secrets and variables → Actions → New repository secret: `FLY_API_TOKEN` = вывод команды.
После этого `.github/workflows/deploy-server.yml` сам деплоит сервер на каждый push в `main`, если менялись `apps/server`, `packages/shared` или `game.config.json`. Клиент, как и раньше, деплоит Vercel.

### 6. Vercel

Если адрес Vercel не подходит под `https://skillergo-client-16y6*.vercel.app`, допиши его в `CLIENT_ORIGINS` в `fly.toml` (через запятую) и задеплой сервер. Иначе сервер не пустит страницу (WebSocket 403, «Server is offline»).

## Если что-то не так

| Симптом | Причина |
|---|---|
| «Server is offline or waking up» дольше ~15 с | `fly status`, `fly logs -a skillergo-server`; адрес страницы не в `CLIENT_ORIGINS` |
| «The server runs a different version of the game» | Сервер не задеплоен после правок `packages/shared` / `game.config.json` |
| GitHub/Google: redirect_uri mismatch | Callback URL у провайдера не совпадает с `PUBLIC_URL` + `/auth/<provider>/callback` |
| «This page is not allowed to log in here» | Адрес страницы не в `CLIENT_ORIGINS` |
| Рейтинг сбросился после деплоя | Не создан volume `skillergo_data` (без него файл живёт до перезапуска) |

Сервер держит матчи и очередь в памяти, поэтому нужна **ровно одна** машина: `fly scale count 1 -a skillergo-server`.
Машина засыпает, когда никто не подключён, и просыпается за несколько секунд при первом заходе.
