#!/usr/bin/env bash
# Deploys RELEASE (an image tag = commit SHA) to one VM over SSH (RUNBOOK §Deploy). Run by
# .github/workflows/deploy.yml and rollback.yml; also usable by hand with the same variables.
#
# Secrets are streamed to the remote shell on stdin and exported only in that process, then
# `docker compose` copies them into the containers as /run/secrets files. They are never written to
# the release directory or an env file, put on a command line, or printed.
set -euo pipefail
: "${RELEASE:?}" "${SSH_HOST:?}" "${SSH_USER:?}" "${REGISTRY:?}" "${DEPLOY_ENV:?}"
# Image names must be lowercase; GitHub owners (ghcr.io/<owner>) often are not.
REGISTRY="$(printf '%s' "$REGISTRY" | tr '[:upper:]' '[:lower:]')"
ROOT=/opt/govserve
here="$(cd "$(dirname "$0")/.." && pwd)" # infra/

# Settings (not secret) and secrets the stack needs; see infra/docker-compose.prod.yml.
CONFIG_VARS=(RELEASE REGISTRY DEPLOY_ENV SITE_ADDRESS WEB_ORIGIN OBJECT_STORE_ORIGIN S3_ENDPOINT S3_PUBLIC_ENDPOINT
  S3_REGION S3_BUCKET S3_FORCE_PATH_STYLE S3_ACCESS_KEY_ID SMTP_HOST SMTP_PORT SMTP_FROM SMTP_USER SMTP_SECURE
  SMTP_REQUIRE_TLS CARD_GATEWAY ALERT_EMAIL_TO BACKUP_AGE_RECIPIENT BACKUP_S3_ENDPOINT BACKUP_S3_REGION BACKUP_BUCKET
  BACKUP_S3_ACCESS_KEY_ID LOG_LEVEL)
SECRET_VARS=(POSTGRES_PASSWORD DATABASE_URL DATABASE_APP_URL REDIS_PASSWORD REDIS_URL S3_SECRET_ACCESS_KEY SMTP_PASSWORD
  CARD_WEBHOOK_SECRET JWT_ACCESS_SECRET PII_KEYS BLIND_INDEX_KEY SIGNING_KEYS METRICS_TOKEN
  BACKUP_S3_SECRET_ACCESS_KEY BACKUP_CRYPT_PASSWORD GHCR_USER GHCR_TOKEN)

# A digest of every secret value, set as a label on the services that mount secrets: Compose does not
# notice a changed secret by itself, so a rotation would otherwise keep running with the old value.
sha256() { if command -v sha256sum >/dev/null; then sha256sum; else shasum -a 256; fi; }
# shellcheck disable=SC2034 # exported to the VM through CONFIG_VARS (read by ${!v})
SECRETS_REV="$(for v in "${SECRET_VARS[@]}"; do printf '%s=%s\0' "$v" "${!v-}"; done | sha256 | cut -c1-16)"
CONFIG_VARS+=(SECRETS_REV)

ssh_opts=(-o BatchMode=yes -o StrictHostKeyChecking=yes)
target="$SSH_USER@$SSH_HOST"

echo "deploy: copying the stack definition for $RELEASE to $SSH_HOST"
ssh "${ssh_opts[@]}" "$target" "mkdir -p $ROOT/releases/$RELEASE"
rsync -az --delete -e "ssh ${ssh_opts[*]}" \
  "$here/docker-compose.prod.yml" "$here/caddy" "$here/prometheus" "$here/alertmanager" "$here/backup/drill.compose.yml" \
  "$target:$ROOT/releases/$RELEASE/"

{
  for v in "${CONFIG_VARS[@]}" "${SECRET_VARS[@]}"; do
    [ -n "${!v+x}" ] && printf 'export %s=%q\n' "$v" "${!v}"
  done
  cat <<REMOTE
set -euo pipefail
cd $ROOT/releases/\$RELEASE
compose() { docker compose -f docker-compose.prod.yml "\$@"; }
printf '%s' "\$GHCR_TOKEN" | docker login ghcr.io -u "\$GHCR_USER" --password-stdin >/dev/null
echo "remote: pulling images"
compose --profile release pull --quiet
echo "remote: release job (migrations, app role, reference data)"
compose --profile release run --rm migrate
echo "remote: rolling out"
compose up -d --wait --wait-timeout 600 --remove-orphans
ln -sfn releases/\$RELEASE $ROOT/current
echo "\$(date -u +%FT%TZ) \$RELEASE" >> $ROOT/history
docker logout ghcr.io >/dev/null
# Keep the last five releases' files and images for rollback.
ls -1t $ROOT/releases | tail -n +6 | while read -r old; do rm -r "$ROOT/releases/\$old"; done
docker image prune -af --filter "until=720h" >/dev/null
echo "remote: \$RELEASE is live"
REMOTE
} | ssh "${ssh_opts[@]}" "$target" 'bash -s'
