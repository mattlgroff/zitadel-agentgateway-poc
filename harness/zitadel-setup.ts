import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type Json = Record<string, any>;

const root = resolve(import.meta.dirname);
const envPath = resolve(root, ".env");
const bootstrapPatPath = resolve(root, "data/bootstrap/admin.pat");
const base = process.env.ZITADEL_INTERNAL ?? "http://localhost:8080";
const envText = await readFile(envPath, "utf8");
const env = Object.fromEntries(
  envText.split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => {
    const at = line.indexOf("=");
    return [line.slice(0, at), line.slice(at + 1)];
  }),
);
const adminPat = (await readFile(bootstrapPatPath, "utf8")).trim();

async function api(path: string, body?: unknown, orgId?: string, method = "POST"): Promise<Json> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${adminPat}`,
      "content-type": "application/json",
      ...(orgId ? { "x-zitadel-orgid": orgId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text}`);
  return data;
}

async function search(path: string, queries: unknown[], orgId?: string): Promise<Json[]> {
  const data = await api(path, { queries, query: { limit: "100" } }, orgId);
  return data.result ?? [];
}

async function ensureOrg(name: string): Promise<Json> {
  const found = (await search("/v2/organizations/_search", [] as unknown[])).find((org) => org.name.toLowerCase() === name);
  if (found) return found;
  const created = await api("/v2/organizations", { name });
  return { id: created.organizationId, name };
}

async function ensureProject(orgId: string): Promise<Json> {
  const found = (await search("/management/v1/projects/_search", [{ nameQuery: { name: "agent-platform", method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }], orgId))[0];
  if (found) return found;
  const created = await api("/management/v1/projects", {
    name: "agent-platform",
    projectRoleAssertion: true,
    projectRoleCheck: true,
  }, orgId);
  return { id: created.id, name: "agent-platform" };
}

async function ensureRoles(projectId: string, orgId: string): Promise<void> {
  const existing = await search(`/management/v1/projects/${projectId}/roles/_search`, [], orgId);
  for (const roleKey of ["hiring_manager", "program_office", "viewer", "operator"]) {
    if (!existing.some((role) => role.key === roleKey || role.roleKey === roleKey)) {
      await api(`/management/v1/projects/${projectId}/roles`, { roleKey, displayName: roleKey.replace("_", " ") }, orgId);
    }
  }
}

async function ensureApp(projectId: string, orgId: string): Promise<Json> {
  const apps = await search(`/management/v1/projects/${projectId}/apps/_search`, [{ nameQuery: { name: "reference-client", method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }], orgId);
  if (apps[0]) return apps[0];
  const created = await api(`/management/v1/projects/${projectId}/apps/oidc`, {
    name: "reference-client",
    redirectUris: ["http://localhost:3100/callback", "http://localhost/callback"],
    responseTypes: ["OIDC_RESPONSE_TYPE_CODE"],
    grantTypes: ["OIDC_GRANT_TYPE_AUTHORIZATION_CODE", "OIDC_GRANT_TYPE_REFRESH_TOKEN"],
    appType: "OIDC_APP_TYPE_USER_AGENT",
    authMethodType: "OIDC_AUTH_METHOD_TYPE_NONE",
    version: "OIDC_VERSION_1_0",
    devMode: true,
    accessTokenType: "OIDC_TOKEN_TYPE_JWT",
    accessTokenRoleAssertion: true,
    idTokenRoleAssertion: true,
    idTokenUserinfoAssertion: true,
  }, orgId);
  return { id: created.appId, oidcConfig: { clientId: created.clientId } };
}

async function ensureProjectGrant(projectId: string, platformOrgId: string, grantedOrgId: string): Promise<Json> {
  const grants = await search(`/management/v1/projects/${projectId}/grants/_search`, [], platformOrgId);
  const found = grants.find((grant) => grant.grantedOrgId === grantedOrgId || grant.grantedOrg?.id === grantedOrgId);
  if (found) return found;
  const created = await api(`/management/v1/projects/${projectId}/grants`, {
    grantedOrgId,
    roleKeys: ["hiring_manager", "program_office", "viewer"],
  }, platformOrgId);
  return { grantId: created.grantId, grantedOrgId };
}

async function ensureHuman(orgId: string, login: string, firstName: string): Promise<Json> {
  const users = await search("/management/v1/users/_search", [{ userNameQuery: { userName: login, method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }], orgId);
  const user = users[0] ?? { id: (await api("/management/v1/users/human", {
      userName: login,
      profile: { firstName, lastName: "Test", displayName: firstName, preferredLanguage: "en" },
      email: { email: login, isEmailVerified: true },
      initialPassword: env.USER_PASSWORD || "Password1!",
    }, orgId)).userId, userName: login };
  const password = env.USER_PASSWORD || "Password1!";
  if (users[0] && (user.state === "USER_STATE_INITIAL" || user.state === 6)) {
    try {
      await api(`/management/v1/users/${user.id}/password/_initialize`, { password }, orgId);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("already initialized")) throw error;
    }
  }
  await api(`/management/v1/users/${user.id}/password`, { password, noChangeRequired: true }, orgId);
  return user;
}

async function ensureUserGrant(userId: string, projectId: string, projectGrantId: string, role: string, orgId: string): Promise<void> {
  const grants = (await search("/management/v1/users/grants/_search", [], orgId)).filter((grant) => grant.userId === userId && grant.projectId === projectId);
  if (grants.some((grant) => (grant.roleKeys ?? []).includes(role))) return;
  await api(`/management/v1/users/${userId}/grants`, { projectId, projectGrantId, roleKeys: [role] }, orgId);
}

async function ensureProjectUserGrant(userId: string, projectId: string, role: string, orgId: string): Promise<void> {
  const grants = (await search("/management/v1/users/grants/_search", [], orgId)).filter((grant) => grant.userId === userId && grant.projectId === projectId);
  if (grants.some((grant) => (grant.roleKeys ?? []).includes(role))) return;
  await api(`/management/v1/users/${userId}/grants`, { projectId, roleKeys: [role] }, orgId);
}

function userEnvironment(userId: string): { orgId: string; projectGrantId?: string } {
  const known = [
    { userId: env.ADA_USER_ID, orgId: env.ZITADEL_ACME_ORG_ID, projectGrantId: env.ZITADEL_ACME_GRANT_ID },
    { userId: env.GRACE_USER_ID, orgId: env.ZITADEL_ACME_ORG_ID, projectGrantId: env.ZITADEL_ACME_GRANT_ID },
    { userId: env.LINUS_USER_ID, orgId: env.ZITADEL_ACME_ORG_ID, projectGrantId: env.ZITADEL_ACME_GRANT_ID },
    { userId: env.MARGARET_USER_ID, orgId: env.ZITADEL_GLOBEX_ORG_ID, projectGrantId: env.ZITADEL_GLOBEX_GRANT_ID },
    { userId: env.OPIE_USER_ID, orgId: env.ZITADEL_PLATFORM_ORG_ID },
  ].find((item) => item.userId === userId);
  if (!known?.orgId) throw new Error(`Unknown test user ${userId}`);
  return known;
}

export async function revokeRole(userId: string, role: string): Promise<void> {
  const { orgId } = userEnvironment(userId);
  const grants = (await search("/management/v1/users/grants/_search", [], orgId)).filter((grant) => grant.userId === userId && grant.projectId === env.ZITADEL_PROJECT_ID);
  for (const grant of grants) {
    if (!(grant.roleKeys ?? []).includes(role)) continue;
    const roleKeys = (grant.roleKeys ?? []).filter((key: string) => key !== role);
    if (roleKeys.length) await api(`/management/v1/users/${userId}/grants/${grant.id}`, { roleKeys }, orgId, "PUT");
    else await api(`/management/v1/users/${userId}/grants/${grant.id}`, undefined, orgId, "DELETE");
  }
}

export async function grantRole(userId: string, role: string): Promise<void> {
  const { orgId, projectGrantId } = userEnvironment(userId);
  const grants = (await search("/management/v1/users/grants/_search", [], orgId)).filter((grant) => grant.userId === userId && grant.projectId === env.ZITADEL_PROJECT_ID);
  const grant = grants[0];
  if (grant) {
    if ((grant.roleKeys ?? []).includes(role)) return;
    const roleKeys = [...new Set([...(grant.roleKeys ?? []), role])];
    await api(`/management/v1/users/${userId}/grants/${grant.id}`, { roleKeys }, orgId, "PUT");
  } else if (projectGrantId) {
    await ensureUserGrant(userId, env.ZITADEL_PROJECT_ID, projectGrantId, role, orgId);
  } else {
    await ensureProjectUserGrant(userId, env.ZITADEL_PROJECT_ID, role, orgId);
  }
}

async function ensureBroker(projectId: string, platformOrgId: string): Promise<{ id: string; token: string }> {
  const users = await search("/management/v1/users/_search", [{ userNameQuery: { userName: "broker-svc", method: "TEXT_QUERY_METHOD_EQUALS_IGNORE_CASE" } }], platformOrgId);
  const user = users[0] ?? { id: (await api("/management/v1/users/machine", { userName: "broker-svc", name: "Registration Broker", accessTokenType: "ACCESS_TOKEN_TYPE_BEARER" }, platformOrgId)).userId };
  const members = await search(`/management/v1/projects/${projectId}/members/_search`, [], platformOrgId);
  if (!members.some((member) => member.userId === user.id && (member.roles ?? []).includes("PROJECT_OWNER"))) {
    await api(`/management/v1/projects/${projectId}/members`, { userId: user.id, roles: ["PROJECT_OWNER"] }, platformOrgId);
  }
  if (env.BROKER_ZITADEL_PAT) return { id: user.id, token: env.BROKER_ZITADEL_PAT };
  const pat = await api(`/management/v1/users/${user.id}/pats`, { expirationDate: "2099-01-01T00:00:00Z" }, platformOrgId);
  return { id: user.id, token: pat.token };
}

async function enableDcr(): Promise<void> {
  try {
    await api("/v2/settings/security", { dynamicClientRegistration: { enabled: true, allowUnauthenticated: true } }, undefined, "PUT");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("No changes")) throw error;
  }
}

function valueOfApp(app: Json): string {
  return app.oidcConfig?.clientId ?? app.clientId;
}

function updateEnv(values: Record<string, string>): Promise<void> {
  let next = envText;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    next = pattern.test(next) ? next.replace(pattern, `${key}=${value}`) : `${next.trimEnd()}\n${key}=${value}\n`;
  }
  return writeFile(envPath, next);
}

const platform = await ensureOrg("platform");
const acme = await ensureOrg("acme");
const globex = await ensureOrg("globex");
const project = await ensureProject(platform.id);
await ensureRoles(project.id, platform.id);
const app = await ensureApp(project.id, platform.id);
const acmeGrant = await ensureProjectGrant(project.id, platform.id, acme.id);
const globexGrant = await ensureProjectGrant(project.id, platform.id, globex.id);
const definitions = [
  { org: acme, grant: acmeGrant, login: "ada@acme.test", first: "Ada", role: "hiring_manager" },
  { org: acme, grant: acmeGrant, login: "grace@acme.test", first: "Grace", role: "program_office" },
  { org: acme, grant: acmeGrant, login: "linus@acme.test", first: "Linus", role: "viewer" },
  { org: globex, grant: globexGrant, login: "margaret@globex.test", first: "Margaret", role: "hiring_manager" },
];
const users: Json[] = [];
for (const item of definitions) {
  const user = await ensureHuman(item.org.id, item.login, item.first);
  await ensureUserGrant(user.id, project.id, item.grant.grantId ?? item.grant.id, item.role, item.org.id);
  users.push(user);
}
const opie = await ensureHuman(platform.id, "opie@platform.test", "Opie");
await ensureProjectUserGrant(opie.id, project.id, "operator", platform.id);
const broker = await ensureBroker(project.id, platform.id);
await enableDcr();
await updateEnv({
  ZITADEL_PROJECT_ID: project.id,
  ZITADEL_PLATFORM_ORG_ID: platform.id,
  ZITADEL_ACME_ORG_ID: acme.id,
  ZITADEL_GLOBEX_ORG_ID: globex.id,
  ZITADEL_ACME_GRANT_ID: acmeGrant.grantId ?? acmeGrant.id,
  ZITADEL_GLOBEX_GRANT_ID: globexGrant.grantId ?? globexGrant.id,
  REFERENCE_CLIENT_ID: valueOfApp(app),
  BROKER_ZITADEL_PAT: broker.token,
  ADA_USER_ID: users[0].id,
  GRACE_USER_ID: users[1].id,
  LINUS_USER_ID: users[2].id,
  MARGARET_USER_ID: users[3].id,
  OPIE_USER_ID: opie.id,
});

console.log(`project id: ${project.id}`);
console.log(`reference client id: ${valueOfApp(app)}`);
for (const [index, user] of users.entries()) console.log(`${definitions[index].first}: ${user.id}`);
console.log(`Opie: ${opie.id}`);
