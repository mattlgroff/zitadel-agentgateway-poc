from typing import Annotated, Any

from pydantic import Field
from pydantic_ai import RunContext

from app.policy import authorize

from .common import error
from .context import ToolContext, resolve_context


async def list_my_pending_approvals(
    ctx: RunContext[ToolContext], limit: Annotated[int, Field(ge=1, le=50)] = 20
) -> dict[str, Any]:
    """List the timesheets waiting for approval that the current user is allowed to act on. A hiring manager sees only their own team's timesheets. A program office user sees every pending timesheet in their organization. Call this first before approving or rejecting anything. Returns id, worker name, week ending, hours, amount in USD, and the worker's note."""
    tool_ctx = resolve_context(ctx)
    verdict = authorize(tool_ctx.policy_caller, "list", None)
    if not verdict.allowed:
        return error(verdict.error or "not_authorized", verdict.message)
    if limit < 1 or limit > 50:
        return {"error": "validation", "message": "limit must be from 1 through 50"}
    manager = None if "program_office" in tool_ctx.caller.roles else tool_ctx.manager_id
    rows = await tool_ctx.cws.pending(tool_ctx.tenant, manager)
    return {"timesheets": [row.model_dump(by_alias=True) for row in rows[:limit]]}
