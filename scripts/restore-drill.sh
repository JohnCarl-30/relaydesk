#!/usr/bin/env bash
# Restore drill on real Docker: make data, back it up off the machine, lose the
# disk, restore from the bucket, and check the data is back. Takes a few minutes.
#
#   scripts/restore-drill.sh          (KEEP=1 leaves the containers up afterwards)
#
# It runs as its own compose project on port 3420 with its own volume, so a
# relaydesk you already run with docker compose is not touched.
set -euo pipefail
cd "$(dirname "$0")/.."

export RELAYDESK_PORT="${DRILL_PORT:-3420}"
HOST="http://127.0.0.1:${RELAYDESK_PORT}"
COMPOSE=(docker compose -p relaydesk-drill -f docker-compose.yml -f scripts/drill.compose.yml)
JAR="$(mktemp)"
BIZ="drill-cafe"

step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nDRILL FAILED: %s\n' "$*" >&2; exit 1; }
cleanup() {
  rm -f "$JAR"
  if [[ "${KEEP:-0}" != "1" ]]; then "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT

api() { # method path [json]
  curl -sS -b "$JAR" -c "$JAR" -X "$1" "$HOST$2" -H 'content-type: application/json' ${3:+-d "$3"}
}

step "Build and start a fresh relaydesk (project relaydesk-drill)"
"${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
"${COMPOSE[@]}" up -d --build --wait relaydesk s3

step "Make real data: a business, an article, a ticket"
api POST /api/signup "{\"businessName\":\"Drill Cafe\",\"businessId\":\"$BIZ\",\"name\":\"Ana\",\"email\":\"ana@drill.test\",\"password\":\"drill-password-1\"}" >/dev/null
api POST /api/articles '{"title":"Store hours","body":"We are open 7 am to 9 pm every day."}' >/dev/null
api PATCH /api/business '{"live":true}' >/dev/null
TICKET=$(api POST /api/chat "{\"business\":\"$BIZ\",\"message\":\"Do you sell laptops?\"}" | node -pe 'JSON.parse(require("fs").readFileSync(0)).ticketId')
[[ "$TICKET" == tkt_* ]] || fail "no ticket was opened (got $TICKET)"
echo "ticket $TICKET"

step "Back up once, with an off-server copy"
"${COMPOSE[@]}" run --rm --no-deps backup node scripts/backup.mjs --once

step "Disaster: stop the app and lose the database and the local snapshots"
"${COMPOSE[@]}" stop relaydesk
"${COMPOSE[@]}" run --rm --no-deps backup sh -c 'rm -rf /data/relaydesk.db* /data/backups && ls -A /data'

step "Restore from the bucket"
"${COMPOSE[@]}" run --rm --no-deps backup node scripts/restore.mjs --from-s3 --yes

step "Start again and check the data is back"
"${COMPOSE[@]}" up -d --wait relaydesk
rm -f "$JAR"; JAR="$(mktemp)"
api POST /api/auth/login '{"email":"ana@drill.test","password":"drill-password-1"}' | grep -q '"ok":true' || fail "the restored login doesn't work"
api GET /api/tickets | grep -q "\"$TICKET\"" || fail "ticket $TICKET is missing after the restore"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$HOST/h/$BIZ")" == 200 ]] || fail "the help center isn't back"
curl -sf "$HOST/api/health" >/dev/null || fail "health check fails after the restore"

printf '\nDRILL PASSED: business, login, article, and ticket %s came back from the off-server copy.\n' "$TICKET"
