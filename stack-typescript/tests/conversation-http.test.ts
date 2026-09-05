import { expect, test } from "vitest";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { serve } from "@hono/node-server";
import { generateKeyPair, jwtVerify, SignJWT } from "jose";
import { MockLanguageModelV4 } from "ai/test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { conversationApi } from "../src/conversations/api.js";
import { ConversationStore } from "../src/conversations/store.js";

test("HTTP conversation survives SIGKILL, resumes safely, and compacts through AI SDK without losing records", async () => {
  const dir = mkdtempSync(join(tmpdir(), "conversation-http-"));
  const db = join(dir, "application.sqlite");
  const store = new ConversationStore(db);
  const env = await TestWorkflowEnvironment.createLocal();
  const queue = randomUUID();
  const keys = await generateKeyPair("ES256");
  const token = async (tenant: string) => new SignJWT({ tenant }).setProtectedHeader({ alg: "ES256" }).setSubject("user-a").setIssuer("local-smoke").setAudience("conversation-api").setExpirationTime("5m").sign(keys.privateKey);
  const good = await token("tenant-a");
  const other = await token("tenant-b");
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "text", text: "The user requested record approval. Earlier records remain retrievable. Approval is governed separately." }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
    warnings: [],
  } });
  const app = conversationApi({ client: env.client, store, taskQueue: queue, model, authenticate: async authorization => {
    if (!authorization?.startsWith("Bearer ")) throw new Error("Missing bearer");
    const { payload } = await jwtVerify(authorization.slice(7), keys.publicKey, { issuer: "local-smoke", audience: "conversation-api", algorithms: ["ES256"] });
    if (!payload.sub || typeof payload.tenant !== "string") throw new Error("Missing identity");
    return { tenant: payload.tenant, user: payload.sub };
  } });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
  if (!server.listening) await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP address");
  const url = `http://127.0.0.1:${address.port}`;
  let child: ChildProcess | undefined;
  let log = "";
  const start = () => {
    child = spawn(process.execPath, ["--import", "tsx", "src/conversations/worker-entry.ts"], {
      env: { ...process.env, CONVERSATION_DB: db, TEMPORAL_ADDRESS: env.address, CONVERSATION_QUEUE: queue }, stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", data => { log += data; });
    child.stderr?.on("data", data => { log += data; });
  };
  const request = (path: string, body?: unknown, bearer = good) => fetch(url + path, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  async function wait(path: string, status: string) {
    for (let i = 0; i < 100; i++) {
      const r = await request(path);
      const state = await r.json() as { status?: string; proposal?: { requestId: string } };
      if (state.status === status) return state;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Waiting for ${status}: ${log.slice(-2000)}`);
  }
  try {
    start();
    expect((await request("/", {}, "bad-token")).status).toBe(401);
    const created = await request("/", {});
    expect(created.status).toBe(201);
    const { conversationId } = await created.json() as { conversationId: string };
    const path = `/${conversationId}`;
    store.db.prepare("INSERT INTO permissions VALUES ('tenant-a','user-a',1)").run();
    store.db.prepare("INSERT INTO records VALUES ('tenant-a','record-http',150,1,'pending')").run();
    const body = { jobId: randomUUID(), recordId: "record-http", message: "Please prepare this action for my approval." };
    expect((await request(`${path}/jobs`, body)).status).toBe(201);
    expect((await request(`${path}/jobs`, body)).status).toBe(201);
    expect((await request(`${path}/jobs`, { ...body, jobId: randomUUID() })).status).toBe(409);
    const job = `${path}/jobs/${body.jobId}`;
    const pending = await wait(job, "waiting");
    const exited = once(child!, "exit");
    child!.kill("SIGKILL");
    await exited;
    child = undefined;
    // Product history is readable even when no agent worker process exists.
    const saved = await (await request(path)).json();
    expect((await request(path, undefined, other)).status).toBe(403);
    expect((await request(`${job}/approval`, { requestId: pending.proposal!.requestId, choice: "allow" }, other)).status).toBe(403);
    start();
    expect((await wait(job, "waiting")).proposal).toEqual(pending.proposal);
    expect(await (await request(path)).json()).toEqual(saved);
    expect((await request(`${job}/approval`, { requestId: pending.proposal!.requestId, choice: "allow" })).status).toBe(200);
    await wait(job, "completed");
    expect(store.db.prepare("SELECT * FROM effects").all()).toHaveLength(1);
    expect((await request(`${job}/approval`, { requestId: pending.proposal!.requestId, choice: "allow" })).status).not.toBe(200);
    for (let i = 0; i < 10; i++) store.append(conversationId, `followup-${i}`, "user-message", { text: `Earlier detail ${i}` });
    const original = await (await request(path)).json();
    const compacted = await request(`${path}/compact`, {});
    expect(compacted.status).toBe(200);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await (await request(path)).json()).toEqual(original);
    const context = await compacted.json() as { summary: string; recent: unknown[] };
    expect(context.summary).toContain("governed separately");
    expect(context.recent).toHaveLength(6);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, "exit"); child.kill("SIGTERM"); await stopped; }
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
    await env.teardown();
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
