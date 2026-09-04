import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import playwright from "../../harness/node_modules/playwright/index.js";

const { chromium } = playwright;
const projectId = required("ZITADEL_PROJECT_ID");
const password = process.env.USER_PASSWORD ?? "Password1!";
let callbackPort = 43200;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function login(loginName) {
  const port = callbackPort++;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const registration = await fetch("http://localhost:4200/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: `python-${loginName}-${Date.now()}`, redirect_uris: [redirectUri], application_type: "native", token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }),
  });
  const client = await registration.json();
  if (!registration.ok) throw new Error(JSON.stringify(client));
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const authorize = new URL("http://localhost:4200/authorize");
  for (const [key, value] of Object.entries({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:user:resourceowner`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, resource: "http://localhost:3000/mcp" })) authorize.searchParams.set(key, value);
  let resolveCallback;
  const callbackUrl = new Promise(resolve => { resolveCallback = resolve; });
  const server = createServer((request, response) => { resolveCallback(`http://127.0.0.1:${port}${request.url}`); response.end("ok"); });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
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
  const response = await fetch("http://localhost:4200/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code: callback.searchParams.get("code"), code_verifier: verifier }) });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body.access_token;
}

async function call(token, name, args) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
  const initialize = await fetch("http://localhost:3000/mcp", { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "python-acceptance", version: "1" } } }) });
  const session = initialize.headers.get("mcp-session-id");
  const response = await fetch("http://localhost:3000/mcp", { method: "POST", headers: { ...headers, ...(session ? { "mcp-session-id": session } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) });
  const text = await response.text();
  const line = text.split("\n").find(item => item.startsWith("data: "));
  const payload = line ? JSON.parse(line.slice(6)) : JSON.parse(text);
  if (!response.ok || payload.error) throw new Error(text);
  return payload.result.structuredContent;
}

await fetch("http://localhost:4100/admin/reset", { method: "POST" });
const personas = [
  ["Ada", "ada@acme.test", ["ts-001", "ts-002", "ts-003", "ts-004"]],
  ["Grace", "grace@acme.test", ["ts-001", "ts-002", "ts-003", "ts-004", "ts-005", "ts-006"]],
  ["Margaret", "margaret@globex.test", ["ts-007", "ts-008"]],
];
for (const [name, loginName, expected] of personas) {
  const token = await login(loginName);
  const result = await call(token, "list_my_pending_approvals", { limit: 20 });
  const actual = result.timesheets.map(row => row.id);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)}`);
  console.log(`T4 ${name}: ${actual.join(",")}`);
}
const linus = await login("linus@acme.test");
const denied = await call(linus, "approve_timesheet", { timesheet_id: "ts-001" });
if (denied.error !== "not_authorized") throw new Error(`Linus: ${JSON.stringify(denied)}`);
console.log(`T5 Linus: ${JSON.stringify(denied)}`);
