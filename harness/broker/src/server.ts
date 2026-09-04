import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();
const external = process.env.ZITADEL_EXTERNAL ?? "http://localhost:8080";
const internal = process.env.ZITADEL_INTERNAL ?? "http://proxy";
const projectId = required("ZITADEL_PROJECT_ID");
const platformOrgId = required("ZITADEL_PLATFORM_ORG_ID");
const pat = required("BROKER_ZITADEL_PAT");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function validRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname));
  } catch {
    return false;
  }
}

app.get("/health", (context) => context.json({ ok: true }));

app.get("/.well-known/oauth-authorization-server", async (context) => {
  const response = await fetch(`${internal}/.well-known/openid-configuration`);
  if (!response.ok) return context.text(await response.text(), response.status as 500);
  const metadata = await response.json() as Record<string, unknown>;
  // TODO: Add client_id_metadata_document_supported behind a flag when CIMD is implemented.
  delete metadata.client_id_metadata_document_supported;
  return context.json({
    ...metadata,
    registration_endpoint: "http://localhost:4200/register",
    authorization_endpoint: "http://localhost:4200/authorize",
    token_endpoint: "http://localhost:4200/token",
    code_challenge_methods_supported: ["S256"],
  });
});

app.post("/register", async (context) => {
  const body: Record<string, unknown> = await context.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>));
  const redirects = body.redirect_uris;
  if (typeof body.client_name !== "string" || !body.client_name.trim()) return context.json({ error: "invalid_client_metadata", error_description: "client_name is required" }, 400);
  if (!Array.isArray(redirects) || redirects.length === 0 || !redirects.every((uri) => typeof uri === "string" && validRedirect(uri))) return context.json({ error: "invalid_redirect_uri" }, 400);
  if (!body.application_type || !["web", "native"].includes(String(body.application_type))) return context.json({ error: "invalid_client_metadata", error_description: "application_type is required" }, 400);
  if (body.token_endpoint_auth_method !== "none") return context.json({ error: "invalid_client_metadata", error_description: "token_endpoint_auth_method must be none" }, 400);

  const response = await fetch(`${internal}/management/v1/projects/${projectId}/apps/oidc`, {
    method: "POST",
    headers: { authorization: `Bearer ${pat}`, "content-type": "application/json", "x-zitadel-orgid": platformOrgId },
    body: JSON.stringify({
      name: body.client_name,
      redirectUris: redirects,
      responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
      grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
      appType: body.application_type === "native" ? "OIDC_APP_TYPE_NATIVE" : "OIDC_APP_TYPE_USER_AGENT",
      authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
      version: "OIDC_VERSION_1_0",
      devMode: true,
      accessTokenType: "OIDC_TOKEN_TYPE_JWT",
      accessTokenRoleAssertion: true,
      idTokenRoleAssertion: true,
      idTokenUserinfoAssertion: true,
    }),
  });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) return context.json(result, response.status as 400);
  console.log(JSON.stringify({ ts: new Date().toISOString(), event: "client_registered", clientName: body.client_name, clientId: result.clientId }));
  return context.json({ client_id: result.clientId, client_name: body.client_name, redirect_uris: redirects, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] }, 201);
});

app.get("/authorize", (context) => {
  const url = new URL(`${external}/oauth/v2/authorize`);
  for (const [key, value] of new URL(context.req.url).searchParams) if (key !== "resource") url.searchParams.append(key, value);
  return context.redirect(url.toString());
});

app.post("/token", async (context) => {
  const form = new URLSearchParams(await context.req.text());
  form.delete("resource");
  const response = await fetch(`${internal}/oauth/v2/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  return new Response(response.body, { status: response.status, headers: response.headers });
});

serve({ fetch: app.fetch, port: 4200, hostname: "0.0.0.0" }, () => console.log(JSON.stringify({ service: "broker", port: 4200 })));
