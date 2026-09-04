import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from mcp.server.auth.provider import AccessToken
from pydantic import ValidationError
from pydantic_ai.durable_exec.temporal import PydanticAIPlugin
from pydantic_ai.ui.vercel_ai import VercelAIAdapter
from pydantic_ai.ui.vercel_ai.response_types import (
    DataChunk,
    DoneChunk,
    FinishChunk,
    StartChunk,
    TextDeltaChunk,
    TextEndChunk,
    TextStartChunk,
    ToolInputAvailableChunk,
    ToolOutputAvailableChunk,
)
from temporalio.client import Client
from temporalio.worker import Worker

from app.agent import ReviewWorkflow, apply_decision, review_agent
from app.agent.history import durable_history, tool_executions
from app.agent.models import DecisionEnvelope, ReviewInput, ReviewState
from app.auth import access_token, caller_from_token
from app.mcp_server import mcp_app
from app.policy import POLICIES, authorize
from app.tools import TOOLS, ToolContext


TASK_QUEUE = "agents-python"


@asynccontextmanager
async def lifespan(app: FastAPI):
    plugin = PydanticAIPlugin()
    client = await Client.connect(os.getenv("TEMPORAL_ADDRESS", "temporal:7233"), plugins=[plugin])
    worker = Worker(client, task_queue=TASK_QUEUE, workflows=[ReviewWorkflow], activities=[apply_decision])
    worker_task = asyncio.create_task(worker.run())
    app.state.temporal = client
    try:
        async with mcp_app.router.lifespan_context(mcp_app):
            yield
    finally:
        worker_task.cancel()
        with suppress(asyncio.CancelledError):
            await worker_task


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Mcp-Session-Id", "x-vercel-ai-ui-message-stream"],
)


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/chat")
async def chat(request: Request, token: AccessToken = Depends(access_token)):
    body = await request.body()
    raw = json.loads(body)
    if "trigger" not in raw:
        raw = {"id": raw.get("id", uuid.uuid4().hex), "trigger": "submit-message", **raw}
    request_data = VercelAIAdapter.build_run_input(json.dumps(raw).encode())
    text = "Review my pending timesheets."
    for message in reversed(raw.get("messages", [])):
        if message.get("role") == "user":
            text = " ".join(part.get("text", "") for part in message.get("parts", []) if part.get("type") == "text") or text
            break
    if len(text) > 20_000:
        raise HTTPException(400, detail={"error": "validation", "message": "Prompt is too long."})
    run_id = uuid.uuid4().hex
    await request.app.state.temporal.start_workflow(
        ReviewWorkflow.run,
        ReviewInput(caller=caller_from_token(token), prompt=text),
        id=run_id,
        task_queue=TASK_QUEUE,
    )
    adapter = VercelAIAdapter(review_agent, request_data, sdk_version=6, server_message_id=run_id)
    response = adapter.streaming_response(run_events(request.app.state.temporal, run_id))
    response.headers["x-workflow-run-id"] = run_id
    return response


async def run_events(client: Client, run_id: str) -> AsyncIterator:
    handle = client.get_workflow_handle(run_id)
    emitted: set[str] = set()
    approval_emitted = False
    yield StartChunk(messageId=run_id)
    while True:
        history = await durable_history(client, run_id)
        for record in tool_executions(history):
            if record.call_id in emitted:
                continue
            yield ToolInputAvailableChunk(
                toolCallId=record.call_id,
                toolName=record.name,
                input=record.arguments,
            )
            yield ToolOutputAvailableChunk(toolCallId=record.call_id, output=record.result)
            emitted.add(record.call_id)
        state: ReviewState = await handle.query(ReviewWorkflow.current_state)
        if state.status == "waiting" and not approval_emitted:
            yield DataChunk(
                type="data-approval-request",
                data={"runId": run_id, "timesheets": [item.model_dump() for item in state.pending]},
            )
            approval_emitted = True
        if state.status == "completed":
            message_id = f"{run_id}-summary"
            yield TextStartChunk(id=message_id)
            yield TextDeltaChunk(id=message_id, delta=state.summary or "[AI-generated] Completed.")
            yield TextEndChunk(id=message_id)
            yield FinishChunk(finishReason="stop")
            yield DoneChunk()
            return
        await asyncio.sleep(0.25)


@app.get("/runs/{run_id}/stream")
async def replay_stream(run_id: str, request: Request, token: AccessToken = Depends(access_token)):
    await require_run_access(request.app.state.temporal, run_id, caller_from_token(token))
    replay_input = VercelAIAdapter.build_run_input(
        json.dumps({"id": run_id, "trigger": "submit-message", "messages": []}).encode()
    )
    adapter = VercelAIAdapter(review_agent, replay_input, sdk_version=6, server_message_id=run_id)
    return adapter.streaming_response(run_events(request.app.state.temporal, run_id))


@app.get("/runs/{run_id}/history")
async def run_history(run_id: str, request: Request, token: AccessToken = Depends(access_token)) -> dict[str, Any]:
    await require_run_access(request.app.state.temporal, run_id, caller_from_token(token))
    return await durable_history(request.app.state.temporal, run_id)


@app.get("/introspect/tools")
async def introspect_tools(_: AccessToken = Depends(access_token)) -> list[dict[str, object]]:
    return [
        {
            "name": function.__name__,
            "implRef": f"{function.__module__}.{function.__name__}",
            "registeredFor": ["mcp", "agent"],
        }
        for function in TOOLS
    ]


@app.post("/runs/{run_id}/decision")
async def decide(run_id: str, request: Request, token: AccessToken = Depends(access_token)) -> dict[str, bool]:
    payload = await request.json()
    actor = caller_from_token(token)
    await require_run_access(request.app.state.temporal, run_id, actor)
    try:
        envelope = DecisionEnvelope(actor=actor, decisions=payload.get("decisions", []))
    except (ValidationError, AttributeError):
        raise HTTPException(400, detail={"error": "validation", "message": "Invalid decisions."}) from None
    state = await request.app.state.temporal.get_workflow_handle(run_id).query(ReviewWorkflow.current_state)
    pending = {item.timesheet_id for item in state.pending}
    if any(decision.timesheet_id not in pending for decision in envelope.decisions):
        raise HTTPException(400, detail={"error": "validation", "message": "Decisions must reference pending items."})
    tool_ctx = ToolContext(caller=actor)
    for decision in envelope.decisions:
        if decision.action == "skip":
            continue
        row = await tool_ctx.cws.detail(tool_ctx.tenant, decision.timesheet_id)
        if row is None:
            raise HTTPException(404, detail={"error": "not_found", "message": "Timesheet was not found."})
        verdict = authorize(
            tool_ctx.policy_caller,
            decision.action,
            row,
            policy=POLICIES[tool_ctx.tenant],
        )
        if not verdict.allowed and verdict.error != "requires_human_approval":
            raise HTTPException(
                403,
                detail={"error": verdict.error or "not_authorized", "message": verdict.message},
            )
    handle = request.app.state.temporal.get_workflow_handle(run_id)
    await handle.signal(ReviewWorkflow.receive_decision, envelope)
    return {"accepted": True}


@app.get("/runs/{run_id}")
async def run_state(run_id: str, request: Request, token: AccessToken = Depends(access_token)) -> ReviewState:
    await require_run_access(request.app.state.temporal, run_id, caller_from_token(token))
    handle = request.app.state.temporal.get_workflow_handle(run_id)
    return await handle.query(ReviewWorkflow.current_state)


@app.post("/admin/runs/terminate")
async def terminate_runs(request: Request, token: AccessToken = Depends(access_token)) -> dict[str, object]:
    actor = caller_from_token(token)
    verdict = authorize(actor, "terminate", None)
    if not verdict.allowed:
        raise HTTPException(403, detail={"error": "not_authorized", "message": verdict.message})
    payload = await request.json()
    reason = payload.get("reason") if isinstance(payload, dict) else None
    if not isinstance(reason, str) or not reason.strip():
        raise HTTPException(400, detail={"error": "validation", "message": "reason is required"})
    terminated: list[str] = []
    query = 'WorkflowType="PythonTimesheetReview" AND ExecutionStatus="Running"'
    async for item in request.app.state.temporal.list_workflows(query):
        await request.app.state.temporal.get_workflow_handle(item.id).terminate(
            actor.sub,
            reason,
            reason="operator kill switch",
        )
        terminated.append(item.id)
    return {"terminated": terminated}


async def require_run_access(client: Client, run_id: str, actor) -> None:
    if "operator" in actor.roles:
        return
    try:
        owner = await client.get_workflow_handle(run_id).query(ReviewWorkflow.owner)
    except Exception:
        raise HTTPException(404, detail={"error": "not_found", "message": "Run was not found."}) from None
    if owner is None or owner.org_id != actor.org_id or (owner.sub != actor.sub and "program_office" not in actor.roles):
        raise HTTPException(403, detail={"error": "not_authorized", "message": "Caller cannot access this run."})


app.mount("/", mcp_app)
