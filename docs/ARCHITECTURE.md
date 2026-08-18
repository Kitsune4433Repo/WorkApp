# Telecommunications Crew Management System — Architecture

## Topology

```
android/   Native Kotlin app (Compose, Room, WorkManager, Hilt) — primary field client
web/       React + TypeScript + Tailwind — dispatcher desktop dashboard, iOS field fallback
backend/   Node.js + TypeScript + Express + Socket.IO — shared REST/WS API
database/  PostgreSQL 15 + PostGIS schema, single source of truth for both clients
```

Both clients speak the same REST contract under `/api/*` and the same JWT (access + refresh,
`Authorization: Bearer`). Every write endpoint that a field device can call offline accepts an
idempotency key (`clientTxnId` / `clientEventId` / `clientMsgId` / `clientPhotoId`) so a retried
sync never double-applies.

## Data flow: offline-first field device

```
Compose UI → Room (local write, instant) → Repository → Outbox table
                                                              │
                                              WorkManager SyncWorker (network available)
                                                              │
                                                       POST /api/... (idempotent)
                                                              │
                                                PostgreSQL (authoritative state)
                                                              │
                                          Socket.IO / FCM push → other devices
```

Inventory quantities are never stored as a single "last write wins" number on the client outbox:
`inventory_transactions` is an append-only ledger, and the *balance* is a replay of that ledger
(`resolveAdditiveConflict` in the backend). Two technicians adjusting the same material offline
both land correctly on reconnect — no lost deltas, no admin review needed for the common case.

Whole-document offline edits (map annotations) can't merge automatically, so they use optimistic
concurrency: a `version` counter per layer. If the server's version has moved ahead of what the
device last saw, the write is rejected (409) and logged to `sync_conflicts` for admin review
instead of silently clobbering a redline someone else drew (feature 9).

The reverse direction — pulling server state down — goes through `GET /api/sync/pull/:entityType`,
checkpointed per `(device_id, entity_type)` in `sync_checkpoints` so each sync only fetches what
changed since last time. `SyncWorker` currently pulls `jobs` (role-filtered: field roles only get
jobs they're assigned to, via `job_assignments`) and `material_catalog`, since those are the two
reference tables the field screens need cached to work offline — a job's geofence polygon is
flattened server-side (`ST_DumpPoints`) to a plain `[{lat,lng}]` array so the Android client never
needs a GeoJSON parser to run `GeofenceEvaluator`. Truck inventory intentionally isn't pulled this
way — its balance is derived locally from the append-only ledger described above, not overwritten
wholesale from a snapshot.

## Geofencing (feature 3)

The Android client runs an offline point-in-polygon / haversine check (`GeofenceEvaluator`) purely
for immediate UI feedback. The backend's `fn_point_in_job_geofence` PostGIS function is the
authoritative check, run against `jobs.geofence` (drawn polygon) or `jobs.geofence_radius_m`
(fallback circle) at clock-in/out time, and the result (`in_geofence`) is stored on the timecard
row for payroll/compliance review.

## Money-to-hours (feature 4)

`timecards.earnings_cents` and `total_minutes` are PostgreSQL generated columns computed from
`clock_in_at`, `clock_out_at`, `total_break_minutes`, and a rate *snapshot* taken at clock-in
(`hourly_rate_cents_snapshot`) — a mid-shift rate change never rewrites hours already earned. While
a shift is still open, `GET /api/timecards/active` and the Android `TimecardRepository` both
compute the same live figure client-side for a ticking real-time display.

## Real-time messaging (feature 5)

Socket.IO namespace at `/ws/chat`, authenticated via the same JWT. Messages persist to
`chat_messages` with a `client_msg_id` idempotency key before broadcast, so a message sent while
briefly offline and retried never appears twice. Delivery falls back to FCM push when the
recipient's socket isn't connected.

## Security notes

- Passwords: bcrypt, cost 12.
- JWT access tokens are short-lived (15m default); refresh tokens are long-lived and rotated per
  refresh call.
- QR material transfers (feature 12) use a signed, 120-second-expiry JWT as the QR payload so a
  photographed/screenshotted code can't be replayed later.
- Timecard tamper detection compares device-reported clock-in/out time against server time
  (`TAMPER_CLOCK_SKEW_MS`); flagged rows surface in payroll review rather than being silently
  trusted or silently rejected.
- Object storage (maps, photos, documents) is accessed only via short-lived signed URLs, never
  public buckets.

## Deployment shape

- `database/schema.sql` is the canonical schema; `database/migrations/001_init.sql` applies it.
  Add subsequent migrations as `NNN_description.sql` and run them in order.
- `backend/` is stateless behind a load balancer; Socket.IO requires sticky sessions or a Redis
  adapter (`socket.io-redis`) once scaled beyond one instance.
- `web/` builds to static assets (`npm run build`) served from any CDN/static host, calling the
  same backend `/api`.
- `android/` targets minSdk 26 (covers the 3 field devices); release builds should point
  `NetworkModule.BASE_URL` at the production API and enable certificate pinning in
  `network_security_config.xml` before rollout.
