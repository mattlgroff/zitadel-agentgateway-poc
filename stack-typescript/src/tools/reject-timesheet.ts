import { tool } from "ai";
import { z } from "zod";
import { authorize, tenantFor } from "../policy/approval.js";
import type { ToolError } from "../types.js";
import { upstreamFor } from "../upstream/index.js";
import { callerFromOptions, callerSchema } from "./context.js";

export async function executeReject(caller: Parameters<typeof authorize>[0], timesheet_id: string, reason: string) {
  const baseline = authorize(caller, "reject", null);
  if (!baseline.allowed) return baseline;
  const tenant = tenantFor(caller);
  const upstream = upstreamFor(caller);
  const row = await upstream.detail(tenant, timesheet_id);
  if (!row) return { error: "not_found", message: "Timesheet was not found." } satisfies ToolError;
  const verdict = authorize(caller, "reject", row);
  if (!verdict.allowed && !(verdict.error === "requires_human_approval" && caller.humanDecisionFor === timesheet_id)) return verdict;
  return upstream.reject(tenant, timesheet_id, caller.sub, reason);
}

export const rejectTimesheet = tool({
  description: "Reject one timesheet on behalf of the current user with a reason the worker will see. Same authorization rules as approve_timesheet. Always requires a reason.",
  inputSchema: z.object({ timesheet_id: z.string(), reason: z.string().min(3).max(500) }).strict(),
  contextSchema: callerSchema,
  execute: ({ timesheet_id, reason }, options) => executeReject(callerFromOptions(options), timesheet_id, reason),
});
