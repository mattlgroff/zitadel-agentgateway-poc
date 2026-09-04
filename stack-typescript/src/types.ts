export type CallerContext = {
  sub: string;
  orgId: string;
  roles: string[];
  humanDecisionFor?: string;
  durable?: boolean;
  tenant?: "acme" | "globex";
  managerFixtureId?: string;
};

export type Timesheet = {
  id: string;
  orgId: string;
  managerId: string;
  workerName: string;
  weekEnding: string;
  hours: number;
  amount: number;
  status: "PENDING" | "APPROVED" | "REJECTED";
  note: string | null;
};

export type ToolError = {
  error: "not_authorized" | "not_found" | "requires_human_approval" | "validation";
  message: string;
};

export function enrichCaller(caller: CallerContext): CallerContext {
  const tenant = new Map([
    [process.env.ACME_ORG_ID, "acme"],
    [process.env.GLOBEX_ORG_ID, "globex"],
  ]).get(caller.orgId) as "acme" | "globex" | undefined;
  const managerFixtureId = new Map([
    [process.env.ADA_SUB, "ada"],
    [process.env.MARGARET_SUB, "margaret"],
  ]).get(caller.sub) ?? caller.sub;
  return { ...caller, tenant, managerFixtureId };
}
