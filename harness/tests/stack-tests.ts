import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
import { decide, json, login, readUiStream, startRun, waitFor, type StreamPart } from "./support.js";

type Status = "pass" | "fail" | "skip";
type Recorder = (id: string, status: Status, evidence: unknown, started: number) => Promise<void>;
type Mutation = { ts: string; mutation: string; id: string; actorId: string; reason: string | null };
type Query = { ts: string; query: string; orgId: string; managerId: string | null; id: string | null };

export async function runStackTests(stack: string, stackUrl: string, record: Recorder): Promise<boolean> {
  let failed = false;
  const run = async (id: string, action: () => Promise<unknown>) => {
    const started = Date.now();
    try { await record(id, "pass", await action(), started); }
    catch (error) { failed = true; await record(id, "fail", { error: error instanceof Error ? error.message : String(error) }, started); }
  };
  const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw new Error(message); };
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const stackFile = `../stack-${stack}/docker-compose.yml`;
  const compose = (...args: string[]) => execFileSync("docker", ["compose", "-f", stackFile, ...args], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: process.env }).trim();
  const service = `stack-${stack}`;
  const container = () => compose("ps", "-q", service);
  const reset = async () => { const response = await fetch("http://localhost:4100/admin/reset", { method: "POST" }); assert(response.ok, `reset failed ${response.status}`); };
  const mutations = async () => (await json<Mutation[]>("http://localhost:4100/admin/mutations")).value;
  const queries = async () => (await json<Query[]>("http://localhost:4100/admin/queries")).value;
  const history = async (runId: string, token: string) => {
    const result = await json(`${stackUrl}/runs/${encodeURIComponent(runId)}/history`, { headers: auth(token) });
    assert(result.response.ok, `history failed ${result.response.status}: ${result.text}`);
    return result.value;
  };
  const replay = async (runId: string, token: string) => readUiStream(await fetch(`${stackUrl}/runs/${encodeURIComponent(runId)}/stream`, { headers: auth(token) }));
  const approval = (parts: StreamPart[]) => parts.find((part) => part.type === "data-approval-request")?.data;
  const toolIds = (value: unknown) => {
    if (stack === "python") {
      const ids = new Set<string>();
      const visit = (node: unknown) => {
        if (!node || typeof node !== "object") return;
        const object = node as Record<string, unknown>;
        const activityType = object.activityType as Record<string, unknown> | undefined;
        if (typeof activityType?.name === "string" && activityType.name.endsWith("__call_tool")) {
          const encoded = JSON.stringify(object);
          for (const match of encoded.matchAll(/\\?"tool_call_id\\?"\s*:\s*\\?"(call_[A-Za-z0-9_-]+)\\?"/g)) ids.add(match[1]);
        }
        for (const child of Object.values(object)) Array.isArray(child) ? child.forEach(visit) : visit(child);
      };
      visit(value);
      return [...ids].sort();
    }
    return [...new Set(JSON.stringify(value).match(/call_[A-Za-z0-9_-]+/g) ?? [])]
      .filter((id) => id !== "call_id" && id !== "call_output")
      .sort();
  };
  const finishPaused = async (runId: string, token: string, ids: string[]) => {
    const stream = replay(runId, token);
    const response = await decide(stackUrl, runId, token, ids.map((timesheet_id) => ({ timesheet_id, action: "skip" })));
    assert(response.ok, `decision failed ${response.status}: ${await response.text()}`);
    return stream;
  };

  const baselineAdaUserId = process.env.ADA_USER_ID;
  assert(baselineAdaUserId, "ADA_USER_ID missing");
  await grantRole(baselineAdaUserId, "hiring_manager");
  await revokeRole(baselineAdaUserId, "viewer");
  const ada = await login("ada@acme.test");
  const grace = await login("grace@acme.test");
  const linus = await login("linus@acme.test");
  const margaret = await login("margaret@globex.test");
  const opie = await login("opie@platform.test");

  await run("T4", async () => {
    await reset();
    const cases = [[ada, ["ts-001", "ts-002", "ts-003", "ts-004"]], [grace, ["ts-001", "ts-002", "ts-003", "ts-004", "ts-005", "ts-006"]], [margaret, ["ts-007", "ts-008"]]] as const;
    const actual: string[][] = [];
    for (const [token, expected] of cases) {
      const output = await mcpCall(token, "list_my_pending_approvals", {});
      const ids = (output.timesheets ?? []).map((item: any) => item.id).sort();
      assert(JSON.stringify(ids) === JSON.stringify(expected), `scope mismatch: ${JSON.stringify({ ids, expected })}`);
      actual.push(ids);
    }
    const queryLog = await queries();
    return { ids: actual, upstreamQueries: queryLog, scopedUpstream: queryLog.map((item) => ({ orgId: item.orgId, managerId: item.managerId })) };
  });

  await run("T5", async () => {
    await reset();
    const output = await mcpCall(linus, "approve_timesheet", { timesheet_id: "ts-001" });
    assert(output.error === "not_authorized", JSON.stringify(output));
    return output;
  });

  let auditRunId = "";
  await run("T6", async () => {
    await reset();
    const started = await startRun(stackUrl, ada);
    auditRunId = started.runId;
    const cardIds = (approval(started.parts)?.timesheets ?? []).map((item: any) => item.id ?? item.timesheet_id).sort();
    const mutationIds = (await mutations()).map((item) => item.id).sort();
    assert(JSON.stringify(cardIds) === JSON.stringify(["ts-003"]), `card mismatch: ${JSON.stringify(cardIds)}`);
    assert(JSON.stringify(mutationIds) === JSON.stringify(["ts-001", "ts-002", "ts-004"]), `mutation mismatch: ${JSON.stringify(mutationIds)}`);
    await finishPaused(started.runId, ada, cardIds);
    return { runId: started.runId, cardIds, mutationIds };
  });

  await run("T7", async () => {
    await reset();
    await fetch("http://localhost:4100/admin/chaos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "ts-001", milliseconds: 10_000 }) });
    const response = await fetch(`${stackUrl}/chat`, { method: "POST", headers: { ...auth(ada), "content-type": "application/json" }, body: JSON.stringify({ messages: [{ id: "crash-user", role: "user", parts: [{ type: "text", text: "Review my pending timesheets." }] }] }) });
    const partsPromise = readUiStream(response).catch(() => [] as StreamPart[]);
    await waitFor(async () => (await mutations()).some((item) => item.id === "ts-001"), 120_000, "first approval");
    compose("stop", service);
    const firstParts = await partsPromise;
    const runId = firstParts.find((part) => part.type === "start")?.messageId ?? response.headers.get("x-workflow-run-id");
    assert(runId, `run ID missing before crash: ${JSON.stringify(firstParts)}`);
    compose("up", "-d", "--wait", service);
    await waitFor(async () => {
      const ids = (await mutations()).map((item) => item.id);
      return ids.includes("ts-002") && ids.includes("ts-004");
    }, 180_000, "post-restart approvals");
    const all = (await mutations()).map((item) => item.id);
    const counts = Object.fromEntries([...new Set(all)].map((id) => [id, all.filter((value) => value === id).length]));
    assert(counts["ts-001"] === 1 && counts["ts-002"] === 1 && counts["ts-004"] === 1, JSON.stringify(counts));
    await waitFor(async () => {
      const result = await json<any>(`${stackUrl}/runs/${encodeURIComponent(runId)}`, { headers: auth(ada) });
      if (!result.response.ok) return false;
      if (result.value.status === "waiting") return result.value.pending?.some((item: any) => (item.id ?? item.timesheet_id) === "ts-003");
      const custom = typeof result.value.customStatus === "string" ? JSON.parse(result.value.customStatus) : result.value.customStatus;
      return custom?.state === "approval" && custom.items?.some((item: any) => (item.id ?? item.Id) === "ts-003");
    }, 240_000, "approval checkpoint");
    await finishPaused(runId, ada, ["ts-003"]);
    await fetch("http://localhost:4100/admin/chaos", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    return { runId, counts };
  });

  await run("T8", async () => {
    await reset();
    const started = await startRun(stackUrl, ada);
    compose("restart", service);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
    const stream = replay(started.runId, ada);
    const response = await decide(stackUrl, started.runId, ada, [{ timesheet_id: "ts-003", action: "approve", reason: "T8 durable human approval" }]);
    assert(response.ok, `decision failed ${response.status}`);
    const parts = await stream;
    assert(parts.some((part) => part.type === "finish") && JSON.stringify(parts).includes("ts-003"), `completion missing: ${JSON.stringify(parts)}`);
    auditRunId = started.runId;
    return { runId: started.runId, waitedMs: 60_000, completed: true };
  });

  await run("T9", async () => {
    await reset();
    const hosts = execFileSync("docker", ["exec", container(), "sh", "-c", "grep 'api.openai.com' /etc/hosts"], { encoding: "utf8" });
    assert(hosts.includes("127.0.0.1"), `provider hostname is not blocked: ${hosts}`);
    let disconnected = false;
    try { execFileSync("docker", ["network", "disconnect", "agent-egress", container()]); disconnected = true; } catch { /* already isolated */ }
    try {
      const started = await startRun(stackUrl, ada);
      await finishPaused(started.runId, ada, ["ts-003"]);
    } finally {
      if (disconnected) execFileSync("docker", ["network", "connect", "agent-egress", container()]);
    }
    const gateway = execFileSync("docker", ["compose", "logs", "--no-color", "agentgateway"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    const records = gateway.split("\n").filter((line) => line.includes("gpt-5.6-luna") && line.includes("usage.input_tokens"));
    assert(records.length > 0, "gateway has no model record with token counts");
    assert(disconnected, "stack container was not attached to agent-egress before the test");
    return { directProviderBlocked: hosts.trim(), egressNetworkDisconnected: disconnected, gatewayRecords: records.slice(-3) };
  });

  await run("T10", async () => {
    const result = await json<any[]>(`${stackUrl}/introspect/tools`, { headers: auth(ada) });
    assert(result.response.ok && result.value.length === 5, result.text);
    assert(result.value.every((item) => item.implRef && JSON.stringify(item.registeredFor?.slice().sort()) === JSON.stringify(["agent", "mcp"])), JSON.stringify(result.value));
    assert(new Set(result.value.map((item) => item.implRef)).size === 5, "each tool needs one stable implementation reference");
    return result.value;
  });

  await run("T11", async () => {
    await reset();
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.addInitScript((token) => localStorage.setItem("access_token", token), ada);
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    await page.goto("http://localhost:3100");
    await page.getByPlaceholder("Review my pending timesheets...").fill("Review my pending timesheets.");
    await page.getByRole("button", { name: "Submit" }).click();
    const card = page.getByLabel("Human approval required");
    await card.waitFor({ timeout: 180_000 });
    const runId = await card.getAttribute("data-run-id");
    assert(runId, "approval card has no run ID");
    const domIds = [...new Set(await page.locator("[data-tool-call-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-tool-call-id")).filter(Boolean) as string[]))].sort();
    const runtimeIds = toolIds(await history(runId, ada));
    assert(domIds.length > 0 && JSON.stringify(domIds) === JSON.stringify(runtimeIds), JSON.stringify({ domIds, runtimeIds }));
    await card.getByRole("button", { name: "skip", exact: true }).click();
    await card.getByRole("button", { name: "Submit decisions" }).click();
    await page.getByText(/\[AI-generated\]/).waitFor({ timeout: 180_000 });
    await context.close();
    await browser.close();
    assert(consoleErrors.length === 0, JSON.stringify(consoleErrors));
    return { runId, domIds, runtimeIds };
  });

  let modelTextAboutTs004 = "";
  await run("T12", async () => {
    await reset();
    const defaultRun = await startRun(stackUrl, ada);
    const defaultIds = (await mutations()).map((item) => item.id).sort();
    assert(defaultIds.includes("ts-004"), `default ts-004 was not approved: ${JSON.stringify(defaultIds)}`);
    const completed = await finishPaused(defaultRun.runId, ada, ["ts-003"]);
    modelTextAboutTs004 = completed.filter((part) => part.type === "text-delta").map((part) => part.delta).join("");
    const seed = JSON.parse(await readFile(new URL("../mock-cws/seed.json", import.meta.url), "utf8"));
    const changed = seed.map((row: any) => row.id === "ts-004" ? { ...row, amount: 2400 } : row);
    const seeded = await fetch("http://localhost:4100/admin/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(changed) });
    assert(seeded.ok, `seed failed ${seeded.status}`);
    const direct = await mcpCall(ada, "approve_timesheet", { timesheet_id: "ts-004" });
    assert(direct.error === "requires_human_approval", JSON.stringify(direct));
    const changedRun = await startRun(stackUrl, ada);
    const cardIds = (approval(changedRun.parts)?.timesheets ?? []).map((item: any) => item.id ?? item.timesheet_id).sort();
    assert(JSON.stringify(cardIds) === JSON.stringify(["ts-003", "ts-004"]), JSON.stringify(cardIds));
    await finishPaused(changedRun.runId, ada, cardIds);
    await reset();
    return { defaultApproved: defaultIds, changedCard: cardIds, direct, modelTextAboutTs004 };
  });

  await run("T13", async () => {
    assert(auditRunId, "no durable run available");
    const raw = await history(auditRunId, ada);
    const text = JSON.stringify(raw);
    const humanSub = decodeJwt(ada).sub;
    const ids = toolIds(raw);
    const timestamps = text.match(/20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d[^"\\]*/g) ?? [];
    assert(text.includes(humanSub) && text.includes("ts-003") && text.includes("Review my pending timesheets") && ids.length > 0 && timestamps.length > 0, "history cannot reconstruct required fields");
    const gateway = execFileSync("docker", ["compose", "logs", "--no-color", "agentgateway"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
    assert(gateway.includes("gpt-5.6-luna") && gateway.includes("usage.input_tokens"), "gateway audit fields missing");
    return { humanSub, toolCalls: ids, promptContent: "Review my pending timesheets.", timestamps: timestamps.slice(0, 20) };
  });

  await run("T14", async () => {
    await reset();
    const [adaRun, margaretRun] = await Promise.all([startRun(stackUrl, ada), startRun(stackUrl, margaret)]);
    const endpoint = `${stackUrl}/admin/runs/terminate`;
    const noToken = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "T14" }) });
    const nonOperator = await fetch(endpoint, { method: "POST", headers: { ...auth(ada), "content-type": "application/json" }, body: JSON.stringify({ reason: "T14" }) });
    const noReason = await fetch(endpoint, { method: "POST", headers: { ...auth(opie), "content-type": "application/json" }, body: "{}" });
    const commandAt = new Date().toISOString();
    const terminated = await json<any>(endpoint, { method: "POST", headers: { ...auth(opie), "content-type": "application/json" }, body: JSON.stringify({ reason: "T14 compliance stop" }) });
    assert(noToken.status === 401 && nonOperator.status === 403 && noReason.status === 400 && terminated.response.ok, JSON.stringify({ noToken: noToken.status, nonOperator: nonOperator.status, noReason: noReason.status, terminated: terminated.text }));
    const expected = [adaRun.runId, margaretRun.runId].sort();
    assert(JSON.stringify((terminated.value.terminated ?? []).sort()) === JSON.stringify(expected), JSON.stringify(terminated.value));
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const after = (await mutations()).filter((item) => item.ts >= commandAt);
    assert(after.length === 0, `mutations after kill: ${JSON.stringify(after)}`);
    const opieSub = decodeJwt(opie).sub;
    for (const runId of expected) {
      const text = JSON.stringify(await history(runId, opie));
      assert(text.includes(opieSub) && text.includes("T14 compliance stop"), `kill audit missing for ${runId}`);
    }
    return { statuses: [noToken.status, nonOperator.status, noReason.status, terminated.response.status], runIds: expected, actor: opieSub, reason: "T14 compliance stop", mutationsAfter: after };
  });

  await run("T15", async () => {
    await reset();
    const browser = await chromium.launch({ headless: true });
    const first = await browser.newContext();
    await first.addInitScript((token) => localStorage.setItem("access_token", token), ada);
    const firstPage = await first.newPage();
    await firstPage.goto("http://localhost:3100");
    await firstPage.getByPlaceholder("Review my pending timesheets...").fill("Review my pending timesheets.");
    await firstPage.getByRole("button", { name: "Submit" }).click();
    const firstCard = firstPage.getByLabel("Human approval required");
    await firstCard.waitFor({ timeout: 180_000 });
    const runId = await firstCard.getAttribute("data-run-id");
    assert(runId, "run ID missing");
    await first.close();
    const second = await browser.newContext();
    await second.addInitScript((token) => localStorage.setItem("access_token", token), ada);
    const secondPage = await second.newPage();
    await secondPage.goto(`http://localhost:3100/?runId=${encodeURIComponent(runId)}`);
    const resumedCard = secondPage.getByLabel("Human approval required");
    await resumedCard.waitFor({ timeout: 180_000 });
    const approvalIds = await resumedCard.locator("[data-approval-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-approval-id")));
    assert(JSON.stringify(approvalIds) === JSON.stringify(["ts-003"]), `duplicate or missing cards: ${JSON.stringify(approvalIds)}`);
    await resumedCard.getByRole("button", { name: "approve", exact: true }).click();
    await resumedCard.getByRole("button", { name: "Submit decisions" }).click();
    await secondPage.getByText(/\[AI-generated\]/).waitFor({ timeout: 180_000 });
    const summary = await secondPage.getByText(/\[AI-generated\]/).last().textContent();
    await second.close();
    await browser.close();
    return { runId, approvalIds, summary };
  });

  await run("T16", async () => {
    await reset();
    const started = await startRun(stackUrl, ada);
    const before = await mutations();
    const userId = process.env.ADA_USER_ID;
    assert(userId, "ADA_USER_ID missing");
    await grantRole(userId, "viewer");
    await revokeRole(userId, "hiring_manager");
    try {
      const freshAda = await login("ada@acme.test");
      const response = await decide(stackUrl, started.runId, freshAda, [{ timesheet_id: "ts-003", action: "approve", reason: "must be denied after revocation" }]);
      const body = await response.text();
      assert(body.includes("not_authorized"), `decision was not refused: ${response.status} ${body}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const after = await mutations();
      assert(after.length === before.length, `new mutation after revocation: ${JSON.stringify({ before, after })}`);
      return { runId: started.runId, status: response.status, body, mutationCount: after.length };
    } finally {
      await grantRole(userId, "hiring_manager");
      await revokeRole(userId, "viewer");
    }
  });

  return failed;
}

async function mcpCall(token: string, name: string, args: Record<string, unknown>): Promise<any> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
  const initialize = await fetch("http://localhost:3000/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "acceptance", version: "2" } } }) });
  if (!initialize.ok) throw new Error(`MCP initialize failed: ${initialize.status} ${await initialize.text()}`);
  const session = initialize.headers.get("mcp-session-id");
  if (session) headers["mcp-session-id"] = session;
  const response = await fetch("http://localhost:3000/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP call failed: ${response.status} ${text}`);
  const messages = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  const result = messages.find((message) => message.id === 2)?.result;
  if (!result) throw new Error(`MCP result missing: ${text}`);
  return result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? "null");
}

function decodeJwt(token: string): Record<string, any> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

async function zitadelApi(path: string, body: unknown, orgId: string, method: string): Promise<any> {
  const pat = (await readFile(new URL("../data/bootstrap/admin.pat", import.meta.url), "utf8")).trim();
  const response = await fetch(`http://localhost:8080${path}`, { method, headers: { authorization: `Bearer ${pat}`, "x-zitadel-orgid": orgId, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function userGrants(userId: string, orgId: string): Promise<any[]> {
  const value = await zitadelApi("/management/v1/users/grants/_search", { queries: [], query: { limit: "100" } }, orgId, "POST");
  return (value.result ?? []).filter((grant: any) => grant.userId === userId && grant.projectId === process.env.ZITADEL_PROJECT_ID);
}

async function revokeRole(userId: string, role: string): Promise<void> {
  const orgId = process.env.ZITADEL_ACME_ORG_ID!;
  for (const grant of await userGrants(userId, orgId)) {
    if (!(grant.roleKeys ?? []).includes(role)) continue;
    const roleKeys = (grant.roleKeys ?? []).filter((key: string) => key !== role);
    if (roleKeys.length) await zitadelApi(`/management/v1/users/${userId}/grants/${grant.id}`, { roleKeys }, orgId, "PUT");
    else await zitadelApi(`/management/v1/users/${userId}/grants/${grant.id}`, undefined, orgId, "DELETE");
  }
}

async function grantRole(userId: string, role: string): Promise<void> {
  const orgId = process.env.ZITADEL_ACME_ORG_ID!;
  const grants = await userGrants(userId, orgId);
  if (grants[0]) {
    if ((grants[0].roleKeys ?? []).includes(role)) return;
    await zitadelApi(`/management/v1/users/${userId}/grants/${grants[0].id}`, { roleKeys: [...new Set([...(grants[0].roleKeys ?? []), role])] }, orgId, "PUT");
  } else {
    await zitadelApi(`/management/v1/users/${userId}/grants`, { projectId: process.env.ZITADEL_PROJECT_ID, projectGrantId: process.env.ZITADEL_ACME_GRANT_ID, roleKeys: [role] }, orgId, "POST");
  }
}
