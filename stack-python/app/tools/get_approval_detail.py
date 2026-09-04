from typing import Any

from pydantic_ai import RunContext

from app.policy import authorize

from .common import error, visible_detail
from .context import ToolContext, resolve_context


async def get_approval_detail(ctx: RunContext[ToolContext], timesheet_id: str) -> dict[str, Any]:
    """Fetch one timesheet by id with every field, for review before a decision. Returns not_found if the id does not exist or the current user is not allowed to see it."""
    tool_ctx = resolve_context(ctx)
    verdict = authorize(tool_ctx.policy_caller, "read", None)
    if not verdict.allowed:
        return error(verdict.error or "not_authorized", verdict.message)
    row = await visible_detail(tool_ctx, timesheet_id)
    return row.model_dump(by_alias=True) if row else error("not_found", "Timesheet was not found or is outside caller coverage.")
