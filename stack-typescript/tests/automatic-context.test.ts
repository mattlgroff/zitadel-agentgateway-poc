import { expect, test } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import { AutomaticContext } from "../src/conversations/automatic-context.js";

const response = (text: string) => ({
  content: [{ type: "text" as const, text }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
  warnings: [],
});
const summary = "## Objective\nPrepare request.\n## Important Details\nApproval pending.\n## Work State\n### Completed\nLookup.\n### Active\nPreparation.\n### Blocked\nApproval.\n## Next Move\nWait for approval.\n## Relevant Files\n(none)";

test("two automatic checkpoints use the previous summary and preserve all original records", async () => {
  let call = 0;
  const model = new MockLanguageModelV4({ doGenerate: async () => response(++call % 2 === 1 ? summary : "Still pending approval.") });
  const context = new AutomaticContext(model, { contextLimit: 8000, outputTokens: 1800, buffer: 2400, keepTokens: 600 });
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 10; i++) context.append({ id: `${round}-${i}`, kind: "tool-result", text: "Irrelevant catalog entry. ".repeat(170) });
    context.append({ id: `user-${round}`, kind: "user", text: "Do not purchase without approval." });
    const before = JSON.stringify(context.history);
    await expect(context.answer("What next?")).resolves.toBe("Still pending approval.");
    expect(context.checkpoints).toHaveLength(round + 1);
    expect(JSON.stringify(context.history)).toBe(before);
  }
  expect(model.doGenerateCalls).toHaveLength(4);
  expect(JSON.stringify(model.doGenerateCalls[2])).toContain("<prior-summary>");
  expect(JSON.stringify(model.doGenerateCalls[0])).toContain("Create a new anchored summary");
  expect(JSON.stringify(model.doGenerateCalls[2])).toContain("the conversation wins");
  expect(context.events.filter(e => e.type === "compaction-completed").every(e => Number(e.after) < Number(e.before))).toBe(true);
});

test("invalid summaries do not replace context and do not trigger another strategy", async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => response("not a valid checkpoint") });
  const context = new AutomaticContext(model, { contextLimit: 8000, outputTokens: 1800, buffer: 2400, keepTokens: 600 });
  for (let i = 0; i < 10; i++) context.append({ id: `${i}`, kind: "tool-result", text: "Archived entry. ".repeat(300) });
  await expect(context.answer("Continue")).rejects.toThrow("Invalid checkpoint");
  expect(context.checkpoints).toHaveLength(0);
  expect(context.history).toHaveLength(10);
  expect(model.doGenerateCalls).toHaveLength(1);
});

test("invalid budgets are rejected before making model calls", () => {
  expect(() => new AutomaticContext(new MockLanguageModelV4(), { contextLimit: 100, outputTokens: 80, buffer: 50, keepTokens: 40 })).toThrow("Insufficient context");
});

test("oversized instructions fail explicitly without switching strategy", async () => {
  const model = new MockLanguageModelV4();
  const context = new AutomaticContext(model, { contextLimit: 1000, outputTokens: 100, buffer: 200, keepTokens: 100 });
  context.append({ id: "one", kind: "user", text: "hello" });
  await expect(context.answer("huge ".repeat(3000))).rejects.toThrow("No older context");
  expect(model.doGenerateCalls).toHaveLength(0);
  expect(context.checkpoints).toHaveLength(0);
  expect(context.history).toHaveLength(1);
});
