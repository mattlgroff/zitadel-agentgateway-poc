import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import playwright from "../../harness/node_modules/playwright/index.js";

const { chromium } = playwright;
const projectId = process.env.ZITADEL_PROJECT_ID;
if (!projectId) throw new Error("ZITADEL_PROJECT_ID is required");
let callbackPort = 43300;

async function login(loginName) {
  const port = callbackPort++;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const registration = await fetch("http://localhost:4200/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: `kill-switch-${Date.now()}`, redirect_uris: [redirectUri], application_type: "native", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }),
  });
  const client = await registration.json();
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const authorize = new URL("http://localhost:4200/authorize");
  for (const [key, value] of Object.entries({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:user:resourceowner`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, resource: "http://localhost:3000/mcp" })) authorize.searchParams.set(key, value);
  let resolveCallback;
  const callbackUrl = new Promise((resolve) => { resolveCallback = resolve; });
  const server = createServer((request, response) => { resolveCallback(`http://127.0.0.1:${port}${request.url}`); response.end("ok"); });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(authorize.toString());
  await page.locator('input[name="loginName"]').fill(loginName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="password"]').fill(process.env.USER_PASSWORD ?? "Password1!");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const callback = new URL(await callbackUrl);
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  if (callback.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
  const response = await fetch("http://localhost:4200/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code: callback.searchParams.get("code"), code_verifier: verifier }) });
  const body = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(body));
  return body.access_token;
}

async function startUntilWaiting(token) {
  const response = await fetch("http://localhost:5000/chat", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ trigger: "submit-message", id: randomBytes(8).toString("hex"), messages: [{ id: randomBytes(8).toString("hex"), role: "user", parts: [{ type: "text", text: "Review my pending timesheets." }] }] }),
  });
  const reader = response.body.getReader();
  let text = "";
  while (!text.includes("data-approval-request")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`stream ended before pause: ${text}`);
    text += new TextDecoder().decode(chunk.value);
  }
  const match = text.match(/"runId":"([a-f0-9]+)"/);
  if (!match) throw new Error(`run id missing: ${text}`);
  await reader.cancel();
  return match[1];
}

await fetch("http://localhost:4100/admin/reset", { method: "POST" });
const [ada, margaret] = await Promise.all([login("ada@acme.test"), login("margaret@globex.test")]);
const runIds = await Promise.all([startUntilWaiting(ada), startUntilWaiting(margaret)]);
const before = new Date().toISOString();
const response = await fetch("http://localhost:5000/admin/runs/terminate", { method: "POST", headers: { authorization: `Bearer ${ada}` } });
const result = await response.json();
if (!response.ok || !runIds.every((id) => result.terminated.includes(id))) throw new Error(JSON.stringify({ runIds, result }));
console.log(JSON.stringify({ runIds, commandAt: before, result }));
