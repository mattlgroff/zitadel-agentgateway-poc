# Durable conversations proof

This sample separates retained conversation records from an unfinished Temporal
job. A job waits for an exact tool-call approval without an automatic deadline.
Worker shutdown is not cancellation. A replacement worker reconstructs workflow
state and receives the approval through a validated Temporal Update.

## Run on macOS

```sh
npm install
npm run build
npm run smoke:conversations
SMOKE_REAL_SERVER=1 npx vitest run tests/conversation-recovery.test.ts --maxWorkers=1 --minWorkers=1
```

The tests download local Temporal servers. Docker and model credentials are
not required for these functional smoke tests. Node 22 provides the experimental
SQLite API used by the local application store.

## Boundaries

- `workflow.ts` owns the unfinished job and pending response. It does not contain
  database access or poll while waiting.
- `store.ts` owns application history and the synthetic business operation.
  SQLite is a local proof implementation, not a regional deployment selection.
- `contracts.ts` defines exact proposals, caller context and response identity.
- `api.ts` exposes history, job creation, per-call approval and context endpoints.
  `server-entry.ts` uses the existing token verifier. `worker-entry.ts` runs
  independently from the API process.
- `context.ts` runs summarization through AI SDK with an injected model provider.
- The original model-backed agent remains in `src/agent`. The recovery tests use
  deterministic tool proposals, not a live model or gateway call.

The synthetic operation atomically rechecks permission and record revision,
executes the action and saves an idempotency receipt. A remote business API must
provide equivalent conditional-write and idempotency guarantees. Temporal alone
does not provide exactly-once execution of arbitrary external side effects.

Context compaction writes a derived summary and covered event boundary. Original
events remain retrievable with tenant and owner authorization. The HTTP test
uses AI SDK's mock model to verify integration and preservation, not summary quality.
No summary grants permission or substitutes for the pending approval record.

## Verified behavior

- An approval survives worker replacement and a 35-day test-clock advance without
  scheduling additional Activities while waiting.
- The HTTP test kills a separate worker process with SIGKILL. History remains
  readable and a replacement process resumes the pending request.
- Signed-token validation and tenant isolation reject unauthorized HTTP requests.
  These are locally issued test tokens, not a live identity-provider acceptance test.
- Changed record revisions require fresh approval; removed permissions prevent
  the business effect; Activity retries return the recorded receipt.
- Repeated job creation is idempotent and a second active job is rejected.
- Compaction through AI SDK stores a summary without deleting original events.

## Run with the existing platform

Set `CONVERSATION_DB` to an absolute SQLite file path and `TEMPORAL_ADDRESS` to
the server address. Both processes must share the application database. Configure
the identity environment used by `src/mcp-server/auth.ts` for the API.
Optional `GATEWAY_BASE_URL` and `GATEWAY_MODEL` enable live summarization.

Run `npm run conversations:api` and `npm run conversations:worker` in separate
terminals. The API binds to loopback port 5050 by default. Tests demonstrate
synthetic record and permission seeding. No fixture-write endpoint is exposed.
Job requests supply a UUID `jobId` as their retry identity.

## Verification limits

The sample is not a production-readiness claim. Live identity-provider and gateway
integration, summary quality, server/database failover, UI reconnection,
retention/deletion operations and production capacity require separate verification. The test
clock advances time; it is not a month-long wall-clock soak test.
