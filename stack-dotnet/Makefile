SHELL := /bin/bash

.PHONY: build test up down
build:
	docker build -t stack-dotnet:local .

test:
	docker run --rm -v "$(CURDIR):/src" -w /src mcr.microsoft.com/dotnet/sdk:10.0 dotnet test tests/StackDotnet.Tests.csproj

up:
	docker compose up -d --build --wait

down:
	docker compose down
