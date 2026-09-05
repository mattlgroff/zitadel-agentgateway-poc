export type Principal = { tenant: string; user: string };
export type JobInput = Principal & { conversationId: string; jobId: string; recordId: string };
export type Proposal = { requestId: string; revision: number; tool: "approve_record"; input: { recordId: string; amount: number }; };
export type ApprovalResponse = Principal & { requestId: string; choice: "allow" | "decline" };
export type JobState = { status: "running" | "waiting" | "completed" | "declined"; proposal?: Proposal };
export type Resolution = { status: "completed" | "declined" | "refresh" | "denied"; proposal?: Proposal };
export interface ConversationActivities {
  prepare(input: JobInput): Promise<Proposal>;
  resolve(input: JobInput, proposal: Proposal, response: ApprovalResponse): Promise<Resolution>;
}
