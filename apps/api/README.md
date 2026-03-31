# apps/api

Phase 1 central backend foundation.

## endpoints

- `GET /health`
- `GET|POST /api/auth/*`
- `POST /api/devices/register`
- `GET /api/devices`
- `POST /api/devices/pairings`
- `POST /api/telemetry/heartbeat`
- `GET /api/telemetry/device/:deviceId`
- `POST /api/ingest/detections`
- `POST /api/ingest/match-events`
- `GET /api/sync/contracts`
- `GET /api/sync/hitlists/:hitlistId`
- `GET|POST /api/sync/cursors`
- `POST /api/hitlists`
- `GET /api/hitlists`
- `GET /api/hitlists/:hitlistId`
- `POST /api/hitlists/:hitlistId/versions`
- `GET /api/hitlists/:hitlistId/versions`

## local setup

1. copy `.env.example` to `.env`
2. start PostgreSQL
3. run `npm install`
4. run `npm --workspace @adarecog/api run prisma:generate`
5. run `npm --workspace @adarecog/api run db:migrate -- --name init`
6. run `npm --workspace @adarecog/api run seed:admin`
7. run `npm --workspace @adarecog/api run dev`

## admin bootstrap

The seed script creates one admin user using these env vars:

- `SEED_ADMIN_EMAIL`
- `SEED_ADMIN_PASSWORD`
- `SEED_ADMIN_NAME`
- `SEED_ADMIN_USERNAME`
