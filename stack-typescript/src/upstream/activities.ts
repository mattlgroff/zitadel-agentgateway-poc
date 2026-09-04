import * as client from "./client.js";
import { executeApprove } from "../tools/approve-timesheet.js";
import { executeReject } from "../tools/reject-timesheet.js";
import type { CallerContext } from "../types.js";

export type DecisionActivityInput = { caller: CallerContext; timesheetId: string; action: "approve" | "reject"; reason?: string; callId: string };

async function applyDecision(input: DecisionActivityInput) {
  const caller = { ...input.caller, durable: false, humanDecisionFor: input.timesheetId };
  return input.action === "approve"
    ? executeApprove(caller, input.timesheetId, input.reason)
    : executeReject(caller, input.timesheetId, input.reason ?? "");
}

export const upstreamActivities = {
  pending: client.pending,
  detail: client.detail,
  approve: client.approve,
  reject: client.reject,
  applyDecision,
};

export type UpstreamActivities = typeof upstreamActivities;
