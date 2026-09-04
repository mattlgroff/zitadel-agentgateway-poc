from dataclasses import dataclass
from typing import Literal, Protocol

from pydantic import BaseModel


class CallerContext(BaseModel):
    sub: str
    org_id: str
    roles: tuple[str, ...]


class Policy(BaseModel):
    auto_approve_below_usd: float
    max_hours_per_week: float


POLICIES = {
    "acme": Policy(auto_approve_below_usd=2000, max_hours_per_week=60),
    "globex": Policy(auto_approve_below_usd=2500, max_hours_per_week=60),
}


@dataclass(frozen=True)
class Authorization:
    allowed: bool
    error: Literal["not_authorized", "requires_human_approval"] | None = None
    message: str = ""


class TimesheetResource(Protocol):
    org_id: str
    manager_id: str
    amount: float
    hours: float


Action = Literal["list", "read", "approve", "reject", "rules", "terminate"]


def authorize(
    caller: CallerContext,
    action: Action,
    resource: TimesheetResource | None,
    *,
    policy: Policy | None = None,
) -> Authorization:
    roles = set(caller.roles)
    if action == "terminate":
        return Authorization(True) if "operator" in roles else Authorization(
            False, "not_authorized", "The operator role is required."
        )
    if action in {"list", "read", "rules"}:
        if not roles.intersection({"viewer", "hiring_manager", "program_office"}):
            return Authorization(False, "not_authorized", "Caller cannot perform this action.")
    elif not roles.intersection({"hiring_manager", "program_office"}):
        return Authorization(False, "not_authorized", f"Caller cannot {action} timesheets.")

    if resource is None:
        return Authorization(True)
    if resource.org_id != caller.org_id:
        return Authorization(False, "not_authorized", "Timesheet is outside the caller organization.")
    if "program_office" not in roles and not (
        "hiring_manager" in roles and resource.manager_id == caller.sub
    ):
        return Authorization(False, "not_authorized", "Timesheet is outside caller coverage.")
    if action in {"approve", "reject"}:
        if policy is None:
            raise ValueError("policy is required for mutation authorization")
        if requires_human(policy, resource.amount, resource.hours):
            return Authorization(
                False,
                "requires_human_approval",
                "Amount or hours require an authenticated human decision.",
            )
    return Authorization(True)


def requires_human(policy: Policy, amount: float, hours: float) -> bool:
    return amount >= policy.auto_approve_below_usd or hours > policy.max_hours_per_week
