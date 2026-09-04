import type { AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { CallerContext } from "../types.js";

const jwks = createRemoteJWKSet(new URL(process.env.ZITADEL_JWKS_URL ?? "http://proxy/oauth/v2/keys"));

export async function verifyAccessToken(token: string): Promise<AuthInfo> {
  const projectId = required("ZITADEL_PROJECT_ID");
  const { payload } = await jwtVerify(token, jwks, {
    issuer: "http://localhost:8080",
    audience: projectId,
  });
  return {
    token,
    clientId: String(payload.client_id ?? payload.azp ?? payload.sub),
    scopes: typeof payload.scope === "string" ? payload.scope.split(" ") : [],
    expiresAt: payload.exp,
    extra: payload,
  };
}

export function callerFromAuth(authInfo: AuthInfo | undefined): CallerContext {
  const claims = authInfo?.extra as JWTPayload | undefined;
  if (!claims?.sub) throw new Error("Authenticated MCP caller context is unavailable.");
  const projectRoles = claims[`urn:zitadel:iam:org:project:${required("ZITADEL_PROJECT_ID")}:roles`];
  const roles = projectRoles && typeof projectRoles === "object" && !Array.isArray(projectRoles) ? Object.keys(projectRoles) : [];
  const orgId = claims["urn:zitadel:iam:user:resourceowner:id"];
  if (typeof orgId !== "string") throw new Error("Zitadel resource owner claim is unavailable.");
  return { sub: claims.sub, orgId, roles: roles.sort() };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
