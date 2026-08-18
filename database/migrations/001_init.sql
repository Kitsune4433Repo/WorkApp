-- Initial migration: applies the full baseline schema.
-- Run with: psql $DATABASE_URL -f database/migrations/001_init.sql
\i ../schema.sql
