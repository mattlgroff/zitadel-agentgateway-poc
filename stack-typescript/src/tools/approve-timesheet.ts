import { tool } from "ai";
import { z } from "zod";
import { authorize, tenantFor } from "../policy/approval.js";
import type { ToolError } from "../types.js";
import { upstreamFor } from "../upstream/index.js";
import { callerFromOptions, callerSchema } from "./context.js";

export async function executeApprove(caller: Parameters<typeof authorize>[0], timesheet_id: string, reason?: string) {
  const baseline = authorize(caller, "approve", null);
  if (!baseline.allowed) return baseline;
  const tenant = tenantFor(caller);
  const upstream = upstreamFor(caller);
  const row = await upstream.detail(tenant, timesheet_id);
  if (!row) return { error: "not_found", message: "Timesheet was not found." } satisfies ToolError;
  const verdict = authorize(caller, "approve", row);
  if (!verdict.allowed && !(verdict.error === "requires_human_approval" && caller.humanDecisionFor === timesheet_id)) return verdict;
  return upstream.approve(tenant, timesheet_id, caller.sub, reason);
}

export const approveTimesheet = tool({
  description: "Approve one timesheet on behalf of the current user. Fails with not_authorized if the user's role cannot approve, or if the timesheet belongs to a manager the user does not cover. Fails with requires_human_approval if the amount is at or above the tenant's threshold; in that case do not retry, surface it to the human instead. Idempotent.",
  inputSchema: z.object({ timesheet_id: z.string(), reason: z.string().max(500).optional() }).strict(),
  contextSchema: callerSchema,
  execute: ({ timesheet_id, reason }, options) => executeApprove(callerFromOptions(options), timesheet_id, reason),
});
