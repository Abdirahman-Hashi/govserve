#!/bin/sh
# Shared by backup.sh and restore.sh: secrets from /run/secrets, rclone remotes from the environment.
set -eu

secret() { # secret NAME → contents of /run/secrets/<name>, or $NAME if set (local drill)
  f="/run/secrets/$1"
  if [ -f "$f" ]; then cat "$f"; else eval "printf '%s' \"\${$2:-}\""; fi
}

DATABASE_URL="$(secret database_url DATABASE_URL)"
REDIS_URL="$(secret redis_url REDIS_URL)"
export DATABASE_URL REDIS_URL

# Remote "backup": the separate backup bucket. Remote "docs": the documents bucket (read).
export RCLONE_CONFIG_BACKUP_TYPE=s3 RCLONE_CONFIG_BACKUP_PROVIDER=Other
export RCLONE_CONFIG_BACKUP_ENDPOINT="$BACKUP_S3_ENDPOINT" RCLONE_CONFIG_BACKUP_REGION="${BACKUP_S3_REGION:-us-east-1}"
export RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY_ID"
RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY="$(secret backup_s3_secret_access_key BACKUP_S3_SECRET_ACCESS_KEY)"
export RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY
export RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE="${BACKUP_S3_FORCE_PATH_STYLE:-false}"

export RCLONE_CONFIG_DOCS_TYPE=s3 RCLONE_CONFIG_DOCS_PROVIDER=Other
export RCLONE_CONFIG_DOCS_ENDPOINT="$DOCS_S3_ENDPOINT" RCLONE_CONFIG_DOCS_REGION="${DOCS_S3_REGION:-us-east-1}"
export RCLONE_CONFIG_DOCS_ACCESS_KEY_ID="$DOCS_S3_ACCESS_KEY_ID"
RCLONE_CONFIG_DOCS_SECRET_ACCESS_KEY="$(secret s3_secret_access_key S3_SECRET_ACCESS_KEY)"
export RCLONE_CONFIG_DOCS_SECRET_ACCESS_KEY
export RCLONE_CONFIG_DOCS_FORCE_PATH_STYLE="${DOCS_S3_FORCE_PATH_STYLE:-false}"

# Uploaded documents are copied through an encrypted (crypt) remote inside the backup bucket.
export RCLONE_CONFIG_DOCSCRYPT_TYPE=crypt RCLONE_CONFIG_DOCSCRYPT_REMOTE="backup:${BACKUP_BUCKET}/documents"
RCLONE_CONFIG_DOCSCRYPT_PASSWORD="$(rclone obscure "$(secret backup_crypt_password BACKUP_CRYPT_PASSWORD)")"
export RCLONE_CONFIG_DOCSCRYPT_PASSWORD
export RCLONE_STATS_ONE_LINE=true RCLONE_STATS_LOG_LEVEL=NOTICE
# Remotes come from the environment above; there is no config file.
export RCLONE_CONFIG=/dev/null

# redis-cli: password via REDISCLI_AUTH (never on the command line); works with redis://:pw@ and
# redis://default:pw@ URLs alike.
rcli() {
  hostport="$(printf '%s' "$REDIS_URL" | sed -E 's#^rediss?://([^@]*@)?([^/]*).*#\2#')"
  REDISCLI_AUTH="$(printf '%s' "$REDIS_URL" | sed -nE 's#^rediss?://[^:@]*:([^@]*)@.*#\1#p')" \
    redis-cli -h "${hostport%:*}" -p "${hostport##*:}" --no-auth-warning "$@"
}

log() { printf '{"time":"%s","msg":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
