# WorkApp — Telecommunications Crew Management System

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
