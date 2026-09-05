import { afterAll, beforeAll, expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConversationStore } from "../src/conversations/store.js";
import { approvalResponse, conversationJobState, durableApprovalJob } from "../src/conversations/workflow.js";
import type { JobInput, JobState } from "../src/conversations/contracts.js";

let env: TestWorkflowEnvironment;
let store: ConversationStore;
let worker: Worker;
let running: Promise<void>;
const directory = mkdtempSync(join(tmpdir(), "durable-conversations-"));
const database = join(directory, "history.sqlite");
const actor = { tenant: "tenant-a", user: "user-a" };
const taskQueue = "conversation-smoke";

async function startWorker() {
  store = new ConversationStore(database);
  worker = await Worker.create({
    connection: env.nativeConnection, taskQueue, maxCachedWorkflows: 0,
    workflowsPath: fileURLToPath(new URL("../src/conversations/workflow.ts", import.meta.url)),
    activities: { prepare: store.prepare.bind(store), resolve: store.resolve.bind(store) },
  });
  running = worker.run();
}
async function stopWorker() { worker.shutdown(); await running; store.close(); }
async function state(handle: ReturnType<typeof env.client.workflow.getHandle>, status: JobState["status"], revision?: number) {
  for (let i = 0; i < 100; i++) {
    const value = await handle.query(conversationJobState);
    if (value.status === status && (revision === undefined || value.proposal?.revision === revision)) return value;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Did not reach ${status}/${revision}`);
}
beforeAll(async () => {
  env = process.env.SMOKE_REAL_SERVER === "1"
    ? await TestWorkflowEnvironment.createLocal()
    : await TestWorkflowEnvironment.createTimeSkipping();
  await startWorker();
}, 120_000);
afterAll(async () => {
  if (worker) await stopWorker();
  if (env) await env.teardown();
  rmSync(directory, { recursive: true, force: true });
}, 30_000);

test("saved approval survives worker replacement and a long wait; revalidation and compaction preserve history", async () => {
  store.create("conversation-a", actor);
  store.db.prepare("INSERT INTO permissions VALUES (?,?,1)").run(actor.tenant, actor.user);
  store.db.prepare("INSERT INTO records VALUES (?,?,?,1,'pending')").run(actor.tenant, "record-a", 150);
  const input: JobInput = { ...actor, conversationId: "conversation-a", jobId: "job-a", recordId: "record-a" };
  const handle = await env.client.workflow.start(durableApprovalJob, { workflowId: input.jobId, taskQueue, args: [input] });
  const waiting = await state(handle, "waiting", 1);
  const before = await handle.fetchHistory();
  await stopWorker();
  await env.sleep(env.supportsTimeSkipping ? "35 days" : 1000);
  await startWorker();
  console.info("smoke: replacement worker started");
  expect((await state(handle, "waiting", 1)).proposal).toEqual(waiting.proposal);
  console.info("smoke: pending approval restored");
  const after = await handle.fetchHistory();
  const activityCount = (history: typeof before) => history?.events?.filter(e => e.activityTaskScheduledEventAttributes).length;
  expect(activityCount(after)).toBe(activityCount(before));
  expect(store.history(input.conversationId, actor)).toHaveLength(1);

  await expect(handle.executeUpdate(approvalResponse, { args: [{ ...actor, tenant: "tenant-b", requestId: waiting.proposal!.requestId, choice: "allow" }] })).rejects.toThrow();
  console.info("smoke: cross-tenant response rejected");
  expect(() => store.history(input.conversationId, { ...actor, tenant: "tenant-b" })).toThrow("access denied");

  store.db.prepare("UPDATE records SET amount=250,revision=2 WHERE id='record-a'").run();
  await handle.executeUpdate(approvalResponse, { args: [{ ...actor, requestId: waiting.proposal!.requestId, choice: "allow" }] });
  const refreshed = await state(handle, "waiting", 2);
  console.info("smoke: changed inputs refreshed");
  expect(refreshed.proposal!.input.amount).toBe(250);
  expect(store.db.prepare("SELECT * FROM effects").all()).toHaveLength(0);
  await expect(handle.executeUpdate(approvalResponse, { args: [{ ...actor, requestId: waiting.proposal!.requestId, choice: "allow" }] })).rejects.toThrow();

  store.db.prepare("UPDATE permissions SET allowed=0").run();
  await handle.executeUpdate(approvalResponse, { args: [{ ...actor, requestId: refreshed.proposal!.requestId, choice: "allow" }] });
  await state(handle, "waiting", 2);
  expect(store.db.prepare("SELECT * FROM effects").all()).toHaveLength(0);
  store.db.prepare("UPDATE permissions SET allowed=1").run();
  await handle.executeUpdate(approvalResponse, { args: [{ ...actor, requestId: refreshed.proposal!.requestId, choice: "allow" }] });
  expect((await handle.result()).status).toBe("completed");
  // Replaying a completed Activity must return its receipt without repeating the effect.
  await store.resolve(input, refreshed.proposal!, { ...actor, requestId: refreshed.proposal!.requestId, choice: "allow" });
  expect(store.db.prepare("SELECT * FROM effects").all()).toHaveLength(1);

  const original = store.history(input.conversationId, actor);
  await store.compact(input.conversationId, actor, 2, async events => `Summary of ${events.length} earlier events. Inputs changed and were reviewed again.`);
  expect(store.history(input.conversationId, actor)).toEqual(original);
  expect(store.context(input.conversationId, actor).recent).toHaveLength(2);
  expect(store.context(input.conversationId, actor).summary).toContain("reviewed again");
  await stopWorker();
  await startWorker();
  expect(store.history(input.conversationId, actor)).toEqual(original);
  expect(store.context(input.conversationId, actor).recent).toHaveLength(2);
}, 120_000);
