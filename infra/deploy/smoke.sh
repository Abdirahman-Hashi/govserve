#!/usr/bin/env bash
# Post-deploy smoke test (deploy.yml, rollback.yml): the release answers, is ready, serves the app
# with its security headers, and keeps /metrics private. Usage: smoke.sh https://gov.example.so SHA
set -euo pipefail
base="${1:?base URL}" release="${2:-}"
fail() { echo "smoke: FAIL $*" >&2; exit 1; }
for i in $(seq 1 30); do curl -fsS "$base/ready" >/dev/null 2>&1 && break; sleep 5; [ "$i" = 30 ] && fail "/ready never answered"; done
ready="$(curl -fsS "$base/ready")"
echo "$ready" | grep -q '"database":"up"' || fail "database not ready: $ready"
echo "$ready" | grep -q '"redis":"up"' || fail "redis not ready: $ready"
[ -z "$release" ] || echo "$ready" | grep -q "\"version\":\"$release\"" || fail "expected release $release, got $ready"
headers="$(curl -fsSI "$base/")"
echo "$headers" | grep -qi '^content-security-policy:.*frame-ancestors' || fail "CSP missing"
echo "$headers" | grep -qi '^referrer-policy: no-referrer' || fail "Referrer-Policy missing"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/v1/catalogue/services")" = 200 ] || fail "catalogue"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/api/v1/verify/r/R-2000-000000")" = 404 ] || fail "verify lookup"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/metrics")" = 404 ] || fail "/metrics is reachable from outside"
echo "smoke: OK ($base${release:+ at $release})"
