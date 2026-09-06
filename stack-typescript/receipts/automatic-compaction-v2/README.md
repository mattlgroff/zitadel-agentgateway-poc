# OpenCode V2 prompt live proof

September 5, 2026. Supersedes the earlier custom-prompt proof.

- Executed clean implementation commit `4bfe770`.
- Exact initial and update prompt builder from OpenCode V2 `7c2199d84a5830f70a8250731a42ff958145b4d6`, including the complete template. Source constants and builder compared verbatim.
- Four real OpenAI Responses calls, `gpt-5.6-luna`, medium reasoning. No summary system prompt or tools.
- All 24 checks passed across two checkpoints, including the corrected destination, original-history preservation and pending-approval facts.
- Estimated context: 11162 to 930, then 11978 to 969. Controlled threshold: 5600, not a provider-window benchmark.
- Provider input tokens: 3317, 715, 4083, 747. These are distinct from character-based estimates.

See `result.json` for exact prompts, generated summaries, answers, response IDs and usage. This exercises synthetic text history, not production approval authorization, agentgateway routing, regional processing or ZDR certification. The adapter and controlled budgets are documented in `src/conversations/COMPACTION.md`; this is not the entire OpenCode runtime.
