using System.Text.Json;
using Microsoft.DurableTask.Client;
using Microsoft.AspNetCore.RateLimiting;
using StackDotnet.McpServer;
using StackDotnet.Policy;
using StackDotnet.Tools;
using StackDotnet.UiStream;

namespace StackDotnet.Agent;

public static class AgentEndpoints
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private static readonly IReadOnlyDictionary<string, string> ActivityTools = new Dictionary<string, string>
    {
        [nameof(RulesActivity)] = "what_is_required",
        [nameof(ListActivity)] = "list_my_pending_approvals",
        [nameof(DetailActivity)] = "get_approval_detail",
        [nameof(ApproveActivity)] = "approve_timesheet",
        [nameof(RejectActivity)] = "reject_timesheet",
    };

    public static void Map(WebApplication app)
    {
        app.MapPost("/chat", ChatAsync).RequireAuthorization().RequireRateLimiting("runs");
        app.MapPost("/runs/{runId}/decision", DecideAsync).RequireAuthorization();
        app.MapGet("/runs/{runId}", StatusAsync).RequireAuthorization();
        app.MapGet("/runs/{runId}/stream", StreamAsync).RequireAuthorization();
        app.MapGet("/runs/{runId}/history", HistoryAsync).RequireAuthorization();
        app.MapGet("/introspect/tools", (ToolCatalog catalog) => Results.Ok(catalog.Functions.Select(function => new
        {
            name = function.Name,
            implRef = $"StackDotnet.Tools.{ToTypeName(function.Name)}.Execute",
            registeredFor = new[] { "mcp", "agent" },
            authorizerRef = Authorizer.ImplementationReference,
        }))).RequireAuthorization();
        app.MapPost("/admin/runs/terminate", TerminateAsync).RequireAuthorization();
    }

    private static async Task ChatAsync(HttpContext http, DurableTaskClient client, CallerContextFactory callers, IRunHistory history)
    {
        var caller = callers.Create();
        var permission = Authorizer.Authorize(caller, AuthorizationAction.Approve, null);
        if (!permission.Allowed) { http.Response.StatusCode = 403; await http.Response.WriteAsJsonAsync(new ToolError(permission.Error!, permission.Message!), http.RequestAborted); return; }
        var prompt = await ReadPromptAsync(http.Request, http.RequestAborted);
        if (prompt.Length > 20_000) { http.Response.StatusCode = 400; await http.Response.WriteAsJsonAsync(new ToolError("validation", "Prompt is too long."), http.RequestAborted); return; }
        var runId = await client.ScheduleNewOrchestrationInstanceAsync(nameof(ReviewOrchestration), new ReviewInput(caller, prompt));
        http.Response.Headers["x-run-id"] = runId;
        http.Response.Headers["x-workflow-run-id"] = runId;
        await StreamRunAsync(http, runId, client, history);
    }

    private static async Task<IResult> StreamAsync(string runId, HttpContext http, DurableTaskClient client, IRunHistory history, CallerContextFactory callers)
    {
        var raw = await history.GetRawHistoryAsync(runId, http.RequestAborted);
        if (raw is null) return Results.NotFound();
        if (!CanAccess(raw, callers.Create())) return Results.Json(new ToolError("not_authorized", "The caller cannot access this run."), statusCode: 403);
        await StreamRunAsync(http, runId, client, history);
        return Results.Empty;
    }

    private static async Task StreamRunAsync(HttpContext http, string runId, DurableTaskClient client, IRunHistory history)
    {
        http.Response.ContentType = "text/event-stream";
        http.Response.Headers["x-vercel-ai-ui-message-stream"] = "v1";
        http.Response.Headers.CacheControl = "no-cache";
        var stream = new VercelStream(http.Response);
        await stream.StartAsync(runId, http.RequestAborted);
        var emittedInputs = new HashSet<string>();
        var emittedOutputs = new HashSet<string>();
        var activityCallIds = new Dictionary<int, string>();
        var approvalEmitted = false;

        while (!http.RequestAborted.IsCancellationRequested)
        {
            var raw = await history.GetRawHistoryAsync(runId, http.RequestAborted);
            if (raw is not null)
            {
                using var document = JsonDocument.Parse(raw);
                var events = document.RootElement.GetProperty("history").EnumerateArray().ToArray();
                foreach (var item in events)
                {
                    if (item.TryGetProperty("taskScheduled", out var scheduled))
                    {
                        var eventId = item.GetProperty("eventId").GetInt32();
                        var activity = scheduled.GetProperty("name").GetString()!;
                        if (!ActivityTools.TryGetValue(activity, out var toolName)) continue;
                        var input = ParseActivityPayload(scheduled.GetProperty("input").GetString());
                        var callId = ExtractCallId(input) ?? $"human_{eventId}";
                        activityCallIds[eventId] = callId;
                        if (!emittedInputs.Add(callId)) continue;
                        var toolInput = ExtractToolInput(input);
                        await stream.ToolInputStartAsync(callId, toolName, http.RequestAborted);
                        await stream.ToolInputDeltaAsync(callId, JsonSerializer.Serialize(toolInput, Json), http.RequestAborted);
                        await stream.ToolInputAvailableAsync(callId, toolName, toolInput, http.RequestAborted);
                    }
                    else if (item.TryGetProperty("taskCompleted", out var completed))
                    {
                        var scheduledId = completed.GetProperty("taskScheduledId").GetInt32();
                        if (!activityCallIds.TryGetValue(scheduledId, out var callId) || !emittedInputs.Contains(callId) || !emittedOutputs.Add(callId)) continue;
                        await stream.ToolOutputAvailableAsync(callId, ExtractToolOutput(completed.GetProperty("result").GetString()), http.RequestAborted);
                    }
                }
            }

            var metadata = await client.GetInstanceAsync(runId, true, http.RequestAborted);
            if (!approvalEmitted && metadata?.SerializedCustomStatus is { Length: > 0 } status)
            {
                using var document = JsonDocument.Parse(status);
                if (document.RootElement.TryGetProperty("state", out var state) && state.GetString() == "approval")
                {
                    var items = JsonSerializer.Deserialize<ApprovalItem[]>(document.RootElement.GetProperty("items"), Json) ?? [];
                    await stream.DataAsync("approval-request", new { runId, timesheets = items }, http.RequestAborted);
                    approvalEmitted = true;
                }
            }
            if (metadata?.RuntimeStatus == OrchestrationRuntimeStatus.Completed)
            {
                var output = JsonSerializer.Deserialize<ReviewOutput>(metadata.SerializedOutput!, Json);
                if (output is not null)
                {
                    await stream.TextStartAsync("summary", http.RequestAborted);
                    await stream.TextDeltaAsync("summary", output.Summary, http.RequestAborted);
                    await stream.TextEndAsync("summary", http.RequestAborted);
                }
                break;
            }
            if (metadata?.RuntimeStatus is OrchestrationRuntimeStatus.Failed or OrchestrationRuntimeStatus.Terminated) break;
            await Task.Delay(200, http.RequestAborted);
        }
        await stream.FinishAsync(http.RequestAborted);
        await stream.DoneAsync(http.RequestAborted);
    }

    private static async Task<IResult> DecideAsync(string runId, DecisionRequest request, DurableTaskClient client, CallerContextFactory callers, ToolServices services, IRunHistory history)
    {
        var actor = callers.Create();
        var invocation = Authorizer.Authorize(actor, AuthorizationAction.Approve, null);
        if (!invocation.Allowed) return Results.Json(new ToolError(invocation.Error!, invocation.Message!), statusCode: 403);
        var raw = await history.GetRawHistoryAsync(runId, default);
        if (raw is null) return Results.NotFound();
        if (!CanAccess(raw, actor)) return Results.Json(new ToolError("not_authorized", "The caller cannot access this run."), statusCode: 403);
        var metadata = await client.GetInstanceAsync(runId, true);
        if (metadata?.SerializedCustomStatus is not { Length: > 0 } customStatus) return Results.BadRequest(new ToolError("validation", "Run is not waiting for decisions."));
        using var statusDocument = JsonDocument.Parse(customStatus);
        var pending = (JsonSerializer.Deserialize<ApprovalItem[]>(statusDocument.RootElement.GetProperty("items"), Json) ?? []).Select(item => item.Id).ToHashSet();
        if (request.Decisions.Count > 100 || request.Decisions.Any(item => !pending.Contains(item.TimesheetId) || item.Action is not ("approve" or "reject" or "skip") || item.Action == "reject" && (item.Reason is null || item.Reason.Length is < 3 or > 500) || item.Reason?.Length > 500))
            return Results.BadRequest(new ToolError("validation", "Decisions must be valid and reference pending items."));
        foreach (var decision in request.Decisions.Where(item => item.Action is "approve" or "reject"))
        {
            var org = services.OrgName(actor);
            var row = await services.Cws.GetAsync(org, decision.TimesheetId, default);
            if (row is null) return Results.Json(new ToolError("not_found", "Timesheet was not found."), statusCode: 404);
            var action = decision.Action == "approve" ? AuthorizationAction.Approve : AuthorizationAction.Reject;
            var verdict = Authorizer.Authorize(services.PolicyCaller(actor), action, row, ApprovalPolicy.For(org));
            if (verdict.Error == "not_authorized") return Results.Json(new ToolError(verdict.Error, verdict.Message!), statusCode: 403);
        }
        await client.RaiseEventAsync(runId, "decision", new DecisionEnvelope(actor, request.Decisions));
        return Results.Accepted($"/runs/{runId}", new { runId });
    }

    private static async Task<IResult> StatusAsync(string runId, DurableTaskClient client, IRunHistory history, CallerContextFactory callers)
    {
        var raw = await history.GetRawHistoryAsync(runId, default);
        if (raw is null) return Results.NotFound();
        if (!CanAccess(raw, callers.Create())) return Results.Json(new ToolError("not_authorized", "The caller cannot access this run."), statusCode: 403);
        var metadata = await client.GetInstanceAsync(runId, true);
        return metadata is null ? Results.NotFound() : Results.Ok(new { runId, status = metadata.RuntimeStatus.ToString(), output = metadata.SerializedOutput, customStatus = metadata.SerializedCustomStatus, failure = metadata.FailureDetails?.ToString() });
    }

    private static async Task<IResult> HistoryAsync(string runId, IRunHistory history, CallerContextFactory callers, CancellationToken token)
    {
        var raw = await history.GetRawHistoryAsync(runId, token);
        if (raw is null) return Results.NotFound();
        return CanAccess(raw, callers.Create()) ? Results.Content(raw, "application/json") : Results.Json(new ToolError("not_authorized", "The caller cannot access this run."), statusCode: 403);
    }

    private static async Task<IResult> TerminateAsync(TerminateRequest request, CallerContextFactory callers, IRunHistory history, DurableTaskClient client, CancellationToken token)
    {
        var caller = callers.Create();
        var verdict = Authorizer.Authorize(caller, AuthorizationAction.Terminate, null);
        if (!verdict.Allowed) return Results.Json(new ToolError(verdict.Error!, verdict.Message!), statusCode: 403);
        if (string.IsNullOrWhiteSpace(request.Reason)) return Results.BadRequest(new ToolError("validation", "A termination reason is required."));
        var ids = await history.GetRunningReviewIdsAsync(token);
        var auditReason = $"actor={caller.Sub}; reason={request.Reason.Trim()}";
        await Task.WhenAll(ids.Select(id => client.TerminateInstanceAsync(id, auditReason, token)));
        return Results.Ok(new { terminated = ids, actor = caller.Sub, reason = request.Reason.Trim() });
    }

    private static object ParseActivityPayload(string? value)
    {
        using var document = JsonDocument.Parse(value ?? "[]");
        var root = document.RootElement;
        return JsonSerializer.Deserialize<object>(root.ValueKind == JsonValueKind.Array && root.GetArrayLength() > 0 ? root[0].GetRawText() : root.GetRawText(), Json)!;
    }

    private static object ParseJson(string? value) => JsonSerializer.Deserialize<object>(value ?? "null", Json)!;
    private static object ExtractToolInput(object value)
    {
        var element = JsonSerializer.SerializeToElement(value, Json);
        if (TryProperty(element, "ArgumentsJson", "argumentsJson", out var arguments))
            return ParseJson(arguments.GetString());
        var result = new Dictionary<string, object?>();
        if (TryProperty(element, "TimesheetId", "timesheetId", out var id)) result["timesheet_id"] = id.GetString();
        if (TryProperty(element, "Reason", "reason", out var reason) && reason.ValueKind != JsonValueKind.Null) result["reason"] = reason.GetString();
        return result;
    }

    private static object ExtractToolOutput(string? value)
    {
        using var outer = JsonDocument.Parse(value ?? "null");
        return TryProperty(outer.RootElement, "Json", "json", out var json) ? ParseJson(json.GetString()) : ParseJson(value);
    }

    private static string? ExtractCallId(object value)
    {
        var element = JsonSerializer.SerializeToElement(value, Json);
        return TryProperty(element, "CallId", "callId", out var callId) ? callId.GetString() : null;
    }
    private static bool TryProperty(JsonElement element, string pascal, string camel, out JsonElement value) =>
        element.TryGetProperty(pascal, out value) || element.TryGetProperty(camel, out value);
    private static bool CanAccess(string rawHistory, CallerContext caller)
    {
        if (caller.Roles.Contains("operator")) return true;
        using var history = JsonDocument.Parse(rawHistory);
        foreach (var item in history.RootElement.GetProperty("history").EnumerateArray())
        {
            if (!item.TryGetProperty("executionStarted", out var started)) continue;
            using var input = JsonDocument.Parse(started.GetProperty("input").GetString()!);
            var owner = input.RootElement.GetProperty("Caller");
            var ownerOrg = owner.GetProperty("OrgId").GetString();
            var ownerSub = owner.GetProperty("Sub").GetString();
            return ownerOrg == caller.OrgId && (ownerSub == caller.Sub || caller.Roles.Contains("program_office"));
        }
        return false;
    }
    private static string ToTypeName(string name) => string.Concat(name.Split('_').Select(part => char.ToUpperInvariant(part[0]) + part[1..]));

    private static async Task<string> ReadPromptAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        using var document = await JsonDocument.ParseAsync(request.Body, cancellationToken: cancellationToken);
        if (document.RootElement.TryGetProperty("messages", out var messages))
            foreach (var message in messages.EnumerateArray().Reverse())
                if (message.TryGetProperty("parts", out var parts))
                    foreach (var part in parts.EnumerateArray())
                        if (part.TryGetProperty("type", out var type) && type.GetString() == "text") return part.GetProperty("text").GetString() ?? "Review my pending timesheets.";
        return "Review my pending timesheets.";
    }
}
