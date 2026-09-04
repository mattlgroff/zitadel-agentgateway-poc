from typing import Any

import httpx
from pydantic import BaseModel, Field


class Timesheet(BaseModel):
    id: str
    org_id: str = Field(alias="orgId")
    manager_id: str = Field(alias="managerId")
    worker_name: str = Field(alias="workerName")
    week_ending: str = Field(alias="weekEnding")
    hours: float
    amount: float
    status: str
    note: str | None = None


class CwsClient:
    def __init__(self, url: str):
        self.url = url

    async def _call(self, org_id: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.url,
                headers={"X-Org-Id": org_id},
                json={"query": query, "variables": variables},
                timeout=20,
            )
        response.raise_for_status()
        payload = response.json()
        if payload.get("errors"):
            raise RuntimeError(payload["errors"][0]["message"])
        return payload["data"]

    async def pending(self, org_id: str, manager_id: str | None = None) -> list[Timesheet]:
        data = await self._call(
            org_id,
            """query Pending($orgId: ID!, $managerId: ID) {
              pendingTimesheets(orgId: $orgId, managerId: $managerId) {
                id orgId managerId workerName weekEnding hours amount status note
              }
            }""",
            {"orgId": org_id, "managerId": manager_id},
        )
        return [Timesheet.model_validate(row) for row in data["pendingTimesheets"]]

    async def detail(self, org_id: str, timesheet_id: str) -> Timesheet | None:
        data = await self._call(
            org_id,
            """query Detail($id: ID!) {
              timesheet(id: $id) { id orgId managerId workerName weekEnding hours amount status note }
            }""",
            {"id": timesheet_id},
        )
        row = data["timesheet"]
        return Timesheet.model_validate(row) if row else None

    async def approve(self, org_id: str, timesheet_id: str, actor_id: str, reason: str | None) -> Timesheet:
        data = await self._call(
            org_id,
            """mutation Approve($id: ID!, $actorId: ID!, $reason: String) {
              approveTimesheet(id: $id, actorId: $actorId, reason: $reason) {
                id orgId managerId workerName weekEnding hours amount status note
              }
            }""",
            {"id": timesheet_id, "actorId": actor_id, "reason": reason},
        )
        return Timesheet.model_validate(data["approveTimesheet"])

    async def reject(self, org_id: str, timesheet_id: str, actor_id: str, reason: str) -> Timesheet:
        data = await self._call(
            org_id,
            """mutation Reject($id: ID!, $actorId: ID!, $reason: String!) {
              rejectTimesheet(id: $id, actorId: $actorId, reason: $reason) {
                id orgId managerId workerName weekEnding hours amount status note
              }
            }""",
            {"id": timesheet_id, "actorId": actor_id, "reason": reason},
        )
        return Timesheet.model_validate(data["rejectTimesheet"])
