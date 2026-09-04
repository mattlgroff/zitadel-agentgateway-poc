using System.Net.Http.Json;
using System.Text.Json;

namespace StackDotnet.Agent;

public interface IRunHistory
{
    Task<string?> GetRawHistoryAsync(string runId, CancellationToken token);
    Task<IReadOnlyList<string>> GetRunningReviewIdsAsync(CancellationToken token);
}

public sealed class DtsHistoryClient(HttpClient http) : IRunHistory
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task<string?> GetRawHistoryAsync(string runId, CancellationToken token)
    {
        using var instance = await SendAsync(HttpMethod.Get, $"v1/taskhubs/orchestrations/{Uri.EscapeDataString(runId)}", null, token);
        if (instance.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        instance.EnsureSuccessStatusCode();
        using var descriptor = JsonDocument.Parse(await instance.Content.ReadAsStringAsync(token));
        var executionId = descriptor.RootElement.GetProperty("executionId").GetString();
        if (string.IsNullOrWhiteSpace(executionId)) return null;
        using var response = await SendAsync(HttpMethod.Get, $"v1/taskhubs/orchestrations/{Uri.EscapeDataString(runId)}/executions/{Uri.EscapeDataString(executionId)}/history", null, token);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadAsStringAsync(token);
    }

    public async Task<IReadOnlyList<string>> GetRunningReviewIdsAsync(CancellationToken token)
    {
        using var response = await SendAsync(HttpMethod.Post, "v1/taskhubs/orchestrations/query", JsonContent.Create(new { pagination = new { count = 1000 } }), token);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
        return document.RootElement.GetProperty("orchestrations").EnumerateArray()
            .Where(item => item.GetProperty("name").GetString() == nameof(ReviewOrchestration) &&
                           item.GetProperty("orchestrationStatus").GetString() is "ORCHESTRATION_STATUS_RUNNING" or "ORCHESTRATION_STATUS_PENDING")
            .Select(item => item.GetProperty("instanceId").GetString()!)
            .ToArray();
    }

    private Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, HttpContent? content, CancellationToken token)
    {
        var request = new HttpRequestMessage(method, path) { Content = content };
        request.Headers.Add("x-taskhub", "default");
        return http.SendAsync(request, token);
    }
}
