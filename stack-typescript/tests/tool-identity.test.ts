import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import { registerAiTool } from "../src/adapters/mcp.js";
import { createAgent } from "../src/agent/workflow.js";
import { tools } from "../src/tools/index.js";

describe("shared AI SDK tools", () => {
  it("uses the exact same tool objects for the agent and MCP", () => {
    const agent = createAgent({ sub: "test", orgId: "test", roles: ["hiring_manager"] }, "gpt-5.6-luna");
    expect(agent.tools).toBe(tools);

    const registerTool = vi.fn();
    const server = { registerTool } as unknown as McpServer;
    registerAiTool(server, "approve_timesheet", tools.approve_timesheet as Parameters<typeof registerAiTool>[2]);

    expect(registerTool).toHaveBeenCalledOnce();
    expect(registerTool.mock.calls[0]?.[1].inputSchema).toBe(tools.approve_timesheet.inputSchema);
  });
});
