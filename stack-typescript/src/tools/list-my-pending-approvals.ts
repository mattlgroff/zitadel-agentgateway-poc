import { tool } from "ai";
import { z } from "zod";
import { authorize, managerId, tenantFor } from "../policy/approval.js";
import { upstreamFor } from "../upstream/index.js";
import { callerFromOptions, callerSchema } from "./context.js";

export const listMyPendingApprovals = tool({
  description: "List the timesheets waiting for approval that the current user is allowed to act on. A hiring manager sees only their own team's timesheets. A program office user sees every pending timesheet in their organization. Call this first before approving or rejecting anything. Returns id, worker name, week ending, hours, amount in USD, and the worker's note.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict(),
  contextSchema: callerSchema,
  execute: async ({ limit }, options) => {
    const caller = callerFromOptions(options);
    const verdict = authorize(caller, "list", null);
    if (!verdict.allowed) return verdict;
    const manager = caller.roles.includes("program_office") ? undefined : managerId(caller);
    return { timesheets: (await upstreamFor(caller).pending(tenantFor(caller), manager)).slice(0, limit) };
  },
});
