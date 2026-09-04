namespace StackDotnet.Policy;

public enum AuthorizationAction
{
    List,
    Read,
    Approve,
    Reject,
    Rules,
    Terminate,
}

public sealed record AuthorizationDecision(bool Allowed, string? Error = null, string? Message = null)
{
    public static AuthorizationDecision Permit { get; } = new(true);
    public static AuthorizationDecision Deny(string error, string message) => new(false, error, message);
}

public static class Authorizer
{
    public const string ImplementationReference = "StackDotnet.Policy.Authorizer.Authorize";

    public static AuthorizationDecision Authorize(
        CallerContext caller,
        AuthorizationAction action,
        Timesheet? resource,
        TenantPolicy? policy = null)
    {
        var mayRead = caller.Roles.Any(role => role is "viewer" or "hiring_manager" or "program_office");
        var mayDecide = caller.Roles.Any(role => role is "hiring_manager" or "program_office");
        var roleAllowed = action switch
        {
            AuthorizationAction.List or AuthorizationAction.Read or AuthorizationAction.Rules => mayRead,
            AuthorizationAction.Approve or AuthorizationAction.Reject => mayDecide,
            AuthorizationAction.Terminate => caller.Roles.Contains("operator"),
            _ => false,
        };
        if (!roleAllowed)
            return AuthorizationDecision.Deny("not_authorized", "The caller role cannot perform this action.");

        if (resource is null)
            return AuthorizationDecision.Permit;

        var coversResource = resource.OrgId == caller.OrgId &&
            (caller.Roles.Contains("program_office") ||
             caller.Roles.Contains("hiring_manager") && resource.ManagerId == caller.Sub ||
             action is AuthorizationAction.Read or AuthorizationAction.List && caller.Roles.Contains("viewer"));
        if (!coversResource)
            return AuthorizationDecision.Deny("not_authorized", "The caller does not cover this resource.");

        if (action is AuthorizationAction.Approve or AuthorizationAction.Reject)
        {
            ArgumentNullException.ThrowIfNull(policy);
            if (resource.Amount >= policy.AutoApproveBelowUsd || resource.Hours > policy.MaxHoursPerWeek)
                return AuthorizationDecision.Deny("requires_human_approval", "Tenant policy requires a human decision.");
        }

        return AuthorizationDecision.Permit;
    }
}
