import { Client } from "@temporalio/client";
import { WorkflowStreamClient } from "@temporalio/workflow-streams/client";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { callerFromAuth, verifyAccessToken } from "../mcp-server/auth.js";
import { authorize } from "../policy/approval.js";
import { tools } from "../tools/index.js";
import { enrichCaller } from "../types.js";
import { decisionSignal, killAuditSignal, ownerQuery, stateQuery, streamConsumedSignal, timesheetReview } from "./workflow.js";
import { decisionsSchema, type DecisionEnvelope, type ReviewInput, type ReviewState, type StreamEvent } from "./contracts.js";

export function registerAgentRoutes(app: Hono<{ Variables: { authInfo: AuthInfo } }>, client: Client): void {
  app.post("/chat", async (context) => {
    const caller = enrichCaller(callerFromAuth(await authenticate(context.req.header("authorization"))));
    const body = await context.req.json<{ messages?: UIMessage[] }>();
    const text = [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.parts
      .filter((part) => part.type === "text").map((part) => part.text).join(" ") || "Review my pending timesheets.";
    const runId = randomUUID().replaceAll("-", "");
    if (text.length > 20_000) return context.json({ error: "validation", message: "Prompt is too long." }, 400);
    const input: ReviewInput = { caller, prompt: text, model: process.env.GATEWAY_MODEL ?? "gpt-5.6-luna" };
    await client.workflow.start(timesheetReview, { workflowId: runId, taskQueue: "agents-typescript", args: [input] });

    return streamResponse(client, runId, { "x-workflow-run-id": runId });
  });

  app.get("/introspect/tools", (context) => context.json(Object.keys(tools).map((name) => ({
    name,
    implRef: `src/tools/${name.replaceAll("_", "-")}.ts`,
    registeredFor: ["mcp", "agent"],
  }))));

  app.get("/runs/:id/stream", async (context) => {
    const actor = enrichCaller(callerFromAuth(await authenticate(context.req.header("authorization"))));
    if (!await canAccessRun(client, context.req.param("id"), actor)) return context.json({ error: "not_authorized" }, 403);
    return streamResponse(client, context.req.param("id"));
  });

  app.get("/runs/:id/history", async (context) => {
    const actor = enrichCaller(callerFromAuth(await authenticate(context.req.header("authorization"))));
    if (!await canAccessRun(client, context.req.param("id"), actor)) return context.json({ error: "not_authorized" }, 403);
    const history = await client.workflow.getHandle(context.req.param("id")).fetchHistory();
    return context.body(JSON.stringify({ history, decodedPayloads: collectPayloads(history) }, historyReplacer), 200, { "content-type": "application/json" });
  });

  app.post("/runs/:id/decision", async (context) => {
    const actor = enrichCaller(callerFromAuth(await authenticate(context.req.header("authorization"))));
    const verdict = authorize(actor, "approve", null);
    if (!verdict.allowed) return context.json(verdict, 403);
    const runId = context.req.param("id");
    if (!await canAccessRun(client, runId, actor)) return context.json({ error: "not_authorized" }, 403);
    const parsed = decisionsSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) return context.json({ error: "validation", message: parsed.error.issues[0]?.message ?? "Invalid decisions." }, 400);
    const state = await client.workflow.getHandle(runId).query<ReviewState>(stateQuery);
    const pending = new Set(state.pending.map((item) => item.id));
    if (parsed.data.decisions.some((decision) => !pending.has(decision.timesheet_id))) return context.json({ error: "validation", message: "Decisions must reference pending items." }, 400);
    const envelope: DecisionEnvelope = { actor, decisions: parsed.data.decisions };
    await client.workflow.getHandle(runId).signal(decisionSignal, envelope);
    return context.json({ accepted: true });
  });

  app.get("/runs/:id", async (context) => {
    const actor = enrichCaller(callerFromAuth(await authenticate(context.req.header("authorization"))));
    if (!await canAccessRun(client, context.req.param("id"), actor)) return context.json({ error: "not_authorized" }, 403);
    const state = await client.workflow.getHandle(context.req.param("id")).query<ReviewState>(stateQuery);
    return context.json(state);
  });

  app.post("/admin/runs/terminate", async (context) => {
    let actor;
    try {
      actor = enrichCaller(callerFromAuth(await authenticate(context.req.header("authorization"))));
    } catch {
      return context.json({ error: "unauthorized" }, 401);
    }
    const permission = authorize(actor, "terminate", null);
    if (!permission.allowed) return context.json(permission, 403);
    const payload: { reason?: string } = await context.req.json<{ reason?: string }>().catch(() => ({}));
    const reason = payload.reason?.trim();
    if (!reason) return context.json({ error: "validation", message: "A termination reason is required." }, 400);
    const terminated: string[] = [];
    for await (const workflow of client.workflow.list({ query: 'WorkflowType="timesheetReview" AND ExecutionStatus="Running"' })) {
      const handle = client.workflow.getHandle(workflow.workflowId);
      await handle.signal(killAuditSignal, { actorSub: actor.sub, reason, timestamp: new Date().toISOString() });
      await handle.terminate(`operator kill switch: ${reason}`);
      terminated.push(workflow.workflowId);
    }
    return context.json({ terminated, actorSub: actor.sub, reason });
  });
}

async function canAccessRun(client: Client, runId: string, actor: ReturnType<typeof enrichCaller>): Promise<boolean> {
  if (actor.roles.includes("operator")) return true;
  const owner = await client.workflow.getHandle(runId).query<ReturnType<typeof enrichCaller>>(ownerQuery).catch(() => undefined);
  return !!owner && owner.orgId === actor.orgId && (owner.sub === actor.sub || actor.roles.includes("program_office"));
}

function collectPayloads(value: unknown, found: unknown[] = []): unknown[] {
  if (!value || typeof value !== "object") return found;
  if ("metadata" in value && "data" in value) {
    const data = (value as { data: unknown }).data;
    const bytes = data instanceof Uint8Array
      ? Buffer.from(data)
      : data && typeof data === "object" && (data as { type?: string }).type === "Buffer" && Array.isArray((data as { data?: unknown }).data)
        ? Buffer.from((data as { data: number[] }).data)
        : undefined;
    if (bytes) {
      const text = bytes.toString("utf8");
      try { found.push(JSON.parse(text)); } catch { found.push(text || bytes.toString("base64")); }
    }
  }
  for (const child of Object.values(value)) collectPayloads(child, found);
  return found;
}

function historyReplacer(key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value);
  if (key === "eventTime" && value && typeof value === "object" && "seconds" in value) {
    const timestamp = value as { seconds: bigint | number | string; nanos?: number };
    return new Date(Number(timestamp.seconds) * 1000 + Number(timestamp.nanos ?? 0) / 1_000_000).toISOString();
  }
  return typeof value === "bigint" ? value.toString() : value;
}

function streamResponse(client: Client, runId: string, headers?: HeadersInit) {
  const stream = createUIMessageStream({ execute: async ({ writer }) => {
    writer.write({ type: "start", messageId: runId });
    const workflowStream = WorkflowStreamClient.create(client, runId);
    for await (const item of workflowStream.topic<StreamEvent>("ui").subscribe(0)) {
      const event = item.data;
      writeEvent(writer, runId, event);
      if (event.type === "completed") {
        await client.workflow.getHandle(runId).signal(streamConsumedSignal).catch(() => undefined);
        break;
      }
    }
  } });
  return createUIMessageStreamResponse({ stream, headers });
}

function writeEvent(writer: { write(part: any): void }, runId: string, event: StreamEvent): void {
  if (event.type === "tool-start") writer.write({ type: "tool-input-available", toolCallId: event.toolCallId, toolName: event.toolName, input: event.input, dynamic: true });
  if (event.type === "tool-end") writer.write({ type: "tool-output-available", toolCallId: event.toolCallId, output: event.output, dynamic: true });
  if (event.type === "waiting") writer.write({ type: "data-approval-request", data: { runId, timesheets: event.state.pending } });
  if (event.type === "completed") {
    const id = `${runId}-summary`;
    writer.write({ type: "text-start", id });
    writer.write({ type: "text-delta", id, delta: event.state.summary ?? "[AI-generated] Completed." });
    writer.write({ type: "text-end", id });
    writer.write({ type: "finish", finishReason: "stop" });
  }
}

async function authenticate(authorization: string | undefined) {
  if (!authorization?.startsWith("Bearer ")) throw new Error("Unauthorized");
  return verifyAccessToken(authorization.slice(7));
}
