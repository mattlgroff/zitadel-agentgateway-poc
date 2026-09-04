using System.ComponentModel;
using StackDotnet.Policy;

namespace StackDotnet.Tools;

public static class ApproveTimesheet
{
    [Description("Approve one timesheet on behalf of the current user. Fails with not_authorized if the user's role cannot approve, or if the timesheet belongs to a manager the user does not cover. Fails with requires_human_approval if the amount is at or above the tenant's threshold; in that case do not retry, surface it to the human instead. Idempotent.")]
    public static async Task<object> Execute(ToolServices services, CallerContext caller, HumanDecisionContext humanDecision, [Description("Timesheet identifier.")] string timesheet_id, [Description("Optional reason, at most 500 characters.")] string? reason = null, CancellationToken cancellationToken = default)
    {
        var invocation = Authorizer.Authorize(caller, AuthorizationAction.Approve, null);
        if (!invocation.Allowed) return new ToolError(invocation.Error!, invocation.Message!);
        if (reason?.Length > 500) return new ToolError("validation", "reason must not exceed 500 characters");
        var org = services.OrgName(caller);
        var policyCaller = services.PolicyCaller(caller);
        var row = await services.Cws.GetAsync(org, timesheet_id, cancellationToken);
        if (row is null) return new ToolError("not_found", "Timesheet was not found.");
        var authorization = Authorizer.Authorize(policyCaller, AuthorizationAction.Approve, row, ApprovalPolicy.For(org));
        if (!authorization.Allowed && !(authorization.Error == "requires_human_approval" && humanDecision.ApprovedIds.Contains(timesheet_id)))
            return new ToolError(authorization.Error!, authorization.Message!);
        return await services.Cws.ApproveAsync(org, timesheet_id, caller.Sub, reason, cancellationToken);
    }
}
