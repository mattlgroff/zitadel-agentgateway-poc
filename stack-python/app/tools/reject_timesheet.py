from typing import Annotated, Any

from pydantic import Field
from pydantic_ai import RunContext

from app.policy import POLICIES, authorize

from .common import error
from .context import ToolContext, resolve_context


async def reject_timesheet(
    ctx: RunContext[ToolContext],
    timesheet_id: str,
    reason: Annotated[str, Field(min_length=3, max_length=500)],
) -> dict[str, Any]:
    """Reject one timesheet on behalf of the current user with a reason the worker will see."""
    return await execute_reject(resolve_context(ctx), timesheet_id, reason)


async def execute_reject(tool_ctx: ToolContext, timesheet_id: str, reason: str) -> dict[str, Any]:
    initial = authorize(tool_ctx.policy_caller, "reject", None)
    if not initial.allowed:
        return error(initial.error or "not_authorized", initial.message)
    if len(reason) < 3 or len(reason) > 500:
        return error("validation", "reason must be from 3 through 500 characters")
    row = await tool_ctx.cws.detail(tool_ctx.tenant, timesheet_id)
    if row is None:
        return error("not_found", "Timesheet was not found.")
    verdict = authorize(
        tool_ctx.policy_caller,
        "reject",
        row,
        policy=POLICIES[tool_ctx.tenant],
    )
    if not verdict.allowed and not (
        verdict.error == "requires_human_approval"
        and ("reject", timesheet_id) in tool_ctx.approved_decisions
    ):
        return error(verdict.error or "not_authorized", verdict.message)
    rejected = await tool_ctx.cws.reject(tool_ctx.tenant, timesheet_id, tool_ctx.caller.sub, reason)
    return rejected.model_dump(by_alias=True)
