from datetime import timedelta

from temporalio import activity, workflow

with workflow.unsafe.imports_passed_through():
    from app.tools import ToolContext
    from app.tools.approve_timesheet import execute_approve
    from app.tools.reject_timesheet import execute_reject
    from app.policy import CallerContext
    from .models import DecisionEnvelope, ReviewInput, ReviewState
    from .runtime import review_agent


@activity.defn
async def apply_decision(envelope: DecisionEnvelope):
    decision = envelope.decisions[0]
    context = ToolContext(
        caller=envelope.actor,
        approved_decisions=((decision.action, decision.timesheet_id),),
    )
    if decision.action == "approve":
        return await execute_approve(context, decision.timesheet_id, decision.reason)
    return await execute_reject(context, decision.timesheet_id, decision.reason or "")


@workflow.defn(name="PythonTimesheetReview")
class ReviewWorkflow:
    __pydantic_ai_agents__ = (review_agent,)

    def __init__(self) -> None:
        self.decision: DecisionEnvelope | None = None
        self.state = ReviewState()
        self.owner_context = None

    @workflow.run
    async def run(self, request: ReviewInput) -> ReviewState:
        self.owner_context = request.caller
        initial = await review_agent.run(
            request.prompt,
            deps=ToolContext(caller=request.caller),
        )
        self.state.pending = initial.output.pending
        self.state.rule_actions = initial.output.rule_actions
        self.state.observation = initial.output.observation
        if initial.output.pending:
            self.state.status = "waiting"
            await workflow.wait_condition(lambda: self.decision is not None)
            assert self.decision is not None
            actionable = [item for item in self.decision.decisions if item.action != "skip"]
            human_actions = []
            for decision in actionable:
                result = await workflow.execute_activity(
                    apply_decision,
                    DecisionEnvelope(actor=self.decision.actor, decisions=[decision]),
                    start_to_close_timeout=timedelta(minutes=1),
                )
                if "error" not in result:
                    human_actions.append(f"{decision.action}:{decision.timesheet_id}")
            observation = initial.output.observation
        else:
            human_actions = []
            observation = initial.output.observation
        self.state.status = "completed"
        self.state.summary = (
            f"[AI-generated] Rule actions: {initial.output.rule_actions}. "
            f"Human actions: {human_actions}. Observation: {observation}"
        )
        return self.state

    @workflow.signal(name="decision")
    async def receive_decision(self, decision: DecisionEnvelope) -> None:
        self.decision = decision

    @workflow.query(name="state")
    def current_state(self) -> ReviewState:
        return self.state

    @workflow.query
    def owner(self) -> CallerContext | None:
        return self.owner_context
