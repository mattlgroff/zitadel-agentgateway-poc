namespace StackDotnet.McpServer;

public sealed class ZitadelBackchannelHandler : HttpClientHandler
{
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri?.Host == "localhost" && request.RequestUri.Port == 8080)
            request.RequestUri = new UriBuilder(request.RequestUri) { Host = "proxy", Port = -1 }.Uri;
        return base.SendAsync(request, cancellationToken);
    }
}
