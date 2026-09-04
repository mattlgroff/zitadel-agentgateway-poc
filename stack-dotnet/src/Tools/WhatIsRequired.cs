using System.ComponentModel;
using StackDotnet.Policy;

namespace StackDotnet.Tools;

public static class WhatIsRequired
{
    [Description("Return the rules that govern timesheet approval for the current user's tenant and role: the auto-approve amount threshold, the maximum hours per week before a timesheet must be reviewed by a human, and which actions the current role may take. Call this once at the start of a review so you do not have to guess the rules.")]
    public static object Execute(ToolServices services, CallerContext caller)
    {
        var invocation = Authorizer.Authorize(caller, AuthorizationAction.Rules, null);
        if (!invocation.Allowed) return new ToolError(invocation.Error!, invocation.Message!);
        var policy = ApprovalPolicy.For(services.OrgName(caller));
        return new
        {
            auto_approve_below_usd = policy.AutoApproveBelowUsd,
            max_hours_per_week = policy.MaxHoursPerWeek,
            may_approve = caller.Roles.Contains("hiring_manager") || caller.Roles.Contains("program_office"),
            may_reject = caller.Roles.Contains("hiring_manager") || caller.Roles.Contains("program_office"),
        };
    }
}
