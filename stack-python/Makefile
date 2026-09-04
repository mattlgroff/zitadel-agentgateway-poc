.PHONY: build up down logs test

build:
	docker compose build

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f stack-python

test:
	docker run --rm -v "$(CURDIR):/app" -w /app python:3.13-slim sh -lc 'pip install -q ".[test]" && pytest -q'
