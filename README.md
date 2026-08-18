# Crew Hub — Telecommunications Crew Management System

[![CI](https://github.com/Kitsune4433Repo/WorkApp/actions/workflows/ci.yml/badge.svg)](https://github.com/Kitsune4433Repo/WorkApp/actions/workflows/ci.yml)

Native Android + web fallback field crew management system, backed by a shared PostgreSQL/PostGIS
API. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system design.

```
android/   Native Kotlin field app (Compose, Room, WorkManager, Hilt)
web/       React + TypeScript + Tailwind dispatcher portal / iOS fallback
backend/   Node.js + TypeScript + Express + Socket.IO API
database/  PostgreSQL + PostGIS schema
docs/      Architecture documentation
```

## Deploy to Render (one click, no local setup)

`render.yaml` at the repo root is a [Render Blueprint](https://render.com/docs/blueprint-spec) —
it provisions everything (Postgres, the backend API, the web portal as a static site) from this
one file, with no credentials shared with anyone else:

1. Push/fork this repo to your own GitHub account (Render deploys from a repo you connect).
2. On [render.com](https://render.com): **New → Blueprint**, connect the repo, **Apply**.
3. Wait for all three resources to go live (a few minutes on first deploy — the free web service
   tier also cold-starts after inactivity, so the first request after a quiet period is slow).
4. Open the `crew-management-web` service's URL. Log in with `admin@crewops.dev` / `password123`
   (seeded automatically on first boot — see `AUTO_MIGRATE`/`SEED_DEMO_DATA` below), then use the
   **Users** page (admin-only) to create your own account instead of using the demo one.

The database starts completely empty; `backend/src/db/bootstrap.ts` applies `database/schema.sql`
(and `database/seed.sql`, for the demo accounts) automatically on the API's first boot — there's no
shell access on Render to run `psql -f` by hand otherwise. This is gated behind `AUTO_MIGRATE`/
`SEED_DEMO_DATA` env vars, both `true` in `render.yaml` for this convenience; leave them `false`
(the default) for a real production deploy with real data.

Document/photo uploads won't work until `crew-management-api`'s `OBJECT_STORE_*` env vars are
pointed at a real S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2, ...) — everything else
(auth, jobs, inventory, timecards, chat, knowledge base) works without it. See the comments at the
top of `render.yaml` for exactly what to fill in and why.

I haven't been able to test `render.yaml` against a live Render account — I don't have one. If the
dashboard rejects a field on "Apply", the error is specific and usually a one-line fix (paste it
back to me, or check [Render's Blueprint docs](https://render.com/docs/blueprint-spec) for the
current field name).

## Quick start (Docker Compose)

Brings up PostGIS (seeded with demo users/materials/a job), MinIO as a local S3-compatible object
store, and the backend API — everything the web portal and Android app need to run against.

```bash
docker compose up --build
# API:            http://localhost:4000
# MinIO console:  http://localhost:9001  (crew-minio / crew-minio-secret)
```

Demo accounts (see `database/seed.sql`), all with password `password123`:
`admin@crewops.dev`, `dispatch@crewops.dev`, `lead@crewops.dev`, `tech1@crewops.dev`.

Then, in a separate terminal:

```bash
cd web && npm install && npm run dev   # http://localhost:5173, proxies /api to :4000
```

The Android app points at a real HTTPS host by default (`NetworkModule.BASE_URL`); for local dev
against `docker compose`, either point it at `http://10.0.2.2:4000/api/` (emulator) and add a
cleartext exception in `network_security_config.xml`, or run the backend behind a TLS-terminating
tunnel.

## Manual setup (without Docker)

```bash
# Database (requires a local PostgreSQL with the postgis extension available)
psql $DATABASE_URL -f database/migrations/001_init.sql
psql $DATABASE_URL -f database/seed.sql   # optional demo data

# Backend
cd backend && cp .env.example .env && npm install && npm run dev

# Web portal
cd web && npm install && npm run dev
```

The Android app is a standard Gradle project — open `android/` in Android Studio. It needs
`android/app/google-services.json` replaced with a real Firebase config before push notifications
will work; the committed one is a placeholder that lets the project build.

## Tests

```bash
cd backend && npm test              # vitest — geofence math, tamper detection, JWT issuance,
                                     # additive-conflict resolution
cd android && ./gradlew testDebugUnitTest   # JVM unit tests — on-device geofence evaluator
```
