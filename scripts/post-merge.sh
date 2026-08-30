#!/bin/bash
set -e
pnpm install --frozen-lockfile
# The store's title search is backed by a GIN trigram index (see lib/db schema:
# user_entities_title_trgm_idx). drizzle-kit push does not manage extensions, so
# pg_trgm must exist before push tries to create that index. Idempotent.
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS pg_trgm"
pnpm --filter db push
# One-time, idempotent backfill: migrate every user's legacy ChatSession.messages
# blobs into ChatMessage rows so metadata-only lists stop shipping full chat
# history. Already-migrated sessions are skipped, so re-running is cheap.
pnpm --filter @workspace/scripts run backfill:messages
