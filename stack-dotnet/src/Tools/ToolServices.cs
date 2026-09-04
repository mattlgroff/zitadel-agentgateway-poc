using StackDotnet.Policy;
using StackDotnet.Upstream;

namespace StackDotnet.Tools;

public sealed record ToolServices(CwsClient Cws, string AcmeOrgId, string GlobexOrgId, IReadOnlyDictionary<string, string> ManagerIds)
{
    public string OrgName(CallerContext caller) => caller.OrgId switch
    {
        var id when id == AcmeOrgId => "acme",
        var id when id == GlobexOrgId => "globex",
        _ => throw new InvalidOperationException("Caller organization is not configured."),
    };

    public CallerContext PolicyCaller(CallerContext caller) => new(
        ManagerIds.GetValueOrDefault(caller.Sub, caller.Sub),
        OrgName(caller),
        caller.Roles);
}
