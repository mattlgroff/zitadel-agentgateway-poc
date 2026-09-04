using System.Reflection;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Server;
using StackDotnet.Policy;

namespace StackDotnet.Tools;

public sealed class ToolCatalog
{
    public IReadOnlyList<AIFunction> Functions { get; }
    public IReadOnlyList<McpServerTool> McpTools { get; }

    public ToolCatalog()
    {
        Functions =
        [
            Create(typeof(ListMyPendingApprovals), "list_my_pending_approvals"),
            Create(typeof(GetApprovalDetail), "get_approval_detail"),
            Create(typeof(ApproveTimesheet), "approve_timesheet"),
            Create(typeof(RejectTimesheet), "reject_timesheet"),
            Create(typeof(WhatIsRequired), "what_is_required"),
        ];
        McpTools = Functions.Select(function => McpServerTool.Create(function, new() { UseStructuredContent = false })).ToArray();
    }

    private static AIFunction Create(Type type, string name)
    {
        var method = type.GetMethod("Execute", BindingFlags.Public | BindingFlags.Static)
            ?? throw new InvalidOperationException($"{type.Name}.Execute was not found.");
        return AIFunctionFactory.Create(method, target: null, new AIFunctionFactoryOptions
        {
            Name = name,
            ConfigureParameterBinding = parameter =>
            {
                if (parameter.ParameterType != typeof(ToolServices) && parameter.ParameterType != typeof(CallerContext) && parameter.ParameterType != typeof(HumanDecisionContext)) return default;
                return new AIFunctionFactoryOptions.ParameterBindingOptions
                {
                    ExcludeFromSchema = true,
                    BindParameter = (_, arguments) => arguments.Services?.GetRequiredService(parameter.ParameterType)
                        ?? throw new InvalidOperationException($"No {parameter.ParameterType.Name} is available."),
                };
            },
        });
    }
}
