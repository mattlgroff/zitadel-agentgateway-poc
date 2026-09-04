namespace StackDotnet.Policy;

public sealed record TenantPolicy(decimal AutoApproveBelowUsd, double MaxHoursPerWeek);

public static class ApprovalPolicy
{
    private static readonly IReadOnlyDictionary<string, TenantPolicy> Policies =
        new Dictionary<string, TenantPolicy>
        {
            ["acme"] = new(2000m, 60),
            ["globex"] = new(2500m, 60),
        };

    public static TenantPolicy For(string orgName) => Policies.TryGetValue(orgName, out var policy)
        ? policy
        : throw new ArgumentOutOfRangeException(nameof(orgName), "Unknown tenant.");
}
