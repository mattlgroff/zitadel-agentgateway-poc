import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "playwright";

const mode = process.argv[2];
if (mode !== "native" && mode !== "broker") throw new Error("usage: oauth-demo.ts native|broker");
const redirectUri = "http://127.0.0.1:43119/callback";
const registrationEndpoint = mode === "native" ? "http://localhost:8080/oauth/v2/register" : "http://localhost:4200/register";
const tokenEndpoint = mode === "native" ? "http://localhost:8080/oauth/v2/token" : "http://localhost:4200/token";
const authorizationEndpoint = mode === "native" ? "http://localhost:8080/oauth/v2/authorize" : "http://localhost:4200/authorize";
const projectId = required("ZITADEL_PROJECT_ID");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const registration = await fetch(registrationEndpoint, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: `${mode}-dcr-${Date.now()}`,
    redirect_uris: [redirectUri],
    application_type: "native",
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }),
});
const client = await registration.json() as Record<string, any>;
if (!registration.ok) throw new Error(`registration failed: ${registration.status} ${JSON.stringify(client)}`);

const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(16).toString("hex");
const authorize = new URL(authorizationEndpoint);
for (const [key, value] of Object.entries({
  client_id: client.client_id,
  redirect_uri: redirectUri,
  response_type: "code",
  scope: `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:user:resourceowner`,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state,
  resource: "http://localhost:3000/mcp",
})) authorize.searchParams.set(key, value);

const browser = await chromium.launch({ headless: true });
let resolveCallback!: (url: string) => void;
const callbackUrl = new Promise<string>((resolve) => { resolveCallback = resolve; });
const callbackServer = createServer((request, response) => {
  resolveCallback(`http://127.0.0.1:43119${request.url}`);
  response.end("Login complete. You may close this window.");
});
await new Promise<void>((resolve) => callbackServer.listen(43119, "127.0.0.1", resolve));
const page = await browser.newPage();
await page.goto(authorize.toString());
await page.locator('input[name="loginName"]').fill("ada@acme.test");
await page.getByRole("button", { name: "Continue", exact: true }).click();
await page.locator('input[name="password"]').fill(process.env.USER_PASSWORD ?? "Password1!");
await page.getByRole("button", { name: "Continue", exact: true }).click();
const callback = new URL(await Promise.race([
  callbackUrl,
  new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`authorization timed out at ${page.url()}`)), 20_000)),
]));
await browser.close();
callbackServer.close();
callbackServer.closeAllConnections();
if (callback.origin + callback.pathname !== redirectUri || callback.searchParams.get("state") !== state) throw new Error(`authorization failed at ${callback}`);
const code = callback.searchParams.get("code");
if (!code) throw new Error(`authorization response has no code: ${callback}`);

const tokenResponse = await fetch(tokenEndpoint, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ grant_type: "authorization_code", client_id: client.client_id, redirect_uri: redirectUri, code, code_verifier: verifier }),
});
const tokenBody = await tokenResponse.json() as Record<string, any>;
if (!tokenResponse.ok) throw new Error(`token exchange failed: ${tokenResponse.status} ${JSON.stringify(tokenBody)}`);
const token = String(tokenBody.access_token);
const shape = token.split(".").length === 3 ? "JWT" : "opaque";
console.log(`access token shape: ${shape}`);

const headers = { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
const initialize = await fetch("http://localhost:3000/mcp", {
  method: "POST", headers,
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "harness-demo", version: "1.0.0" } } }),
});
if (mode === "native") {
  console.log(`tools/list status: ${initialize.status}`);
  if (shape !== "opaque" || initialize.status !== 401) process.exit(1);
  process.exit(0);
}
const session = initialize.headers.get("mcp-session-id");
if (!initialize.ok) throw new Error(`initialize failed: ${initialize.status} ${await initialize.text()}`);
const listHeaders: Record<string, string> = { ...headers };
if (session) listHeaders["mcp-session-id"] = session;
const toolsList = await fetch("http://localhost:3000/mcp", {
  method: "POST", headers: listHeaders,
  body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
});
console.log(`tools/list status: ${toolsList.status}`);
const resultText = await toolsList.text();
console.log(`tools/list response: ${resultText}`);
const messages = resultText.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
const names = messages.flatMap((message) => message.result?.tools ?? []).map((tool) => tool.name).sort();
const expectedNames = process.env.ACTIVE_STACK_HOST === "ref-mcp"
  ? ["ping"]
  : ["approve_timesheet", "get_approval_detail", "list_my_pending_approvals", "reject_timesheet", "what_is_required"];
if (shape !== "JWT" || toolsList.status !== 200 || JSON.stringify(names) !== JSON.stringify(expectedNames)) process.exit(1);
process.exit(0);
