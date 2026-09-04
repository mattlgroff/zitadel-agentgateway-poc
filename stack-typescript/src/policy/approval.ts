import type { CallerContext, Timesheet } from "../types.js";

export type Action = "list" | "read" | "approve" | "reject" | "rules" | "terminate";
export type AuthorizationResult =
  | { allowed: true }
  | { allowed: false; error: "not_authorized" | "requires_human_approval"; message: string };

export const policies = {
  acme: { auto_approve_below_usd: 2000, max_hours_per_week: 60 },
  globex: { auto_approve_below_usd: 2500, max_hours_per_week: 60 },
} as const;

export type Tenant = keyof typeof policies;

export function mayApprove(caller: CallerContext): boolean {
  return caller.roles.includes("hiring_manager") || caller.roles.includes("program_office");
}

export function authorize(caller: CallerContext, action: Action, resource: Timesheet | null): AuthorizationResult {
  if (action === "terminate") return caller.roles.includes("operator")
    ? { allowed: true }
    : { allowed: false, error: "not_authorized", message: "Operator role is required." };
  const canRead = caller.roles.some((role) => role === "viewer" || role === "hiring_manager" || role === "program_office");
  if ((action === "list" || action === "read" || action === "rules") && !canRead) {
    return { allowed: false, error: "not_authorized", message: `Caller cannot ${action} timesheets.` };
  }
  if ((action === "approve" || action === "reject") && !mayApprove(caller)) {
    return { allowed: false, error: "not_authorized", message: `Caller cannot ${action} timesheets.` };
  }
  if (resource) {
    const tenant = tenantFor(caller);
    if (!covers(caller, resource, tenant)) {
      return { allowed: false, error: "not_authorized", message: `Caller cannot ${action} this timesheet.` };
    }
    if ((action === "approve" || action === "reject") && requiresHuman(tenant, resource)) {
      return { allowed: false, error: "requires_human_approval", message: "Amount or hours require an authenticated human decision." };
    }
  }
  return { allowed: true };
}

export function covers(caller: CallerContext, row: Timesheet, tenant: Tenant): boolean {
  if (row.orgId !== tenant || tenantFor(caller) !== tenant) return false;
  if (caller.roles.includes("program_office")) return true;
  return caller.roles.includes("hiring_manager") && row.managerId === managerId(caller);
}

export function requiresHuman(tenant: Tenant, row: Pick<Timesheet, "amount" | "hours">): boolean {
  const policy = policies[tenant];
  return row.amount >= policy.auto_approve_below_usd || row.hours > policy.max_hours_per_week;
}

export function tenantFor(caller: CallerContext): Tenant {
  if (caller.tenant) return caller.tenant;
  const tenant = new Map([
    [process.env.ACME_ORG_ID, "acme"],
    [process.env.GLOBEX_ORG_ID, "globex"],
  ]).get(caller.orgId);
  if (!tenant) throw new Error("Unknown tenant organization.");
  return tenant as Tenant;
}

export function managerId(caller: CallerContext): string {
  if (caller.managerFixtureId) return caller.managerFixtureId;
  return new Map([
    [process.env.ADA_SUB, "ada"],
    [process.env.MARGARET_SUB, "margaret"],
  ]).get(caller.sub) ?? caller.sub;
}
