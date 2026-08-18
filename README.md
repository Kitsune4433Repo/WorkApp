# WorkApp — Telecommunications Crew Management System

Native Android + web fallback field crew management system, backed by a shared PostgreSQL/PostGIS
API. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full system design.

```
android/   Native Kotlin field app (Compose, Room, WorkManager, Hilt)
web/       React + TypeScript + Tailwind dispatcher portal / iOS fallback
backend/   Node.js + TypeScript + Express + Socket.IO API
database/  PostgreSQL + PostGIS schema
docs/      Architecture documentation
```

## Quick start

```bash
# Database
psql $DATABASE_URL -f database/migrations/001_init.sql

# Backend
cd backend && cp .env.example .env && npm install && npm run dev

# Web portal
cd web && npm install && npm run dev
```

The Android app is a standard Gradle project — open `android/` in Android Studio.
