#!/bin/sh
# Runs backup.sh every day at BACKUP_AT (local time, TZ=Africa/Mogadishu). `backup.sh` can also
# be run on demand: docker compose run --rm --entrypoint /backup/backup.sh backup
set -eu
at="${BACKUP_AT:-01:30}"
while true; do
  touch /tmp/scheduler-alive
  now="$(date +%s)"
  next="$(date -d "$(date +%Y-%m-%d) $at" +%s)"
  [ "$next" -le "$now" ] && next=$(( next + 86400 ))
  sleep $(( next - now ))
  /backup/backup.sh || printf '{"msg":"backup failed","at":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
done
