import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Client } from "@temporalio/client";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { compactConversation } from "./context.js";
import type { Principal } from "./contracts.js";
import { ConversationStore } from "./store.js";
import { approvalResponse, conversationJobState, durableApprovalJob } from "./workflow.js";

export function conversationApi(options: {
  client: Client; store: ConversationStore; taskQueue: string;
  authenticate: (authorization: string | undefined) => Promise<Principal>;
  model?: LanguageModel;
}) {
  const { client, store, taskQueue } = options;
  const app = new Hono<{ Variables: { actor: Principal } }>();
  app.use("*", async (c, next) => {
    try { c.set("actor", await options.authenticate(c.req.header("authorization"))); }
    catch { return c.json({ error: "unauthorized" }, 401); }
    await next();
  });
  app.onError((error, c) => c.json({ error: error.message.includes("access denied") ? "forbidden" : "request_failed" }, error.message.includes("access denied") ? 403 : 409));
  app.post("/", c => {
    const id = randomUUID();
    store.create(id, c.get("actor"));
    return c.json({ conversationId: id }, 201);
  });
  app.get("/:id", c => c.json({ events: store.history(c.req.param("id"), c.get("actor")) }));
  app.post("/:id/jobs", async c => {
    const body = z.object({ jobId: z.string().uuid(), recordId: z.string().min(1), message: z.string().min(1).max(20_000) }).parse(await c.req.json());
    const actor = c.get("actor");
    const conversationId = c.req.param("id");
    store.history(conversationId, actor);
    const input = { ...actor, conversationId, jobId: body.jobId, recordId: body.recordId };
    const prior = store.db.prepare("SELECT * FROM jobs WHERE id=?").get(input.jobId);
    if (prior && (prior.conversation !== conversationId || prior.record !== body.recordId)) throw new Error("Job identity conflict");
    const message = store.db.prepare("SELECT body FROM events WHERE event_key=?").get(`${input.jobId}:message`);
    if (message && JSON.parse(String(message.body)).text !== body.message) throw new Error("Job message conflict");
    // Reserve before starting so concurrent HTTP requests cannot start two jobs.
    if (!prior) await store.prepare(input);
    store.append(conversationId, `${input.jobId}:message`, "user-message", { text: body.message });
    try {
      await client.workflow.start(durableApprovalJob, { workflowId: input.jobId, taskQueue, args: [input], workflowIdReusePolicy: "REJECT_DUPLICATE" });
    } catch (error) {
      if (!(error instanceof Error) || error.name !== "WorkflowExecutionAlreadyStartedError") throw error;
    }
    return c.json({ jobId: input.jobId }, 201);
  });
  async function job(id: string, jobId: string, actor: Principal) {
    store.history(id, actor);
    const row = store.db.prepare("SELECT id FROM jobs WHERE id=? AND conversation=?").get(jobId, id);
    if (!row) throw new Error("Job access denied");
    return client.workflow.getHandle(jobId);
  }
  app.get("/:id/jobs/:job", async c => {
    const handle = await job(c.req.param("id"), c.req.param("job"), c.get("actor"));
    return c.json(await handle.query(conversationJobState));
  });
  app.post("/:id/jobs/:job/approval", async c => {
    const body = z.object({ requestId: z.string().min(1), choice: z.enum(["allow", "decline"]) }).parse(await c.req.json());
    const actor = c.get("actor");
    const handle = await job(c.req.param("id"), c.req.param("job"), actor);
    await handle.executeUpdate(approvalResponse, { args: [{ ...actor, ...body }] });
    return c.json({ accepted: true });
  });
  app.get("/:id/context", c => c.json(store.context(c.req.param("id"), c.get("actor"))));
  app.post("/:id/compact", async c => {
    if (!options.model) return c.json({ error: "model_not_configured" }, 503);
    return c.json(await compactConversation(store, c.req.param("id"), c.get("actor"), options.model));
  });
  return app;
}
