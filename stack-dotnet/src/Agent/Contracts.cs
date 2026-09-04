using StackDotnet.Policy;
using System.Text.Json.Serialization;

namespace StackDotnet.Agent;

public sealed record ReviewInput(CallerContext Caller, string Prompt);
public sealed record Decision([property: JsonPropertyName("timesheet_id")] string TimesheetId, string Action, string? Reason);
public sealed record DecisionRequest(IReadOnlyList<Decision> Decisions);
public sealed record TerminateRequest(string? Reason);
public sealed record DecisionEnvelope(CallerContext Actor, IReadOnlyList<Decision> Decisions);
public sealed record ApprovalItem(string Id, string WorkerName, decimal Amount, double Hours, string Recommendation, string Reason);
public sealed record ReviewOutput(string Summary, IReadOnlyList<string> RuleActions, IReadOnlyList<string> HumanActions);
public sealed record ToolActivityInput(CallerContext Caller, string TimesheetId = "", string? Reason = null, bool HumanApproved = false, string? CallId = null);
public sealed record AgentToolInput(CallerContext Caller, string ArgumentsJson, string CallId);
public sealed record PlannedToolCall(string CallId, string Name, string ArgumentsJson);
public sealed record ModelTurn(string Text, IReadOnlyList<PlannedToolCall> ToolCalls);
public sealed record ModelInput(string SystemInstructions, string UserPrompt, bool EnableTools = true);
public sealed record ToolStepResult(string Json, string? Error = null, string? Id = null, string? Status = null);
