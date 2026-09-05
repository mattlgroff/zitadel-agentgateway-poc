import { allHandlersFinished, condition, defineQuery, defineUpdate, proxyActivities, setHandler, ApplicationFailure } from "@temporalio/workflow";
import type { ApprovalResponse, ConversationActivities, JobInput, JobState } from "./contracts.js";

export const approvalResponse = defineUpdate<void, [ApprovalResponse]>("approval-response");
export const conversationJobState = defineQuery<JobState>("conversation-job-state");
const activities = proxyActivities<ConversationActivities>({
  startToCloseTimeout: "30 seconds",
  retry: { maximumAttempts: 5 },
});

export async function durableApprovalJob(input: JobInput): Promise<JobState> {
  let state: JobState = { status: "running" };
  let response: ApprovalResponse | undefined;
  setHandler(conversationJobState, () => state);
  setHandler(approvalResponse, async (value) => {
    await condition(() => state.status !== "running");
    if (state.status !== "waiting" || response || value.requestId !== state.proposal?.requestId)
      throw ApplicationFailure.nonRetryable("Approval is no longer pending", "StaleApproval");
    response = value;
  }, {
    validator: (value) => {
      if (value.tenant !== input.tenant || value.user !== input.user)
        throw ApplicationFailure.nonRetryable("Conversation access denied", "AccessDenied");
      if (value.choice !== "allow" && value.choice !== "decline")
        throw ApplicationFailure.nonRetryable("Unknown response", "InvalidResponse");
    },
  });
  state = { status: "waiting", proposal: await activities.prepare(input) };
  while (state.status === "waiting") {
    // A durable condition has no polling loop, model call, or automatic deadline.
    await condition(() => response !== undefined);
    const accepted = response!;
    response = undefined;
    const proposal = state.proposal!;
    state = { status: "running", proposal };
    const result = await activities.resolve(input, proposal, accepted);
    state = result.status === "refresh" || result.status === "denied"
      ? { status: "waiting", proposal: result.proposal ?? proposal }
      : { status: result.status };
  }
  await condition(allHandlersFinished);
  return state;
}
