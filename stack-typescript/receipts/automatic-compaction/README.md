# Real-model run: September 5, 2026

[Machine-readable receipt](result.json) includes the exact synthetic input,
four inference requests, generated summaries and continuations, provider response
IDs, token usage and acceptance checks. Executing source: `e2d5ef95aa6a5e0eb4dc45933be61b8ad1b2f9f8`, clean worktree.

- Model: `gpt-5.6-luna`, medium reasoning, all four calls.
- Transport: direct OpenAI Responses API, not agentgateway.
- Result: 24/24 acceptance checks passed; two automatic checkpoints.
- Controlled context budget: 8,000 estimated tokens; trigger above 5,600.
- First cycle: 11,162 estimated input tokens reduced to 823.
- Second cycle: 11,872 estimated input tokens reduced to 867.
- Provider-reported input tokens: 3,114 and 3,613 for summaries; 601 and 648 for continuations.
- Provider-reported output tokens across all four calls: 806, including reasoning.
- Four calls took 10,661 ms total (network plus inference, not a latency guarantee).

The estimates and provider token counts are different measurements. Pre-compaction
estimates describe the assembled uncompressed continuation, not a request sent to
the provider. Summary requests use a projection that truncates verbose tool output.
This is a controlled-budget functional test, not a million-token benchmark.

After both compactions, continuation preserved the request ID, quantity, maximum
price, supplier, SKU, quoted price and pending approval. After the second it used
the corrected destination, Utrecht. Original records were unchanged by compaction.
No tools performed real business actions. The test verifies the model's stated
approval status, not real authorization enforcement.

Not proven here: agentgateway compatibility, Anthropic signed-thinking handling,
production load, broad semantic quality, region enforcement or contractual ZDR.
`store: false` was supplied; it does not certify account-level retention controls.
