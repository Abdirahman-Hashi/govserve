#!/usr/bin/env bash
# Runs the k6 load test against the local stack (make up) and saves the results under
# perf/k6/results/<timestamp>/. See docs/RUNBOOK.md §Load test. Never point this at production.
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV_FILE=infra/.local/stack.env
COMPOSE=(docker compose --env-file "$ENV_FILE" -f infra/docker-compose.prod.yml -f infra/docker-compose.local.yml)
K6_IMAGE=grafana/k6:1.8.1 # or set K6_BIN to a local k6 v1.8.x binary
out="perf/k6/results/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$out"

# The load-test citizens' password: generated once per machine, kept in a gitignored file and
# never printed, so repeated runs sign in as the same accounts.
PASS_FILE=infra/.local/loadtest.password
[[ -s "$PASS_FILE" ]] || (umask 077 && openssl rand -hex 16 | sed 's/^/lt-/' > "$PASS_FILE")
LOADTEST_PASSWORD="$(cat "$PASS_FILE")"
export LOADTEST_PASSWORD

# All load comes from this machine's IP, so rate limiting is off for the run and back on after.
restore() { "${COMPOSE[@]}" up -d --wait api >/dev/null 2>&1 || echo "Restart the api: make up"; }
trap restore EXIT
RATE_LIMIT_ENABLED=false "${COMPOSE[@]}" up -d --wait api >/dev/null

echo "Preparing 270 load-test citizens (one per virtual user)…"
# Images older than Phase 12 lack the CLI; k6's setup() then registers them through Mailpit.
"${COMPOSE[@]}" run --rm --no-deps -e LOADTEST_PASSWORD api node dist/cli/loadtest-citizens.js 270 ||
  echo "(CLI not in this image; k6 setup registers the accounts)"

echo "Resetting query statistics…"
"${COMPOSE[@]}" exec -T postgres psql -qAt -U govserve -d govserve \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' -c 'SELECT pg_stat_statements_reset()' >/dev/null

echo "Running k6 (${DURATION:-5m})…"
status=0
export DURATION="${DURATION:-5m}" MAILPIT_URL="${MAILPIT_URL:-http://localhost:8125}"
if [[ -n "${K6_BIN:-}" ]]; then
  "$K6_BIN" run -q --summary-export "$out/summary.json" --out "json=$out/raw.json.gz" \
    perf/k6/govserve.js > "$out/k6.txt" 2>&1 || status=$?
else
  docker run --rm --network host -e LOADTEST_PASSWORD -e DURATION -e MAILPIT_URL -e BASE_URL \
    -v "$PWD/perf/k6:/scripts:ro" -v "$PWD/$out:/out" "$K6_IMAGE" run -q \
    --summary-export /out/summary.json --out json=/out/raw.json.gz /scripts/govserve.js > "$out/k6.txt" 2>&1 || status=$?
fi
tail -n 60 "$out/k6.txt"

echo "p95 per endpoint…"
node perf/k6/report.mjs "$out/raw.json.gz" | tee "$out/endpoints.md"

echo "Slowest queries (pg_stat_statements)…"
"${COMPOSE[@]}" exec -T postgres psql -U govserve -d govserve -P pager=off -c "
  SELECT calls, round(mean_exec_time::numeric, 1) AS mean_ms, round(max_exec_time::numeric, 1) AS max_ms,
         round(total_exec_time::numeric) AS total_ms, left(regexp_replace(query, '\s+', ' ', 'g'), 160) AS query
  FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'govserve')
  ORDER BY total_exec_time DESC LIMIT 15" > "$out/slow-queries.txt"
cat "$out/slow-queries.txt"
echo "Results in $out (k6 exit $status)"
exit "$status"
