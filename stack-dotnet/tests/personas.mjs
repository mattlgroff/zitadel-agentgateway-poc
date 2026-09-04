import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import playwright from "../../harness/node_modules/playwright/index.js";

const { chromium } = playwright;

const projectId = required("ZITADEL_PROJECT_ID");
const password = process.env.USER_PASSWORD ?? "Password1!";
const redirectUri = "http://127.0.0.1:43120/callback";

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function login(loginName) {
  const registration = await fetch("http://localhost:4200/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: `dotnet-${loginName}-${Date.now()}`, redirect_uris: [redirectUri], application_type: "native", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  const client = await registration.json();
  if (!registration.ok) throw new Error(JSON.stringify(client));
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const authorize = new URL("http://localhost:4200/authorize");
  const params = {
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:user:resourceowner`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    resource: "http://localhost:3000/mcp",
  };
  for (const [key, value] of Object.entries(params)) authorize.searchParams.set(key, value);

  let resolveCallback;
  const callbackUrl = new Promise(resolve => { resolveCallback = resolve; });
  const server = createServer((request, response) => { resolveCallback(`http://127.0.0.1:43120${request.url}`); response.end("ok"); });
  await new Promise(resolve => server.listen(43120, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(authorize.toString());
  await page.locator('input[name="loginName"]').fill(loginName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const callback = new URL(await callbackUrl);
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  if (callback.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
  const tokenResponse = await fetch("http://localhost:4200/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code: callback.searchParams.get("code"), code_verifier: verifier }) });
  const body = await tokenResponse.json();
  if (!tokenResponse.ok) throw new Error(JSON.stringify(body));
  return body.access_token;
}

async function call(token, name, args) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
  const initialize = await fetch("http://localhost:3000/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dotnet-acceptance", version: "1" } } }) });
  const session = initialize.headers.get("mcp-session-id");
  const response = await fetch("http://localhost:3000/mcp", { method: "POST", headers: { ...headers, "mcp-session-id": session }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) });
  const text = await response.text();
  const payload = JSON.parse(text.split("\n").find(line => line.startsWith("data: ")).slice(6));
  return payload.result.structuredContent.result;
}

await fetch("http://localhost:4100/admin/reset", { method: "POST" });
const personas = [
  ["Ada", "ada@acme.test", ["ts-001", "ts-002", "ts-003", "ts-004"]],
  ["Grace", "grace@acme.test", ["ts-001", "ts-002", "ts-003", "ts-004", "ts-005", "ts-006"]],
  ["Margaret", "margaret@globex.test", ["ts-007", "ts-008"]],
];
const tokens = new Map();

for (const [name, loginName, expected] of personas) {
  const token = await login(loginName);
  tokens.set(name, token);
  const rows = await call(token, "list_my_pending_approvals", { limit: 20 });
  const actual = rows.map(row => row.id);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)}`);
  console.log(`T4 ${name}: ${actual.join(",")}`);
}

const linus = await login("linus@acme.test");
const denied = await call(linus, "approve_timesheet", { timesheet_id: "ts-001" });
if (denied.error !== "not_authorized") throw new Error(`Linus result: ${JSON.stringify(denied)}`);
console.log(`T5 Linus: ${JSON.stringify(denied)}`);

async function startRun(token, prompt) {
  const response = await fetch("http://localhost:5000/chat", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: prompt }] }] }) });
  const stream = await response.text();
  const runId = stream.match(/Run id: ([a-f0-9]+)/)?.[1];
  if (!runId || !stream.includes("data-approval-request")) throw new Error(`run did not pause: ${stream}`);
  return runId;
}

await fetch("http://localhost:4100/admin/reset", { method: "POST" });
const runIds = await Promise.all([
  startRun(tokens.get("Ada"), "Start the Ada kill switch run."),
  startRun(tokens.get("Margaret"), "Start the Margaret kill switch run."),
]);
const terminate = await fetch("http://localhost:5000/admin/runs/terminate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(runIds) });
if (!terminate.ok) throw new Error(`terminate returned ${terminate.status}`);
await new Promise(resolve => setTimeout(resolve, 1000));
for (const [index, name] of ["Ada", "Margaret"].entries()) {
  const status = await fetch(`http://localhost:5000/runs/${runIds[index]}`, { headers: { authorization: `Bearer ${tokens.get(name)}` } }).then(response => response.json());
  if (status.status !== "Terminated") throw new Error(`${name} status: ${JSON.stringify(status)}`);
}
console.log(`T14 one POST terminated ${runIds.join(",")}`);
