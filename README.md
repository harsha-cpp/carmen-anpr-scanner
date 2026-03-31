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

### 2. set up postgresql

start a postgres instance on port 5434 (or change the DATABASE_URL in the env file):

```bash
# using docker
docker run -d --name adarecog-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=adarecog_phase1 \
  -p 5434:5432 \
  postgres:15

# or use your existing postgres and create the database
createdb -p 5434 adarecog_phase1
```

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

```bash
npm --workspace @adarecog/api run prisma:generate
npm --workspace @adarecog/api run db:migrate -- --name init
npm --workspace @adarecog/api run seed:admin
```

this creates the schema and seeds a default admin user. default credentials from `.env.example`:
- email: `admin@example.com`
- password: `ChangeMe123!`

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
