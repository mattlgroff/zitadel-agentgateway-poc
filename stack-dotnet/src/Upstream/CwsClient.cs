using System.Net.Http.Json;
using System.Text.Json;

namespace StackDotnet.Upstream;

public sealed class CwsClient(HttpClient http)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<Timesheet>> PendingAsync(string orgId, string? managerId, CancellationToken cancellationToken)
    {
        const string query = "query Pending($orgId: ID!, $managerId: ID) { pendingTimesheets(orgId: $orgId, managerId: $managerId) { id orgId managerId workerName weekEnding hours amount status note } }";
        var data = await SendAsync<PendingData>(orgId, query, new { orgId, managerId }, cancellationToken);
        return data.PendingTimesheets;
    }

    public async Task<Timesheet?> GetAsync(string orgId, string id, CancellationToken cancellationToken)
    {
        const string query = "query Detail($id: ID!) { timesheet(id: $id) { id orgId managerId workerName weekEnding hours amount status note } }";
        return (await SendAsync<DetailData>(orgId, query, new { id }, cancellationToken)).Timesheet;
    }

    public Task<Timesheet> ApproveAsync(string orgId, string id, string actorId, string? reason, CancellationToken cancellationToken)
    {
        const string query = "mutation Approve($id: ID!, $actorId: ID!, $reason: String) { approveTimesheet(id: $id, actorId: $actorId, reason: $reason) { id orgId managerId workerName weekEnding hours amount status note } }";
        return MutateAsync(orgId, query, new { id, actorId, reason }, true, cancellationToken);
    }

    public Task<Timesheet> RejectAsync(string orgId, string id, string actorId, string reason, CancellationToken cancellationToken)
    {
        const string query = "mutation Reject($id: ID!, $actorId: ID!, $reason: String!) { rejectTimesheet(id: $id, actorId: $actorId, reason: $reason) { id orgId managerId workerName weekEnding hours amount status note } }";
        return MutateAsync(orgId, query, new { id, actorId, reason }, false, cancellationToken);
    }

    private async Task<Timesheet> MutateAsync(string orgId, string query, object variables, bool approve, CancellationToken cancellationToken)
    {
        var data = await SendAsync<MutationData>(orgId, query, variables, cancellationToken);
        return approve ? data.ApproveTimesheet! : data.RejectTimesheet!;
    }

    private async Task<T> SendAsync<T>(string orgId, string query, object variables, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "graphql")
        {
            Content = JsonContent.Create(new { query, variables }),
        };
        request.Headers.Add("X-Org-Id", orgId);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var envelope = await response.Content.ReadFromJsonAsync<GraphQlEnvelope<T>>(Json, cancellationToken);
        return envelope is { Data: not null } ? envelope.Data : throw new InvalidOperationException("GraphQL response had no data.");
    }

    private sealed record GraphQlEnvelope<T>(T? Data);
    private sealed record PendingData(IReadOnlyList<Timesheet> PendingTimesheets);
    private sealed record DetailData(Timesheet? Timesheet);
    private sealed record MutationData(Timesheet? ApproveTimesheet, Timesheet? RejectTimesheet);
}
