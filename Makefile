# GovServe: a production-shaped stack on this machine (docs/RUNBOOK.md §Local stack).
#   make up             build images, run the release job, start everything on http://govserve.localhost
#   make e2e            Playwright against the running stack (staff flows included)
#   make backup         one backup run now (to the local backup bucket)
#   make restore-drill  restore the latest backup into a scratch database and verify it
#   make down           stop (data volumes kept); make clean also deletes them
SHELL := /bin/bash
ENV_FILE := infra/.local/stack.env
COMPOSE := docker compose --env-file $(ENV_FILE) -f infra/docker-compose.prod.yml -f infra/docker-compose.local.yml
DRILL := docker compose --env-file $(ENV_FILE) -f infra/backup/drill.compose.yml
# New local secrets recreate the containers that mount them, as deploy.sh does on the VM.
export SECRETS_REV = $(shell git hash-object $(ENV_FILE) 2>/dev/null | cut -c1-16)

.PHONY: help secrets-local build up down clean logs ps migrate e2e backup restore-drill

help:
	@sed -n '2,7p' Makefile

# The backup image provides age-keygen for the generated secrets, so it is built first.
secrets-local:
	@docker build -q -f infra/backup/Dockerfile -t govserve/govserve-backup:local --build-arg RELEASE=local . >/dev/null
	@node infra/scripts/local-secrets.mjs

build: secrets-local
	$(COMPOSE) --profile release build

up: build
	$(COMPOSE) up -d --wait postgres redis objectstore objectstore-init mailpit
	$(COMPOSE) run --rm migrate
	$(COMPOSE) up -d --wait
	@echo "GovServe is up: http://govserve.localhost (mail: http://localhost:8125)"

down:
	$(COMPOSE) --profile release down

clean:
	$(COMPOSE) --profile release down -v

logs:
	$(COMPOSE) logs -f --tail=100

ps:
	$(COMPOSE) ps

migrate:
	$(COMPOSE) run --rm migrate

# Staff accounts are created inside the api container (it has the config and secrets); the fixture
# refuses DEPLOY_ENV=production.
e2e:
	@set -a; source $(ENV_FILE); set +a; \
	$(COMPOSE) run --rm --no-deps -e E2E_STAFF_PASSWORD api node dist/cli/e2e-staff.js && \
	E2E_BASE_URL=http://govserve.localhost MAILPIT_URL=http://localhost:8125 pnpm --filter web exec playwright test

backup:
	$(COMPOSE) run --rm --entrypoint /backup/backup.sh backup

restore-drill:
	@set -a; source $(ENV_FILE); set +a; $(DRILL) run --rm drill; status=$$?; $(DRILL) down -v >/dev/null 2>&1; exit $$status
