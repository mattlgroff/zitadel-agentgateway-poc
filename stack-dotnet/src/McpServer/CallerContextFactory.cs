using System.Security.Claims;
using System.Text.Json;
using StackDotnet.Policy;

namespace StackDotnet.McpServer;

public sealed class CallerContextFactory(IHttpContextAccessor accessor)
{
    public CallerContext Create()
    {
        var principal = accessor.HttpContext?.User ?? throw new InvalidOperationException("No HTTP caller context is available.");
        var sub = principal.FindFirstValue("sub") ?? throw new InvalidOperationException("The token has no sub claim.");
        var org = principal.FindFirstValue("urn:zitadel:iam:user:resourceowner:id") ?? throw new InvalidOperationException("The token has no resource owner claim.");
        return new(sub, org, ParseRoles(principal));
    }

    private static string[] ParseRoles(ClaimsPrincipal principal)
    {
        var projectId = Environment.GetEnvironmentVariable("ZITADEL_PROJECT_ID") ?? throw new InvalidOperationException("ZITADEL_PROJECT_ID is required.");
        var claim = principal.FindFirst($"urn:zitadel:iam:org:project:{projectId}:roles");
        if (claim is null) return [];
        var roles = new HashSet<string>(StringComparer.Ordinal);
        try
        {
            using var document = JsonDocument.Parse(claim.Value);
            if (document.RootElement.ValueKind == JsonValueKind.Object)
                foreach (var property in document.RootElement.EnumerateObject()) roles.Add(property.Name);
        }
        catch (JsonException)
        {
            if (!string.IsNullOrWhiteSpace(claim.Value)) roles.Add(claim.Value);
        }
        return roles.ToArray();
    }
}
