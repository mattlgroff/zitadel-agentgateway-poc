import { beforeEach, describe, expect, it } from "vitest";
import { authorize, covers, mayApprove, requiresHuman, tenantFor } from "../src/policy/approval.js";
import type { CallerContext, Timesheet } from "../src/types.js";

const row: Timesheet = { id: "ts-001", orgId: "acme", managerId: "ada", workerName: "Worker", weekEnding: "2026-09-04", hours: 40, amount: 1800, status: "PENDING", note: null };

beforeEach(() => {
  process.env.ACME_ORG_ID = "org-acme";
  process.env.GLOBEX_ORG_ID = "org-globex";
  process.env.ADA_SUB = "sub-ada";
});

describe("approval policy", () => {
  it("checks role before manager coverage", () => {
    const viewer: CallerContext = { sub: "sub-ada", orgId: "org-acme", roles: ["viewer"] };
    expect(mayApprove(viewer)).toBe(false);
    expect(covers(viewer, row, "acme")).toBe(false);
  });

  it("scopes managers and program office", () => {
    expect(covers({ sub: "sub-ada", orgId: "org-acme", roles: ["hiring_manager"] }, row, "acme")).toBe(true);
    expect(covers({ sub: "grace", orgId: "org-acme", roles: ["program_office"] }, row, "acme")).toBe(true);
    expect(covers({ sub: "margaret", orgId: "org-globex", roles: ["program_office"] }, row, "acme")).toBe(false);
  });

  it("enforces amount and hours without reading notes", () => {
    expect(requiresHuman("acme", { amount: 1999, hours: 60 })).toBe(false);
    expect(requiresHuman("acme", { amount: 2000, hours: 40 })).toBe(true);
    expect(requiresHuman("acme", { amount: 100, hours: 61 })).toBe(true);
  });

  it("maps external organizations to fixture tenants", () => {
    expect(tenantFor({ sub: "x", orgId: "org-acme", roles: [] })).toBe("acme");
  });

  it("uses one authorizer for action, coverage, and threshold decisions", () => {
    const manager: CallerContext = { sub: "sub-ada", orgId: "org-acme", roles: ["hiring_manager"] };
    expect(authorize(manager, "list", null)).toEqual({ allowed: true });
    expect(authorize({ ...manager, roles: ["viewer"] }, "approve", null)).toMatchObject({ allowed: false, error: "not_authorized" });
    expect(authorize(manager, "read", { ...row, managerId: "someone-else" })).toMatchObject({ allowed: false, error: "not_authorized" });
    expect(authorize(manager, "approve", { ...row, amount: 2400 })).toMatchObject({ allowed: false, error: "requires_human_approval" });
    expect(authorize(manager, "reject", { ...row, hours: 61 })).toMatchObject({ allowed: false, error: "requires_human_approval" });
  });
});
