import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "playwright";

let callbackPort = 43400;

export async function login(loginName: string): Promise<string> {
  const projectId = process.env.ZITADEL_PROJECT_ID;
  if (!projectId) throw new Error("ZITADEL_PROJECT_ID is required");
  const port = callbackPort++;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  const registration = await fetch("http://localhost:4200/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `acceptance-${Date.now()}-${port}`,
      redirect_uris: [redirectUri],
      application_type: "native",
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    }),
  });
  const client = await registration.json() as Record<string, string>;
  if (!registration.ok) throw new Error(`registration failed: ${JSON.stringify(client)}`);
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const authorize = new URL("http://localhost:4200/authorize");
  for (const [key, value] of Object.entries({
    client_id: client.client_id,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: `openid profile email urn:zitadel:iam:org:project:id:${projectId}:aud urn:zitadel:iam:org:projects:roles urn:zitadel:iam:user:resourceowner`,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    state,
    resource: "http://localhost:3000/mcp",
  })) authorize.searchParams.set(key, value);

  let resolveCallback!: (url: string) => void;
  const callbackUrl = new Promise<string>((resolve) => { resolveCallback = resolve; });
  const server = createServer((request, response) => {
    resolveCallback(`http://127.0.0.1:${port}${request.url}`);
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(authorize.toString());
  await page.locator('input[name="loginName"]').fill(loginName);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.locator('input[name="password"]').fill(process.env.USER_PASSWORD ?? "Password1!");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const callback = new URL(await Promise.race([
    callbackUrl,
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`login timed out at ${page.url()}`)), 30_000)),
  ]));
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (callback.searchParams.get("state") !== state) throw new Error("OAuth state mismatch");
  const response = await fetch("http://localhost:4200/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code: callback.searchParams.get("code") ?? "",
      code_verifier: verifier,
    }),
  });
  const body = await response.json() as Record<string, string>;
  if (!response.ok) throw new Error(`token exchange failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

export type StreamPart = Record<string, any>;

export async function readUiStream(response: Response, stopAtApproval = false): Promise<StreamPart[]> {
  if (!response.ok || !response.body) throw new Error(`stream failed: ${response.status} ${await response.text()}`);
  const parts: StreamPart[] = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      const part = JSON.parse(line.slice(6));
      parts.push(part);
      if (stopAtApproval && part.type === "data-approval-request") {
        await reader.cancel();
        return parts;
      }
    }
  }
  return parts;
}

export async function startRun(stackUrl: string, token: string, stopAtApproval = true): Promise<{ runId: string; parts: StreamPart[] }> {
  const response = await fetch(`${stackUrl}/chat`, {
    method: "POST",
    signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      id: randomBytes(8).toString("hex"),
      trigger: "submit-message",
      messages: [{ id: randomBytes(8).toString("hex"), role: "user", parts: [{ type: "text", text: "Review my pending timesheets." }] }],
    }),
  });
  const parts = await readUiStream(response, stopAtApproval);
  const runId = parts.find((part) => part.type === "data-approval-request")?.data?.runId
    ?? parts.find((part) => part.type === "start")?.messageId
    ?? response.headers.get("x-workflow-run-id");
  if (!runId) throw new Error(`run ID missing from ${JSON.stringify(parts)}`);
  return { runId, parts };
}

export async function decide(stackUrl: string, runId: string, token: string, decisions: unknown[]): Promise<Response> {
  return fetch(`${stackUrl}/runs/${encodeURIComponent(runId)}/decision`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ decisions }),
  });
}

export async function json<T = any>(url: string, init?: RequestInit): Promise<{ response: Response; value: T; text: string }> {
  const response = await fetch(url, init);
  const text = await response.text();
  return { response, value: text ? JSON.parse(text) as T : undefined as T, text };
}

export async function waitFor(predicate: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const detail = lastError instanceof Error ? `: ${lastError.message}` : "";
  throw new Error(`timed out waiting for ${label}${detail}`);
}
