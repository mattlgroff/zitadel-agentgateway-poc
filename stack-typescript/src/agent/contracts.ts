import { z } from "zod";
import type { CallerContext } from "../types.js";

export const pendingItemSchema = z.object({
  id: z.string(),
  worker_name: z.string(),
  amount: z.number(),
  hours: z.number(),
  recommendation: z.enum(["approve", "reject", "skip"]),
  reason: z.string(),
});

export const reviewPlanSchema = z.object({
  pending: z.array(pendingItemSchema),
  rule_actions: z.array(z.string()),
  observation: z.string(),
});

export type PendingItem = z.infer<typeof pendingItemSchema>;
export type ReviewPlan = z.infer<typeof reviewPlanSchema>;
export const decisionSchema = z.object({
  timesheet_id: z.string().min(1),
  action: z.enum(["approve", "reject", "skip"]),
  reason: z.string().max(500).optional(),
}).superRefine((decision, context) => {
  if (decision.action === "reject" && (!decision.reason || decision.reason.length < 3)) context.addIssue({ code: "custom", message: "A rejection reason must contain at least 3 characters." });
});
export const decisionsSchema = z.object({ decisions: z.array(decisionSchema).max(100) });
export type Decision = z.infer<typeof decisionSchema>;
export type DecisionEnvelope = { actor: CallerContext; decisions: Decision[] };
export type ReviewInput = { caller: CallerContext; prompt: string; model: string };
export type ReviewState = {
  status: "running" | "waiting" | "completed";
  pending: PendingItem[];
  ruleActions: string[];
  summary?: string;
  observation?: string;
};
export type KillAudit = { actorSub: string; reason: string; timestamp: string };
export type StreamEvent =
  | { type: "tool-start"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-end"; toolCallId: string; output: unknown }
  | { type: "waiting"; state: ReviewState }
  | { type: "completed"; state: ReviewState };
