#!/bin/sh
set -e
pnpm -s db:migrate
if [ "$ALLOW_DEMO_SEED" = "true" ]; then
  pnpm -s db:seed
fi
exec pnpm -s start
