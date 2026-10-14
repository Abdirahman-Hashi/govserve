# syntax=docker/dockerfile:1.7
# Nightly backups and the restore drill (NFR-007, RUNBOOK). pg_dump 16 matches the server.
FROM alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1
# The upgrade takes Alpine security fixes released after the pinned base digest.
RUN apk upgrade --no-cache \
 && apk add --no-cache postgresql16-client rclone age redis tzdata coreutils \
 && addgroup -S backup && adduser -S -G backup -h /home/backup backup
COPY --chmod=0755 infra/backup/*.sh /backup/
ARG RELEASE=dev
ENV RELEASE=${RELEASE}
LABEL org.opencontainers.image.title="govserve-backup" org.opencontainers.image.revision="${RELEASE}"
USER backup
WORKDIR /home/backup
# start-interval: `up --wait` (every deploy) sees it healthy within seconds, not after the first 5 minutes.
HEALTHCHECK --interval=5m --timeout=5s --start-period=1m --start-interval=2s CMD ["sh", "-c", "test -f /tmp/scheduler-alive"]
ENTRYPOINT ["/backup/scheduler.sh"]
