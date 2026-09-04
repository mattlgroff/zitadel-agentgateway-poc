from typing import Any

from pydantic_ai import RunContext

from app.policy import POLICIES, authorize

from .common import error
from .context import ToolContext, resolve_context


async def what_is_required(ctx: RunContext[ToolContext]) -> dict[str, Any]:
    """Return the rules that govern timesheet approval for the current user's tenant and role: the auto-approve amount threshold, the maximum hours per week before a timesheet must be reviewed by a human, and which actions the current role may take. Call this once at the start of a review so you do not have to guess the rules."""
    tool_ctx = resolve_context(ctx)
    verdict = authorize(tool_ctx.policy_caller, "rules", None)
    if not verdict.allowed:
        return error(verdict.error or "not_authorized", verdict.message)
    policy = POLICIES[tool_ctx.tenant]
    may_mutate = bool({"hiring_manager", "program_office"}.intersection(tool_ctx.caller.roles))
    return {
        **policy.model_dump(),
        "may_approve": may_mutate,
        "may_reject": may_mutate,
    }
