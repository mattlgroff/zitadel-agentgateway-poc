import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
const app = express();
app.use(express.json());
function createServer() {
    const server = new McpServer({ name: "reference-mcp", version: "1.0.0" });
    server.registerTool("ping", {
        description: "Return a deterministic response for harness connectivity checks.",
        inputSchema: {},
    }, async () => ({ content: [{ type: "text", text: JSON.stringify({ pong: true }) }] }));
    return server;
}
const sessions = new Map();
app.post("/mcp", async (request, response) => {
    const sessionId = request.header("mcp-session-id");
    let transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
        transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: randomUUID,
            onsessioninitialized: (id) => {
                sessions.set(id, transport);
            },
        });
        transport.onclose = () => {
            if (transport?.sessionId)
                sessions.delete(transport.sessionId);
        };
        await createServer().connect(transport);
    }
    await transport.handleRequest(request, response, request.body);
});
app.get("/health", (_request, response) => response.json({ ok: true }));
app.listen(4300, "0.0.0.0", () => console.log(JSON.stringify({ service: "ref-mcp", port: 4300 })));
