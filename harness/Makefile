SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help env zitadel-up zitadel-setup zitadel-check gateway-up gateway-check broker-up broker-check repro-3057 broker-fix mock-cws-check runtimes-check ui-check use-stack test compare harness-check down
help:
	@echo "make zitadel-check  Start and configure Zitadel"
	@echo "make harness-check  Run all nine harness checks"

env:
	@test -f .env || cp .env.example .env
	@mkdir -p data/bootstrap

zitadel-up: env
	docker compose up -d --wait postgres zitadel zitadel-login proxy

zitadel-setup: zitadel-up
	@test -x node_modules/.bin/tsx || npm ci --omit=optional --ignore-scripts
	npm run setup:zitadel

zitadel-check: zitadel-setup
	@curl -fsS http://localhost:8080/debug/ready >/dev/null
	@curl -fsS http://localhost:8080/ui/v2/login/healthy >/dev/null
	@echo "Zitadel and Login v2 are healthy"

gateway-up: zitadel-setup
	npx tsx scripts/use-stack.ts ref
	docker compose up -d --build --wait ref-mcp otel-collector agentgateway

gateway-check: gateway-up
	@curl -fsS http://localhost:3000/.well-known/oauth-protected-resource/mcp | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.authorization_servers?.includes("http://localhost:4200"))process.exit(1)})'
	@echo "agentgateway and ref-mcp are healthy"

broker-up: gateway-up
	docker compose up -d --build --wait broker

broker-check: broker-up
	@curl -fsS http://localhost:4200/.well-known/oauth-authorization-server | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(j.registration_endpoint!=="http://localhost:4200/register"||j.client_id_metadata_document_supported!==undefined||JSON.stringify(j.code_challenge_methods_supported)!=="[\"S256\"]")process.exit(1)})'
	@echo "registration broker is healthy"

repro-3057: broker-check
	set -a; source .env; set +a; npx tsx scripts/oauth-demo.ts native

broker-fix: broker-check
	set -a; source .env; set +a; npx tsx scripts/oauth-demo.ts broker

mock-cws-check:
	docker compose up -d --build --wait mock-cws
	@test "$$(curl -fsS http://localhost:4100/graphql -H 'content-type: application/json' -H 'X-Org-Id: acme' -d '{"query":"{ pendingTimesheets(orgId:\"acme\") { id } }"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).data.pendingTimesheets.length))')" = 6
	@echo "mock-cws returned six acme rows"

runtimes-check:
	docker compose up -d --wait temporal dts-emulator
	@curl -fsS http://localhost:8233/ >/dev/null
	@curl -fsS http://localhost:8082/ >/dev/null
	@echo "Temporal UI and DTS dashboard are reachable"

ui-check: zitadel-setup
	docker compose up -d --build --wait ui
	@curl -fsS http://localhost:3100/ | grep -q "Timesheet review"
	@echo "shared UI built and loaded"

use-stack: env
	@test -n "$(STACK)" || (echo "usage: make use-stack STACK=dotnet|python|typescript|ref"; exit 2)
	npx tsx scripts/use-stack.ts "$(STACK)"
	docker compose up -d --build --force-recreate agentgateway ui

test: env
	@test -n "$(STACK)" || (echo "usage: make test STACK=dotnet|python|typescript|ref"; exit 2)
	set -a; source .env; set +a; STACK="$(STACK)" npm run test:stack

compare:
	npm run compare

harness-check: zitadel-check gateway-check runtimes-check mock-cws-check broker-check repro-3057 broker-fix ui-check
	$(MAKE) use-stack STACK=ref
	$(MAKE) test STACK=ref
	@echo "Harness checks and the T1-T16 reference run passed"

down:
	docker compose down
