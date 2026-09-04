using System.Text.Json;

namespace StackDotnet.UiStream;

public sealed class VercelStream(HttpResponse response)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task SendAsync(object part, CancellationToken cancellationToken)
    {
        await response.WriteAsync($"data: {JsonSerializer.Serialize(part, Json)}\n\n", cancellationToken);
        await response.Body.FlushAsync(cancellationToken);
    }

    public Task StartAsync(string messageId, CancellationToken token) => SendAsync(new { type = "start", messageId }, token);
    public Task TextStartAsync(string id, CancellationToken token) => SendAsync(new { type = "text-start", id }, token);
    public Task TextDeltaAsync(string id, string delta, CancellationToken token) => SendAsync(new { type = "text-delta", id, delta }, token);
    public Task TextEndAsync(string id, CancellationToken token) => SendAsync(new { type = "text-end", id }, token);
    public Task DataAsync(string type, object data, CancellationToken token) => SendAsync(new { type = $"data-{type}", data }, token);
    public Task ToolInputStartAsync(string toolCallId, string toolName, CancellationToken token) => SendAsync(new { type = "tool-input-start", toolCallId, toolName }, token);
    public Task ToolInputDeltaAsync(string toolCallId, string inputTextDelta, CancellationToken token) => SendAsync(new { type = "tool-input-delta", toolCallId, inputTextDelta }, token);
    public Task ToolInputAvailableAsync(string toolCallId, string toolName, object input, CancellationToken token) => SendAsync(new { type = "tool-input-available", toolCallId, toolName, input }, token);
    public Task ToolOutputAvailableAsync(string toolCallId, object output, CancellationToken token) => SendAsync(new { type = "tool-output-available", toolCallId, output }, token);
    public Task FinishAsync(CancellationToken token) => SendAsync(new { type = "finish" }, token);
    public async Task DoneAsync(CancellationToken token)
    {
        await response.WriteAsync("data: [DONE]\n\n", token);
        await response.Body.FlushAsync(token);
    }
}
