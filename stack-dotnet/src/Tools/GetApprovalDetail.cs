using System.ComponentModel;
using StackDotnet.Policy;

namespace StackDotnet.Tools;

public static class GetApprovalDetail
{
    [Description("Fetch one timesheet by id with every field, for review before a decision. Returns not_found if the id does not exist or the current user is not allowed to see it.")]
    public static async Task<object> Execute(ToolServices services, CallerContext caller, [Description("Timesheet identifier.")] string timesheet_id, CancellationToken cancellationToken = default)
    {
        var invocation = Authorizer.Authorize(caller, AuthorizationAction.Read, null);
        if (!invocation.Allowed) return new ToolError(invocation.Error!, invocation.Message!);
        var org = services.OrgName(caller);
        var row = await services.Cws.GetAsync(org, timesheet_id, cancellationToken);
        if (row is null) return new ToolError("not_found", "Timesheet was not found.");
        var resource = Authorizer.Authorize(services.PolicyCaller(caller), AuthorizationAction.Read, row);
        return resource.Allowed ? row : new ToolError("not_found", "Timesheet was not found.");
    }
}
