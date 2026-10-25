#!/bin/sh
# One start command for both Railway services built from this image (ADR-055, docs/railway-for-dummies.md).
#
#   web    (default)  self-check → migrations → reference data → demo data if DEMO_MODE=true and the
#                     database is empty → Next.js on $PORT. Only this service runs migrations.
#   worker            self-check → background jobs (it waits until web has applied the migrations).
#
# The role comes from APP_ROLE (web|worker); when APP_ROLE is unset, a Railway service whose name
# contains "worker" runs as the worker. A Custom Start Command of `pnpm worker` still works too.
set -e

ROLE="${APP_ROLE:-}"
if [ -z "$ROLE" ]; then
  case "$(printf '%s' "${RAILWAY_SERVICE_NAME:-}" | tr '[:upper:]' '[:lower:]')" in
    *worker*) ROLE=worker ;;
    *) ROLE=web ;;
  esac
fi

case "$ROLE" in
  worker)
    echo "[start] Starting the background worker (service ${RAILWAY_SERVICE_NAME:-local})."
    pnpm -s self-check worker
    exec pnpm -s worker
    ;;
  web) ;;
  *)
    echo "[start] PROBLEM APP_ROLE must be web or worker (it is \"$ROLE\")."
    exit 1
    ;;
esac

echo "[start] Starting the web app (service ${RAILWAY_SERVICE_NAME:-local})."
pnpm -s self-check web
pnpm -s db:migrate
# Reference master data (units, SI conversions, reason codes) for every organization; idempotent (ADR-040).
pnpm -s db:reference
# Fictional demo data, only when demo mode is on and the database is empty; never overwrites anything (ADR-055).
pnpm -s db:demo auto
# Going live without a terminal: with BOOTSTRAP_ADMIN_EMAIL set, the first administrator is invited and the
# one-time link is printed in this deploy log. The command refuses once any account is active, so later
# restarts change nothing; remove the BOOTSTRAP_* variables after first sign-in (docs/railway-for-dummies.md).
if [ -n "${BOOTSTRAP_ADMIN_EMAIL:-}" ]; then
  pnpm -s admin:bootstrap || echo "[start] First-administrator invitation skipped (see the message above). Remove the BOOTSTRAP_* variables once you can sign in."
fi
exec pnpm -s start
