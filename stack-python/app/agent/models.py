from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.policy import CallerContext


class PendingApproval(BaseModel):
    timesheet_id: str
    worker_name: str
    amount: float
    hours: float
    recommendation: Literal["approve", "reject", "skip"]
    reason: str


class ReviewPlan(BaseModel):
    rule_actions: list[str]
    pending: list[PendingApproval]
    observation: str


class Decision(BaseModel):
    timesheet_id: str
    action: Literal["approve", "reject", "skip"]
    reason: str | None = None

    @model_validator(mode="after")
    def validate_reason(self):
        if self.action == "reject" and (self.reason is None or not 3 <= len(self.reason) <= 500):
            raise ValueError("A rejection reason must contain from 3 through 500 characters.")
        if self.reason is not None and len(self.reason) > 500:
            raise ValueError("A reason must not exceed 500 characters.")
        return self


class DecisionEnvelope(BaseModel):
    actor: CallerContext
    decisions: list[Decision] = Field(max_length=100)


class ReviewInput(BaseModel):
    caller: CallerContext
    prompt: str


class ReviewState(BaseModel):
    status: Literal["running", "waiting", "completed"] = "running"
    pending: list[PendingApproval] = Field(default_factory=list)
    rule_actions: list[str] = Field(default_factory=list)
    observation: str | None = None
    summary: str | None = None
