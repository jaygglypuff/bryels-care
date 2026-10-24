#!/bin/sh
set -e
pnpm -s db:migrate
# Reference master data (units, SI conversions, reason codes) for every organization; idempotent (ADR-040).
pnpm -s db:reference
if [ "$ALLOW_DEMO_SEED" = "true" ]; then
  pnpm -s db:seed
fi
exec pnpm -s start
