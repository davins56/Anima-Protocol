#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# One-time, idempotent backfill: migrate every user's legacy ChatSession.messages
# blobs into ChatMessage rows so metadata-only lists stop shipping full chat
# history. Already-migrated sessions are skipped, so re-running is cheap.
pnpm --filter @workspace/scripts run backfill:messages
