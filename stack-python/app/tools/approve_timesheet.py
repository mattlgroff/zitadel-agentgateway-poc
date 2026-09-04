from typing import Annotated, Any

from pydantic import Field
from pydantic_ai import RunContext

from app.policy import POLICIES, authorize

from .common import error
from .context import ToolContext, resolve_context


async def approve_timesheet(
    ctx: RunContext[ToolContext],
    timesheet_id: str,
    reason: Annotated[str | None, Field(max_length=500)] = None,
) -> dict[str, Any]:
    """Approve one timesheet on behalf of the current user."""
    return await execute_approve(resolve_context(ctx), timesheet_id, reason)


async def execute_approve(tool_ctx: ToolContext, timesheet_id: str, reason: str | None = None) -> dict[str, Any]:
    initial = authorize(tool_ctx.policy_caller, "approve", None)
    if not initial.allowed:
        return error(initial.error or "not_authorized", initial.message)
    if reason is not None and len(reason) > 500:
        return error("validation", "reason must be at most 500 characters")
    row = await tool_ctx.cws.detail(tool_ctx.tenant, timesheet_id)
    if row is None:
        return error("not_found", "Timesheet was not found.")
    verdict = authorize(
        tool_ctx.policy_caller,
        "approve",
        row,
        policy=POLICIES[tool_ctx.tenant],
    )
    if not verdict.allowed and not (
        verdict.error == "requires_human_approval"
        and ("approve", timesheet_id) in tool_ctx.approved_decisions
    ):
        return error(verdict.error or "not_authorized", verdict.message)
    approved = await tool_ctx.cws.approve(tool_ctx.tenant, timesheet_id, tool_ctx.caller.sub, reason)
    return approved.model_dump(by_alias=True)
