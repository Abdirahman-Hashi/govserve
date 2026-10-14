#!/bin/sh
# Renders alertmanager.yml from the template, then starts Alertmanager.
set -eu
auth=''
if [ -n "${SMTP_USER:-}" ]; then
  auth="        auth_username: '${SMTP_USER}'
        auth_password_file: /run/secrets/smtp_password"
fi
sed -e "s|__ALERT_EMAIL_TO__|${ALERT_EMAIL_TO}|" -e "s|__SMTP_FROM__|${SMTP_FROM}|" \
    -e "s|__SMTP_HOST__|${SMTP_HOST}|" -e "s|__SMTP_PORT__|${SMTP_PORT}|" \
    -e "s|__SMTP_REQUIRE_TLS__|${SMTP_REQUIRE_TLS}|" -e "s|__DEPLOY_ENV__|${DEPLOY_ENV}|" \
    /etc/alertmanager/alertmanager.yml.tmpl | awk -v a="$auth" '{ if ($0 == "__SMTP_AUTH__") { if (a != "") print a } else print }' \
    > /tmp/alertmanager.yml
exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager
