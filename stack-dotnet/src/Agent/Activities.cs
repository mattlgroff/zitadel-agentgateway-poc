using Microsoft.DurableTask;
using StackDotnet.Policy;
using StackDotnet.Tools;

namespace StackDotnet.Agent;

[DurableTask]
public sealed class RulesActivity(ToolServices services) : TaskActivity<AgentToolInput, ToolStepResult>
{
    public override Task<ToolStepResult> RunAsync(TaskActivityContext context, AgentToolInput input) =>
        Task.FromResult(ActivityResult.From(WhatIsRequired.Execute(services, input.Caller)));
}

[DurableTask]
public sealed class ListActivity(ToolServices services) : TaskActivity<AgentToolInput, ToolStepResult>
{
    public override async Task<ToolStepResult> RunAsync(TaskActivityContext context, AgentToolInput input)
    {
        var args = ActivityResult.Args(input.ArgumentsJson);
        var limit = args.TryGetProperty("limit", out var value) ? value.GetInt32() : 20;
        return ActivityResult.From(await ListMyPendingApprovals.Execute(services, input.Caller, limit));
    }
}

[DurableTask]
public sealed class DetailActivity(ToolServices services) : TaskActivity<AgentToolInput, ToolStepResult>
{
    public override async Task<ToolStepResult> RunAsync(TaskActivityContext context, AgentToolInput input)
    {
        var args = ActivityResult.Args(input.ArgumentsJson);
        return ActivityResult.From(await GetApprovalDetail.Execute(services, input.Caller, args.GetProperty("timesheet_id").GetString()!));
    }
}

[DurableTask]
public sealed class ApproveActivity(ToolServices services) : TaskActivity<ToolActivityInput, ToolStepResult>
{
    public override async Task<ToolStepResult> RunAsync(TaskActivityContext context, ToolActivityInput input)
    {
        var human = input.HumanApproved ? new HumanDecisionContext(new HashSet<string> { input.TimesheetId }) : HumanDecisionContext.None;
        var result = ActivityResult.From(await ApproveTimesheet.Execute(services, input.Caller, human, input.TimesheetId, input.Reason));
        return result;
    }
}

[DurableTask]
public sealed class RejectActivity(ToolServices services) : TaskActivity<ToolActivityInput, ToolStepResult>
{
    public override async Task<ToolStepResult> RunAsync(TaskActivityContext context, ToolActivityInput input)
    {
        var human = input.HumanApproved ? new HumanDecisionContext(new HashSet<string> { input.TimesheetId }) : HumanDecisionContext.None;
        return ActivityResult.From(await RejectTimesheet.Execute(services, input.Caller, human, input.TimesheetId, input.Reason ?? ""));
    }
}

[DurableTask]
public sealed class ModelActivity(ModelAgent agent) : TaskActivity<ModelInput, ModelTurn>
{
    public override Task<ModelTurn> RunAsync(TaskActivityContext context, ModelInput input) => agent.RunAsync(input);
}

internal static class ActivityResult
{
    private static readonly System.Text.Json.JsonSerializerOptions Json = new(System.Text.Json.JsonSerializerDefaults.Web);

    public static System.Text.Json.JsonElement Args(string json) => System.Text.Json.JsonDocument.Parse(json).RootElement.Clone();

    public static ToolStepResult From(object value)
    {
        var json = System.Text.Json.JsonSerializer.Serialize(value, Json);
        return value switch
        {
            Timesheet row => new(json, null, row.Id, row.Status),
            ToolError error => new(json, error.Error),
            _ => new(json),
        };
    }
}
