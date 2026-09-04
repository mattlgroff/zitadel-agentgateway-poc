import base64
import json
from dataclasses import dataclass
from typing import Any

from temporalio.client import Client


TOOL_ACTIVITY_MARKER = "__call_tool"


def _decode_payload(payload: dict[str, Any]) -> Any | None:
    data = payload.get("data")
    if not isinstance(data, str):
        return None
    try:
        return json.loads(base64.b64decode(data))
    except (ValueError, json.JSONDecodeError):
        return None


def _decoded_payloads(container: dict[str, Any] | None) -> list[Any]:
    if not container:
        return []
    values: list[Any] = []
    for payload in container.get("payloads", []):
        decoded = _decode_payload(payload)
        if decoded is not None:
            values.append(decoded)
    return values


async def durable_history(client: Client, run_id: str) -> dict[str, Any]:
    raw = (await client.get_workflow_handle(run_id).fetch_history()).to_json_dict()
    for event in raw.get("events", []):
        for value in event.values():
            if not isinstance(value, dict):
                continue
            for key in ("input", "result", "details"):
                decoded = _decoded_payloads(value.get(key))
                if decoded:
                    value[f"{key}Decoded"] = decoded
    return raw


@dataclass(frozen=True)
class ToolExecution:
    call_id: str
    name: str
    arguments: dict[str, Any]
    result: Any
    scheduled_event_id: str
    scheduled_at: str
    completed_at: str


def tool_executions(history: dict[str, Any]) -> list[ToolExecution]:
    completions: dict[str, tuple[Any, str]] = {}
    for event in history.get("events", []):
        attrs = event.get("activityTaskCompletedEventAttributes")
        if attrs:
            decoded = attrs.get("resultDecoded", [])
            completions[str(attrs.get("scheduledEventId"))] = (
                decoded[0] if decoded else None,
                event.get("eventTime", ""),
            )

    records: list[ToolExecution] = []
    for event in history.get("events", []):
        attrs = event.get("activityTaskScheduledEventAttributes")
        if not attrs or TOOL_ACTIVITY_MARKER not in attrs.get("activityType", {}).get("name", ""):
            continue
        event_id = str(event.get("eventId"))
        if event_id not in completions:
            continue
        decoded = attrs.get("inputDecoded", [])
        params = decoded[0] if decoded and isinstance(decoded[0], dict) else {}
        serialized = params.get("serialized_run_context", {})
        call_id = serialized.get("tool_call_id")
        name = params.get("name")
        if not isinstance(call_id, str) or not isinstance(name, str):
            continue
        wrapped, completed_at = completions[event_id]
        result = wrapped.get("result") if isinstance(wrapped, dict) and "result" in wrapped else wrapped
        records.append(
            ToolExecution(
                call_id=call_id,
                name=name,
                arguments=params.get("tool_args", {}),
                result=result,
                scheduled_event_id=event_id,
                scheduled_at=event.get("eventTime", ""),
                completed_at=completed_at,
            )
        )
    return records
