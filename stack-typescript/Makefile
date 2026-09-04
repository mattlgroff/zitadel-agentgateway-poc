.PHONY: build up down logs test

build:
	docker compose build

up:
	docker compose up -d --build --wait

down:
	docker compose down

logs:
	docker compose logs -f stack-typescript

test:
	npm test
	npm run build
