# Zitadel and agentgateway platform comparison

This proof of concept compares three ways to build a self-hosted authentication, MCP, and agent platform. The .NET, Python, and TypeScript implementations expose the same tools, use the same mock data, and run behind a shared harness so their behavior can be evaluated consistently.

The platform combines:

- Zitadel for identity, organizations, roles, and OAuth/OIDC
- agentgateway for authenticated MCP access and model routing
- a shared MCP service contract and mock GraphQL system of record
- durable agent execution with human approval steps
- a shared Next.js chat interface
- OpenTelemetry collection and automated acceptance tests

All identities, organizations, timesheets, and upstream records are synthetic. The checked-in environment examples contain placeholders only.

## Implementations

| Directory | Application stack | Durable execution |
| --- | --- | --- |
| `stack-dotnet` | ASP.NET Core, Microsoft Agent Framework, and the MCP C# SDK | Microsoft Durable Task Scheduler |
| `stack-python` | FastAPI, Pydantic AI, and the MCP Python SDK | Temporal |
| `stack-typescript` | Hono, Vercel AI SDK, and the MCP TypeScript SDK | Temporal |

Each implementation provides the same authenticated MCP tools and agent workflow. The shared test driver evaluates token validation, tenant and role scoping, streaming UI behavior, durable recovery, human approval, audit reconstruction, and shutdown behavior.

## Durable conversation example

The TypeScript [durable conversation sample](stack-typescript/src/conversations/README.md)
demonstrates persistent approval waits, worker-process recovery, current authorization
checks, separate application history and non-destructive context compaction.
Its macOS smoke tests run local Temporal servers without Docker or model credentials.

## Prerequisites

- Docker with Docker Compose
- Node.js and npm
- An OpenAI API key for model-backed acceptance tests

The .NET and Python unit-test targets use SDK containers, so local .NET and Python installations are not required for those commands.

## Start the harness

Create the local environment file:

```bash
cd harness
cp .env.example .env
```

Set `OPENAI_API_KEY` in `harness/.env`, then start and verify the shared services:

```bash
make harness-check
```

This starts Zitadel, agentgateway, Temporal, the Durable Task Scheduler emulator, the mock upstream API, the registration broker, the reference MCP server, telemetry collection, and the shared UI. It also runs the reference acceptance checks.

Useful local endpoints:

| Service | URL |
| --- | --- |
| Zitadel | http://localhost:8080 |
| agentgateway MCP | http://localhost:3000/mcp |
| agentgateway model endpoint | http://localhost:3001/v1 |
| Shared UI | http://localhost:3100 |
| Registration broker | http://localhost:4200 |
| Mock GraphQL API | http://localhost:4100/graphql |
| Temporal UI | http://localhost:8233 |
| Durable Task Scheduler dashboard | http://localhost:8082 |

## Run an implementation

Copy the generated, non-secret Zitadel identifiers from `harness/.env` into the selected stack's local `.env` file after the harness setup completes. Start that implementation from the repository root:

```bash
cd stack-typescript
cp .env.example .env
make up
```

Use `stack-python` or `stack-dotnet` instead to run either alternative.

Point the shared gateway and UI at the running implementation, then execute its acceptance suite:

```bash
cd harness
make use-stack STACK=typescript
make test STACK=typescript
```

Valid stack names are `dotnet`, `python`, `typescript`, and `ref`.

Run an implementation's unit tests from its directory with:

```bash
make test
```

Stop the implementation with `make down`. Stop the shared platform from `harness` with:

```bash
make down
```

## Repository layout

- `harness`: shared infrastructure, UI, reference MCP server, mock API, and acceptance driver
- `stack-dotnet`: .NET implementation
- `stack-python`: Python implementation
- `stack-typescript`: TypeScript implementation

Local `.env` files, credentials, databases, dependencies, build output, and generated test reports are ignored by Git.
