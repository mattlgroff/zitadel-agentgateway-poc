namespace StackDotnet.Policy;

public sealed record CallerContext(string Sub, string OrgId, string[] Roles);

public sealed record HumanDecisionContext(IReadOnlySet<string> ApprovedIds)
{
    public static HumanDecisionContext None { get; } = new(new HashSet<string>());
}
