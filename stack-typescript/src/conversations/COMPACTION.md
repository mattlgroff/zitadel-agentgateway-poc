# Automatic application-managed compaction

This branch implements an OpenCode-inspired preflight budget check, summary checkpoint,
and recent-context window. It does not switch providers, models or strategies on failure.

## Source precedent

[Reviewed OpenCode algorithm, bbd72fb8](https://github.com/anomalyco/opencode/blob/bbd72fb8b0bb6de580d2041a0150016227c63ac0/packages/core/src/session/compaction.ts).

This is a small independent implementation inspired by the structure, not a vendored
copy or a claim of identical behavior. Like that source, it estimates serialized
tokens, truncates large tool results in the summary projection, asks the selected
model for a checkpoint using a fresh request, and carries the previous checkpoint
forward on subsequent compactions. Original records remain intact.

Differences: this PoC requires all four summary headings, fails explicitly rather
than attempting overflow recovery, uses a controlled smaller test budget, and
stores receipts in JSON rather than integrating OpenCode's event system. The
input is synthetic plain-text business history, not arbitrary media or provider
reasoning blocks. Real tool execution remains outside this context manager.

## Run a real-model proof

Configure these environment variables locally; do not commit credentials:

- `COMPACTION_BASE_URL`: approved Responses-compatible inference endpoint, normally through agentgateway.
- `OPENAI_API_KEY` (or `COMPACTION_API_KEY`): local credential for that endpoint.
- `COMPACTION_MODEL`: fixed model for summary and continuation calls.
- `COMPACTION_MODEL_CONTEXT_LIMIT`: verified model limit, at least 8000.
- `COMPACTION_RECEIPTS_DIR`: optional output directory.

Run `npm run prove:compaction` from `stack-typescript`. It loads the ignored local
`.env` file if present. Summary and continuation calls use medium reasoning.

The runner uses actual AI SDK inference calls with `store: false`, no automatic
SDK retries and no replacement model. That flag is not a certification of ZDR or
regional processing; the approved provider arrangement must supply those controls.
The current adapter is OpenAI Responses-compatible. Other provider adapters are
not implemented or proven by this runner.

## Acceptance and receipts

The runner seeds a synthetic purchase-preparation request, adds verbose catalog
lookups until preflight exceeds an 8000-token controlled budget, summarizes and
asks the real model to continue. It then changes the destination, grows history
again, compacts again and checks the updated answer against exact expected fields.
No expected answers are supplied in the continuation prompt.

`receipts/automatic-compaction/result.json` records pass/fail, request bodies,
actual generated summaries and answers, provider response IDs, reported usage,
latency, estimated before/after sizes, acceptance checks, original records and
the executing commit. Failed runs also write receipts; a missing live receipt is
not a passing proof. Review output before publishing even though the fixture is
synthetic. Credentials and request headers are deliberately not recorded.

This verifies continuation facts, not every aspect of semantic summary quality.
It is not a full-provider-window stress test, production concurrency benchmark,
external-write idempotency test, or approval authorization test. The existing
durable approval tests cover that separate local behavior. Unit tests use mocks
and must never be represented as the real-model receipt.
