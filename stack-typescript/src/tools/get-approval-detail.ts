import { tool } from "ai";
import { z } from "zod";
import { authorize, tenantFor } from "../policy/approval.js";
import type { ToolError } from "../types.js";
import { upstreamFor } from "../upstream/index.js";
import { callerFromOptions, callerSchema } from "./context.js";

export const getApprovalDetail = tool({
  description: "Fetch one timesheet by id with every field, for review before a decision. Returns not_found if the id does not exist or the current user is not allowed to see it.",
  inputSchema: z.object({ timesheet_id: z.string() }).strict(),
  contextSchema: callerSchema,
  execute: async ({ timesheet_id }, options) => {
    const caller = callerFromOptions(options);
    const baseline = authorize(caller, "read", null);
    if (!baseline.allowed) return baseline;
    const tenant = tenantFor(caller);
    const row = await upstreamFor(caller).detail(tenant, timesheet_id);
    if (!row) return { error: "not_found", message: "Timesheet was not found or is outside caller coverage." } satisfies ToolError;
    const verdict = authorize(caller, "read", row);
    return verdict.allowed ? row : { error: "not_found", message: "Timesheet was not found or is outside caller coverage." } satisfies ToolError;
  },
});
