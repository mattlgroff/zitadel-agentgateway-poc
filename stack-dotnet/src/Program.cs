using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.DurableTask.Client;
using Microsoft.DurableTask.Client.AzureManaged;
using Microsoft.DurableTask.Worker;
using Microsoft.DurableTask.Worker.AzureManaged;
using System.Threading.RateLimiting;
using ModelContextProtocol.Server;
using StackDotnet.McpServer;
using StackDotnet.Agent;
using StackDotnet.Policy;
using StackDotnet.Tools;
using StackDotnet.Upstream;

if (args is ["--healthcheck"])
{
    using var healthClient = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    try { Environment.Exit((await healthClient.GetAsync("http://127.0.0.1:5000/health")).IsSuccessStatusCode ? 0 : 1); }
    catch { Environment.Exit(1); }
}

var builder = WebApplication.CreateBuilder(args);
var projectId = Required("ZITADEL_PROJECT_ID");
var acmeOrgId = Required("ACME_ORG_ID");
var globexOrgId = Required("GLOBEX_ORG_ID");
builder.Services.AddHttpContextAccessor();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy => policy
    .AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader().WithExposedHeaders("Mcp-Session-Id")));
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer(options =>
{
    options.MapInboundClaims = false;
    options.Authority = "http://localhost:8080";
    options.MetadataAddress = "http://proxy/.well-known/openid-configuration";
    options.BackchannelHttpHandler = new ZitadelBackchannelHandler();
    options.RequireHttpsMetadata = false;
    options.TokenValidationParameters = new Microsoft.IdentityModel.Tokens.TokenValidationParameters
    {
        ValidateIssuer = true,
        ValidIssuer = "http://localhost:8080",
        ValidateAudience = true,
        ValidAudiences = [projectId],
        NameClaimType = "sub",
    };
    options.RefreshOnIssuerKeyNotFound = true;
    options.Events = new JwtBearerEvents
    {
        OnChallenge = context =>
        {
            context.Response.Headers.WWWAuthenticate = "Bearer resource_metadata=\"http://localhost:3000/.well-known/oauth-protected-resource/mcp\"";
            return Task.CompletedTask;
        },
    };
});
builder.Services.AddAuthorization();
builder.Services.AddRateLimiter(options => options.AddPolicy("runs", context =>
    RateLimitPartition.GetFixedWindowLimiter(
        context.User.FindFirst("sub")?.Value ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 })));
builder.Services.AddHttpClient<CwsClient>(client => client.BaseAddress = new Uri(Required("MOCK_CWS_URL")));
builder.Services.AddHttpClient<IRunHistory, DtsHistoryClient>(client => client.BaseAddress = new Uri(Required("DTS_DASHBOARD_URL")));
builder.Services.AddSingleton(provider => new ToolServices(
    provider.GetRequiredService<CwsClient>(),
    acmeOrgId,
    globexOrgId,
    new Dictionary<string, string>
    {
        [Required("ADA_SUB")] = "ada",
        [Required("MARGARET_SUB")] = "margaret",
    }));
builder.Services.AddScoped<CallerContextFactory>();
builder.Services.AddScoped(provider => provider.GetRequiredService<CallerContextFactory>().Create());
builder.Services.AddScoped(_ => HumanDecisionContext.None);
var catalog = new ToolCatalog();
builder.Services.AddSingleton(catalog);
builder.Services.AddMcpServer()
    .WithHttpTransport(options => options.Stateless = true)
    .WithTools(catalog.McpTools);
var dtsConnection = Required("DTS_CONNECTION");
builder.Services.AddDurableTaskWorker(worker =>
{
    worker.AddTasks(tasks =>
    {
        tasks.AddOrchestrator<ReviewOrchestration>();
        tasks.AddActivity<RulesActivity>();
        tasks.AddActivity<ListActivity>();
        tasks.AddActivity<DetailActivity>();
        tasks.AddActivity<ApproveActivity>();
        tasks.AddActivity<RejectActivity>();
        tasks.AddActivity<ModelActivity>();
    });
    worker.UseDurableTaskScheduler(dtsConnection);
});
builder.Services.AddDurableTaskClient(client => client.UseDurableTaskScheduler(dtsConnection));
builder.Services.AddSingleton<ModelAgent>();

var app = builder.Build();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.MapGet("/health", () => Results.Ok(new { ok = true }));
app.MapGet("/.well-known/oauth-protected-resource", () => Results.Ok(new
{
    resource = "http://localhost:5000/mcp",
    authorization_servers = new[] { "http://localhost:4200" },
    scopes_supported = new[] { "openid", "profile", "email" },
    bearer_methods_supported = new[] { "header" },
}));
app.MapMcp("/mcp").RequireAuthorization();
AgentEndpoints.Map(app);
app.Run("http://0.0.0.0:5000");

static string Required(string name) => Environment.GetEnvironmentVariable(name)
    ?? throw new InvalidOperationException($"{name} is required.");

public partial class Program;
