import { tool } from "ai";
import { z } from "zod";
import { authorize, mayApprove, policies, tenantFor } from "../policy/approval.js";
import { callerFromOptions, callerSchema } from "./context.js";

export const whatIsRequired = tool({
  description: "Return the rules that govern timesheet approval for the current user's tenant and role: the auto-approve amount threshold, the maximum hours per week before a timesheet must be reviewed by a human, and which actions the current role may take. Call this once at the start of a review so you do not have to guess the rules.",
  inputSchema: z.object({}).strict(),
  contextSchema: callerSchema,
  execute: async (_input, options) => {
    const caller = callerFromOptions(options);
    const verdict = authorize(caller, "rules", null);
    if (!verdict.allowed) return verdict;
    return { ...policies[tenantFor(caller)], may_approve: mayApprove(caller), may_reject: mayApprove(caller) };
  },
});
