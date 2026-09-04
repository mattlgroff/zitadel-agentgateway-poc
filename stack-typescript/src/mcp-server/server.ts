import { createMcpHandler, McpServer, type AuthInfo } from "@modelcontextprotocol/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerAiTool } from "../adapters/mcp.js";
import { tools } from "../tools/index.js";
import { verifyAccessToken } from "./auth.js";

type Variables = { authInfo: AuthInfo };
export const app = new Hono<{ Variables: Variables }>();
app.use("*", cors({ origin: "*", allowHeaders: ["authorization", "content-type", "mcp-session-id"], exposeHeaders: ["mcp-session-id", "x-vercel-ai-ui-message-stream"] }));

app.get("/health", (context) => context.json({ ok: true }));
app.get("/.well-known/oauth-protected-resource", (context) => context.json({
  resource: "http://localhost:3000/mcp",
  authorization_servers: ["http://localhost:4200"],
  bearer_methods_supported: ["header"],
}));

app.use("/mcp", async (context, next) => {
  const authorization = context.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return context.text("Unauthorized", 401, { "WWW-Authenticate": 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"' });
  try {
    context.set("authInfo", await verifyAccessToken(authorization.slice(7)));
  } catch {
    return context.text("Unauthorized", 401, { "WWW-Authenticate": 'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"' });
  }
  await next();
});

const handler = createMcpHandler(() => {
  const server = new McpServer({ name: "stack-typescript", version: "0.1.0" });
  for (const [name, aiTool] of Object.entries(tools)) registerAiTool(server, name, aiTool as Parameters<typeof registerAiTool>[2]);
  return server;
});

app.all("/mcp", (context) => handler.fetch(context.req.raw, { authInfo: context.get("authInfo") }));
