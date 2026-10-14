#!/bin/sh
# One backup run: Postgres (custom-format dump), Redis snapshot, documents bucket; all encrypted
# before they leave the VM. Retention: 14 daily, 8 weekly, 12 monthly (RPO 24 h).
set -eu
. /backup/lib.sh
day="$(date +%Y-%m-%d)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
log "backup start $day"

pg_dump --format=custom --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$work/postgres.dump"
counts="$(psql "$DATABASE_URL" -AtF, -c "SELECT (SELECT count(*) FROM application),(SELECT count(*) FROM payment),(SELECT count(*) FROM receipt),(SELECT count(*) FROM certificate),(SELECT count(*) FROM audit_log)")"
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/postgres.dump.age" "$work/postgres.dump" && rm "$work/postgres.dump"

rcli --rdb "$work/redis.rdb" >/dev/null
redis_keys="$(rcli dbsize)"
age -r "$BACKUP_AGE_RECIPIENT" -o "$work/redis.rdb.age" "$work/redis.rdb" && rm "$work/redis.rdb"

(cd "$work" && sha256sum ./*.age > SHA256SUMS)
docs="$(rclone lsf -R --files-only "docs:$DOCS_BUCKET" | wc -l | tr -d ' ')"
cat > "$work/manifest.json" <<JSON
{"release":"${RELEASE:-dev}","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","day":"$day",
 "counts":{"application":$(echo "$counts" | cut -d, -f1),"payment":$(echo "$counts" | cut -d, -f2),"receipt":$(echo "$counts" | cut -d, -f3),"certificate":$(echo "$counts" | cut -d, -f4),"auditLog":$(echo "$counts" | cut -d, -f5)},
 "redisKeys":$redis_keys,"documents":$docs}
JSON

rclone copy "$work" "backup:$BACKUP_BUCKET/daily/$day"
# Documents: an encrypted mirror; files deleted since yesterday are kept under deleted/<day>.
rclone sync "docs:$DOCS_BUCKET" "docscrypt:current" --backup-dir "docscrypt:deleted/$day"

[ "$(date +%u)" = 7 ] && rclone copy "backup:$BACKUP_BUCKET/daily/$day" "backup:$BACKUP_BUCKET/weekly/$day"
[ "$(date +%d)" = 01 ] && rclone copy "backup:$BACKUP_BUCKET/daily/$day" "backup:$BACKUP_BUCKET/monthly/$day"

prune() { # prune <prefix> <days>
  cutoff="$(date -d "@$(( $(date +%s) - $2 * 86400 ))" +%Y-%m-%d)"
  for d in $(rclone lsf --dirs-only "backup:$BACKUP_BUCKET/$1/" 2>/dev/null); do
    d="${d%/}"
    case "$d" in [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]) ;; *) continue ;; esac # only dated folders
    if [ "$(echo "$d" | tr -d -)" -lt "$(echo "$cutoff" | tr -d -)" ]; then
      rclone purge "backup:$BACKUP_BUCKET/$1/$d" && log "pruned $1/$d"
    fi
  done
}
prune daily 14
prune weekly 56
prune monthly 366
prune documents/deleted 366

printf '{"day":"%s","finishedAt":"%s"}\n' "$day" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" | rclone rcat "backup:$BACKUP_BUCKET/last-success.json"
log "backup done $day (documents: $docs)"
