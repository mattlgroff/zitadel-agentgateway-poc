from typing import Any

from app.policy import authorize

from .context import ToolContext


def error(code: str, message: str) -> dict[str, Any]:
    return {"error": code, "message": message}


async def visible_detail(ctx: ToolContext, timesheet_id: str):
    row = await ctx.cws.detail(ctx.tenant, timesheet_id)
    if row is None or row.org_id != ctx.tenant:
        return None
    verdict = authorize(ctx.policy_caller, "read", row)
    if not verdict.allowed:
        return None
    return row
