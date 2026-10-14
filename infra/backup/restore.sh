#!/bin/sh
# Restore drill (RUNBOOK §Restore): fetch the latest daily backup, decrypt it with the age identity,
# restore into a scratch database, and check it against the manifest. RTO target: 4 hours.
set -eu
. /backup/lib.sh
start="$(date +%s)"
target="${DRILL_DATABASE_URL:?set DRILL_DATABASE_URL (a scratch database, never production)}"
identity="${BACKUP_AGE_IDENTITY_FILE:-/run/secrets/backup_age_identity}"
day="${RESTORE_DAY:-$(rclone lsf --dirs-only "backup:$BACKUP_BUCKET/daily/" | sort | tail -1 | tr -d /)}"
[ -n "$day" ] || { log "FAIL no daily backup found in $BACKUP_BUCKET"; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
log "restore drill: backup of $day"

rclone copy "backup:$BACKUP_BUCKET/daily/$day" "$work"
(cd "$work" && sha256sum -c SHA256SUMS >/dev/null) && log "checksums OK"
age -d -i "$identity" -o "$work/postgres.dump" "$work/postgres.dump.age"
age -d -i "$identity" -o "$work/redis.rdb" "$work/redis.rdb.age"

pg_restore --no-owner --no-privileges --exit-on-error --dbname="$target" "$work/postgres.dump"
restored="$(psql "$target" -AtF, -c "SELECT (SELECT count(*) FROM application),(SELECT count(*) FROM payment),(SELECT count(*) FROM receipt),(SELECT count(*) FROM certificate),(SELECT count(*) FROM audit_log)")"
expected="$(sed -n 's/.*"counts":{"application":\([0-9]*\),"payment":\([0-9]*\),"receipt":\([0-9]*\),"certificate":\([0-9]*\),"auditLog":\([0-9]*\)}.*/\1,\2,\3,\4,\5/p' "$work/manifest.json")"
[ "$restored" = "$expected" ] || { log "FAIL row counts $restored, expected $expected"; exit 1; }
broken="$(psql "$target" -At -c 'SELECT count(*) FROM audit_verify()')"
[ "$broken" = 0 ] || { log "FAIL audit chain broken in the restored database"; exit 1; }
log "postgres OK (application,payment,receipt,certificate,audit_log = $restored; audit chain intact)"

mkdir -p "$work/redis" && cp "$work/redis.rdb" "$work/redis/dump.rdb"
redis-server --port 6390 --dir "$work/redis" --dbfilename dump.rdb --appendonly no --daemonize yes >/dev/null
sleep 1
keys="$(redis-cli -p 6390 dbsize)"
queues="$(redis-cli -p 6390 --scan --pattern 'govserve:*:meta' | wc -l | tr -d ' ')"
redis-cli -p 6390 shutdown nosave >/dev/null 2>&1 || true
expected_keys="$(sed -n 's/.*"redisKeys":\([0-9]*\).*/\1/p' "$work/manifest.json")"
# Redis is live (queues, sessions): its size moves between the snapshot and the count, so the drill
# checks that the snapshot loads and holds the job queues. Lost jobs are rebuilt from the outbox.
[ "$keys" -gt 0 ] && [ "$queues" -gt 0 ] || { log "FAIL redis snapshot empty or without queues ($keys keys)"; exit 1; }
log "redis OK ($keys keys, $queues queues; about $expected_keys at backup time)"

docs="$(rclone lsf -R --files-only docscrypt:current | wc -l | tr -d ' ')"
expected_docs="$(sed -n 's/.*"documents":\([0-9]*\).*/\1/p' "$work/manifest.json")"
[ "$docs" -ge "$expected_docs" ] || { log "FAIL documents $docs, expected at least $expected_docs"; exit 1; }
log "documents OK ($docs objects readable through the encrypted mirror)"

elapsed=$(( $(date +%s) - start ))
log "restore drill PASSED in ${elapsed}s (RTO target 14400s)"
