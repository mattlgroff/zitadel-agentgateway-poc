using System.ComponentModel;
using StackDotnet.Policy;

namespace StackDotnet.Tools;

public static class RejectTimesheet
{
    [Description("Reject one timesheet on behalf of the current user with a reason the worker will see. Same authorization rules as approve_timesheet. Always requires a reason.")]
    public static async Task<object> Execute(ToolServices services, CallerContext caller, HumanDecisionContext humanDecision, [Description("Timesheet identifier.")] string timesheet_id, [Description("Reason the worker will see, from 3 through 500 characters.")] string reason, CancellationToken cancellationToken = default)
    {
        var invocation = Authorizer.Authorize(caller, AuthorizationAction.Reject, null);
        if (!invocation.Allowed) return new ToolError(invocation.Error!, invocation.Message!);
        if (reason.Length is < 3 or > 500) return new ToolError("validation", "reason must be between 3 and 500 characters");
        var org = services.OrgName(caller);
        var policyCaller = services.PolicyCaller(caller);
        var row = await services.Cws.GetAsync(org, timesheet_id, cancellationToken);
        if (row is null) return new ToolError("not_found", "Timesheet was not found.");
        var authorization = Authorizer.Authorize(policyCaller, AuthorizationAction.Reject, row, ApprovalPolicy.For(org));
        if (!authorization.Allowed && !(authorization.Error == "requires_human_approval" && humanDecision.ApprovedIds.Contains(timesheet_id)))
            return new ToolError(authorization.Error!, authorization.Message!);
        return await services.Cws.RejectAsync(org, timesheet_id, caller.Sub, reason, cancellationToken);
    }
}
