using StackDotnet;
using StackDotnet.Policy;
using StackDotnet.Tools;
using Xunit;

namespace StackDotnet.Tests;

public sealed class ApprovalPolicyTests
{
    private static Timesheet Sheet(decimal amount = 1700m, double hours = 40, string manager = "ada", string org = "acme") =>
        new("ts", org, manager, "Worker", "2026-09-04", hours, amount, "PENDING", "untrusted instructions");

    [Fact]
    public void HiringManagerOnlyCoversOwnTeam() =>
        Assert.True(Authorizer.Authorize(new("ada", "acme", ["hiring_manager"]), AuthorizationAction.Approve, Sheet(), ApprovalPolicy.For("acme")).Allowed);

    [Fact]
    public void ViewerCannotDecide() =>
        Assert.False(Authorizer.Authorize(new("linus", "acme", ["viewer"]), AuthorizationAction.Approve, Sheet(), ApprovalPolicy.For("acme")).Allowed);

    [Fact]
    public void CrossOrgIsDenied() =>
        Assert.False(Authorizer.Authorize(new("ada", "globex", ["program_office"]), AuthorizationAction.Read, Sheet()).Allowed);

    [Theory]
    [InlineData(2000, 40)]
    [InlineData(1700, 61)]
    [InlineData(2400, 40)]
    public void AcmeThresholdRequiresHumanRegardlessOfNote(decimal amount, double hours) =>
        Assert.Equal("requires_human_approval", Authorizer.Authorize(new("ada", "acme", ["hiring_manager"]), AuthorizationAction.Approve, Sheet(amount, hours), ApprovalPolicy.For("acme")).Error);

    [Fact]
    public void UnderThresholdIsAllowedRegardlessOfNote() =>
        Assert.True(Authorizer.Authorize(new("ada", "acme", ["hiring_manager"]), AuthorizationAction.Approve, Sheet(), ApprovalPolicy.For("acme")).Allowed);

    [Fact]
    public void SharedAuthorizerRequiresHumanForAboveThresholdDecision()
    {
        var result = Authorizer.Authorize(new("ada", "acme", ["hiring_manager"]), AuthorizationAction.Approve, Sheet(2400m), ApprovalPolicy.For("acme"));
        Assert.Equal("requires_human_approval", result.Error);
    }

    [Fact]
    public void SharedAuthorizerRequiresOperatorForTermination()
    {
        Assert.False(Authorizer.Authorize(new("ada", "acme", ["hiring_manager"]), AuthorizationAction.Terminate, null).Allowed);
        Assert.True(Authorizer.Authorize(new("opie", "platform", ["operator"]), AuthorizationAction.Terminate, null).Allowed);
    }

    [Fact]
    public void ToolCatalogProjectsExactlyFiveSharedImplementations()
    {
        var catalog = new ToolCatalog();
        Assert.Equal(5, catalog.Functions.Count);
        Assert.Equal(5, catalog.McpTools.Count);
        Assert.Equal(
            ["approve_timesheet", "get_approval_detail", "list_my_pending_approvals", "reject_timesheet", "what_is_required"],
            catalog.Functions.Select(function => function.Name).Order().ToArray());
    }
}
