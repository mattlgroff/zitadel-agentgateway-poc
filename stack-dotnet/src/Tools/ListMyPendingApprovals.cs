using System.ComponentModel;
using StackDotnet.Policy;

namespace StackDotnet.Tools;

public static class ListMyPendingApprovals
{
    [Description("List the timesheets waiting for approval that the current user is allowed to act on. A hiring manager sees only their own team's timesheets. A program office user sees every pending timesheet in their organization. Call this first before approving or rejecting anything. Returns id, worker name, week ending, hours, amount in USD, and the worker's note.")]
    public static async Task<object> Execute(
        ToolServices services,
        CallerContext caller,
        [Description("Maximum number of results from 1 through 50.")] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        var invocation = Authorizer.Authorize(caller, AuthorizationAction.List, null);
        if (!invocation.Allowed) return new ToolError(invocation.Error!, invocation.Message!);
        if (limit is < 1 or > 50) return new ToolError("validation", "limit must be between 1 and 50");
        var org = services.OrgName(caller);
        var policyCaller = services.PolicyCaller(caller);
        var managerId = caller.Roles.Contains("hiring_manager") ? policyCaller.Sub : null;
        var rows = await services.Cws.PendingAsync(org, managerId, cancellationToken);
        return new { timesheets = rows.Where(row => Authorizer.Authorize(policyCaller, AuthorizationAction.Read, row).Allowed).Take(limit).ToArray() };
    }
}
