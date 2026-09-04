import { McpServer, type ServerContext } from "@modelcontextprotocol/server";
import type { Tool } from "ai";
import type { z } from "zod";
import { callerFromAuth } from "../mcp-server/auth.js";

type ExecutableTool = Tool<unknown, unknown, unknown> & {
  description: string;
  inputSchema: z.ZodType;
  execute: NonNullable<Tool<unknown, unknown, unknown>["execute"]>;
};

export function registerAiTool(server: McpServer, name: string, aiTool: ExecutableTool): void {
  const register = server.registerTool.bind(server) as (
    toolName: string,
    config: { description: string; inputSchema: z.ZodType },
    callback: (args: unknown, ctx: ServerContext) => Promise<Record<string, unknown>>,
  ) => unknown;
  register(
    name,
    { description: aiTool.description, inputSchema: aiTool.inputSchema },
    async (args: unknown, ctx: ServerContext) => {
      const output = await aiTool.execute(args, {
        toolCallId: ctx.mcpReq.id.toString(),
        messages: [],
        context: callerFromAuth(ctx.http?.authInfo),
      });
      if (output && typeof output === "object" && Symbol.asyncIterator in output) {
        throw new Error("Streaming tool results are not supported by this adapter.");
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output as Record<string, unknown>,
      };
    },
  );
}
