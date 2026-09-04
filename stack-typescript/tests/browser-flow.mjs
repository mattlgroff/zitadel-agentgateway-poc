import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import playwright from "../../harness/node_modules/playwright/index.js";

const { chromium } = playwright;
const projectId = process.env.ZITADEL_PROJECT_ID;
if (!projectId) throw new Error("ZITADEL_PROJECT_ID is required");

async function login() {
  const redirectUri = "http://127.0.0.1:43400/callback";
  const registration = await fetch("http://localhost:4200/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: `typescript-ui-${Date.now()}`, redirect_uris: [redirectUri], application_type: "native", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], response_types: ["code"] }) });
  const client = await registration.json();
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const authorize = new URL("http://localhost:4200/authorize");
  for (const [key, value] of Object.entries({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:user:resourceowner`, code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state, resource: "http://localhost:3000/mcp" })) authorize.searchParams.set(key, value);
  let resolveCallback;
  const callbackUrl = new Promise((resolve) => { resolveCallback = resolve; });
  const server = createServer((request, response) => { resolveCallback(`http://127.0.0.1:43400${request.url}`); response.end("ok"); });
  await new Promise((resolve) => server.listen(43400, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(authorize.toString());
  await page.locator('input[name="loginName"]').fill("ada@acme.test");
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

await fetch("http://localhost:4100/admin/reset", { method: "POST" });
const token = await login();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
await page.goto("http://localhost:3100");
await page.evaluate((value) => localStorage.setItem("access_token", value), token);
await page.reload();
await page.getByPlaceholder("Review my pending timesheets...").fill("Review my pending timesheets.");
await page.locator('button[type="submit"]').click();
await page.getByRole("region", { name: "Human approval required" }).waitFor({ timeout: 90_000 });
await page.screenshot({ path: "evidence/T11-shared-ui-approval.png", fullPage: true });
await page.getByRole("button", { name: "approve", exact: true }).click();
await page.getByRole("button", { name: "Submit decisions" }).click();
await page.getByText("Decision sent").waitFor();
await page.getByText(/\[AI-generated\] Rule actions:/).waitFor({ timeout: 90_000 });
if (errors.length) throw new Error(`console errors: ${JSON.stringify(errors)}`);
console.log("T11 PASS: unchanged UI streamed tools, approval, decision, and summary without console errors");
await browser.close();
