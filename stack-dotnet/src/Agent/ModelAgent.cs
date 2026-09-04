using System.ClientModel;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI;
using StackDotnet.Tools;

namespace StackDotnet.Agent;

public sealed class ModelAgent
{
    private readonly IChatClient chatClient;
    private readonly IList<AITool> durableToolDeclarations;

    public ModelAgent(ToolCatalog catalog)
    {
        var options = new OpenAIClientOptions { Endpoint = new Uri(Required("GATEWAY_LLM_URL")) };
        var openAi = new OpenAIClient(new ApiKeyCredential("gateway"), options);
        #pragma warning disable OPENAI001
        chatClient = openAi.GetResponsesClient().AsIChatClient(Required("GATEWAY_MODEL"));
        #pragma warning restore OPENAI001
        durableToolDeclarations = catalog.Functions.Select(function => (AITool)function.AsDeclarationOnly()).ToArray();
    }

    public async Task<ModelTurn> RunAsync(ModelInput input)
    {
        var agent = new ChatClientAgent(
            chatClient,
            instructions: input.SystemInstructions,
            name: "timesheet-reviewer",
            tools: input.EnableTools ? durableToolDeclarations : []);
        #pragma warning disable OPENAI001
        var response = await agent.RunAsync(input.UserPrompt, options: new ChatClientAgentRunOptions(new ChatOptions
        {
            AllowMultipleToolCalls = false,
            Reasoning = new ReasoningOptions { Effort = ReasoningEffort.High },
        }));
        #pragma warning restore OPENAI001
        var calls = response.Messages
            .SelectMany(message => message.Contents)
            .OfType<FunctionCallContent>()
            .Select(call => new PlannedToolCall(call.CallId, call.Name, System.Text.Json.JsonSerializer.Serialize(call.Arguments)))
            .ToArray();
        return new(response.Text, calls);
    }

    private static string Required(string name) => Environment.GetEnvironmentVariable(name)
        ?? throw new InvalidOperationException($"{name} is required.");
}
