# adarecog

vehicle surveillance and ANPR platform. monorepo with a central API, admin portal, workstation runtime agent, and an existing ANPR scanner.

## prerequisites

- node.js v22+ (v24 recommended)
- npm 10+
- postgresql 15+
- ffmpeg (for workstation camera capture)

## repo structure

```
apps/
  api/                 # hono REST API — auth, device registry, hitlist management, sync, ingest
  web/                 # next.js admin portal — dashboard, alerts, watchlist, analytics, settings
  workstation-agent/   # node.js edge runtime — camera, OCR, local matching, TTS, tablet bridge
  ws-server/           # websocket relay (unused in dev)
fe/
  survilience/         # legacy vite frontend (deprecated, replaced by apps/web)
```

## first-time setup

### 1. clone and install

```bash
git clone https://github.com/kaizen403/carmen-anpr-scanner.git
cd carmen-anpr-scanner
npm install
```

### 2. start the local services

the repo now includes a docker compose stack for local development:

```bash
docker compose up --build db api web
```

if you need the realtime websocket scanner service as well:

```bash
docker compose --profile scanner up --build db api web ws-server
```

the compose stack starts:

- postgres on `localhost:5434` with both `adarecog_phase1` and `carmen_anpr`
- api on `http://localhost:3003`
- web on `http://localhost:3001`
- optional ws-server on `ws://localhost:3002`

`workstation-agent` is not part of the compose stack by default because it is hardware-bound and expects local camera/ffmpeg/TTS access.
the web container talks to the api over Docker networking internally, while the browser still uses `localhost` URLs from your host.

### 3. configure environment

```bash
# api
cp apps/api/.env.example apps/api/.env
# edit apps/api/.env if you need to change database URL, ports, or admin credentials

# workstation agent
cp apps/workstation-agent/.env.example apps/workstation-agent/.env
# edit apps/workstation-agent/.env — set CAMERA_SOURCE to a video file or RTSP URL
```

### 4. initialize the database

the compose `api` service runs `db:deploy` and `seed:admin` on startup, so no separate bootstrap step is required when using docker compose.

if you are running the services directly on your host instead of compose, use:

```bash
npm --workspace @adarecog/api run prisma:generate
npm --workspace @adarecog/api run db:migrate -- --name init
npm --workspace @adarecog/api run seed:admin
```

default credentials from `.env.example`:
- email: `sibi@sibi.com`
- password: `sibi`

### 5. run everything

```bash
npm run dev
```

this starts all services via turbo:

| service | url | port |
|---|---|---|
| api | http://localhost:3003 | 3003 |
| web (portal) | http://localhost:3001 | 3001 |
| workstation-agent | (headless runtime) | ws:8089 |

### 6. open the portal

go to http://localhost:3001 — it redirects to the login page. sign in with your admin credentials.

the ANPR scanner is still available at http://localhost:3001/anpr.

## useful commands

```bash
# build all packages
npm run build

# typecheck all packages
npm run typecheck

# run only the API
npm --workspace @adarecog/api run dev

# run only the web portal
npm --workspace @adarecog/web run dev

# run only the workstation agent
npm --workspace @adarecog/workstation-agent run dev

# re-seed the admin user
npm --workspace @adarecog/api run seed:admin

# run a new database migration
npm --workspace @adarecog/api run db:migrate -- --name your_migration_name
```

## architecture

the system follows an edge-first architecture:

- **central API** (`apps/api`) — postgres-backed hono server. handles auth, device registry, hitlist versioning, detection/match ingest, telemetry, sync cursors
- **admin portal** (`apps/web`) — next.js dashboard with glassmorphism dark UI. real-time monitoring, hitlist management, device management, alert feed
- **workstation agent** (`apps/workstation-agent`) — runs on field PCs. captures camera frames via ffmpeg, runs tesseract OCR, matches plates against a local SQLite hitlist mirror, announces alerts via TTS, syncs results to central API via outbox pattern, bridges to tablets via WebSocket
- **ANPR scanner** (`apps/web/src/app/anpr/`) — existing azure-based plate scanner, preserved and working
