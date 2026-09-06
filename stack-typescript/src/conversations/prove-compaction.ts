import { createOpenAI } from "@ai-sdk/openai";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { AutomaticContext } from "./automatic-context.js";
import { OPENCODE_REVISION } from "./opencode-v2-prompt.js";

const { COMPACTION_BASE_URL, COMPACTION_API_KEY, COMPACTION_MODEL, COMPACTION_MODEL_CONTEXT_LIMIT } = process.env;
const apiKey = COMPACTION_API_KEY ?? process.env.OPENAI_API_KEY;
if (!COMPACTION_BASE_URL || !apiKey || !COMPACTION_MODEL || !COMPACTION_MODEL_CONTEXT_LIMIT) throw new Error("Configure COMPACTION_BASE_URL, OPENAI_API_KEY (or COMPACTION_API_KEY), COMPACTION_MODEL and COMPACTION_MODEL_CONTEXT_LIMIT locally. No automatic endpoint or model fallback.");
const actualLimit = Number(COMPACTION_MODEL_CONTEXT_LIMIT);
const testLimit = 8000;
if (!Number.isInteger(actualLimit) || actualLimit < testLimit) throw new Error("Configured model context limit must be at least the 8000-token controlled test budget");
const provider = createOpenAI({ baseURL: COMPACTION_BASE_URL, apiKey });
const engine = new AutomaticContext(provider.responses(COMPACTION_MODEL), { contextLimit: testLimit, outputTokens: 1800, buffer: 2400, keepTokens: 600 });
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const directory = process.env.COMPACTION_RECEIPTS_DIR ?? "receipts/automatic-compaction-v2";
await mkdir(directory, { recursive: true });
const checks: Array<{ name: string; passed: boolean }> = [];
let failure: string | undefined;
try {
  engine.append({ id: "request-1", kind: "user", text: "Prepare purchase request REQ-4821 for exactly 7 monitors. Maximum unit price USD 240. Delivery destination Rotterdam. Never place the order without explicit approval. Approval is currently pending. Preserve these requirements throughout the conversation." });
  engine.append({ id: "lookup-1", kind: "tool-result", text: "Supplier QUARTZ offers SKU MON-27Q at USD 215 per unit. Inventory: 18. This is a lookup, not a purchase. No business action has occurred." });
  const question = "Return ONLY JSON with requestId, quantity, maxUnitPrice, destination, supplier, sku, quotedUnitPrice, approvalStatus, mayPlaceOrder. Use the latest facts; do not execute anything.";
  for (let round = 1; round <= 2; round++) {
    if (round === 2) engine.append({ id: "correction", kind: "user", text: "Correction: delivery destination is Utrecht, not Rotterdam. All other requirements and pending approval remain unchanged." });
    for (let i = 0; i < 10; i++) engine.append({ id: `lookup-${round}-${i}`, kind: "tool-result", text: `Unrelated catalog archive batch ${round}/${i}. No changes to the active request. ` + "Archived accessory listing; irrelevant to the requested monitors. ".repeat(64) });
    engine.append({ id: `recent-${round}`, kind: "user", text: "Please continue preparing the request; do not purchase." });
    const originals = hash(engine.history);
    const answer = await engine.answer(question);
    const parsed = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, ""));
    const expected = { requestId: "REQ-4821", quantity: 7, maxUnitPrice: 240, destination: round === 1 ? "Rotterdam" : "Utrecht", supplier: "QUARTZ", sku: "MON-27Q", quotedUnitPrice: 215, approvalStatus: "pending", mayPlaceOrder: false };
    for (const [key, value] of Object.entries(expected)) checks.push({ name: `round-${round}:${key}`, passed: parsed[key] === value });
    checks.push({ name: `round-${round}:original-history-unchanged`, passed: originals === hash(engine.history) });
    checks.push({ name: `round-${round}:automatic-checkpoint`, passed: engine.checkpoints.length === round });
    engine.append({ id: `answer-${round}`, kind: "agent", text: answer });
  }
  checks.push({ name: "one-returned-model-throughout", passed: new Set(engine.receipts.map(r => r.modelId)).size === 1 });
  checks.push({ name: "four-real-responses", passed: engine.receipts.length === 4 && engine.receipts.every(r => Boolean(r.responseId)) });
  if (checks.some(c => !c.passed)) throw new Error("Continuation acceptance checks failed");
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
const report = { upstreamRevision: OPENCODE_REVISION, promptImplementation: "Verbatim OpenCode V2 initial and update prompt builder; no summary system prompt", generatedAt: new Date().toISOString(), commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()), requestedModel: COMPACTION_MODEL, endpoint: new URL(COMPACTION_BASE_URL).origin, actualModelContextLimit: actualLimit, controlledTestContextLimit: testLimit, policy: engine.policy, pass: !failure, failure, checks, events: engine.events, checkpoints: engine.checkpoints, calls: engine.receipts, originalHistory: engine.history, limitations: ["Synthetic records; no real business writes", "Controlled budget lower than provider capacity; not a full-window load test", "No provider-retention or region certification", "Character-count token estimates, not exact provider tokenization"] };
await writeFile(`${directory}/result.json`, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ pass: report.pass, failure, checks, events: engine.events, calls: engine.receipts.map(({ purpose, responseId, modelId, usage, elapsedMs }) => ({ purpose, responseId, modelId, usage, elapsedMs })), receipt: `${directory}/result.json` }, null, 2));
if (failure) process.exitCode = 1;
