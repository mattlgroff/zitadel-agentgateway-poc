import { serve } from "@hono/node-server";
import { Client, Connection } from "@temporalio/client";
import { createOpenAI } from "@ai-sdk/openai";
import { callerFromAuth, verifyAccessToken } from "../mcp-server/auth.js";
import { conversationApi } from "./api.js";
import { ConversationStore } from "./store.js";

if (!process.env.CONVERSATION_DB || !process.env.TEMPORAL_ADDRESS) throw new Error("CONVERSATION_DB and TEMPORAL_ADDRESS are required");
const store = new ConversationStore(process.env.CONVERSATION_DB);
const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
const model = process.env.GATEWAY_BASE_URL ? createOpenAI({ baseURL: process.env.GATEWAY_BASE_URL, apiKey: "gateway" }).languageModel(process.env.GATEWAY_MODEL ?? "gpt-5.6-luna") : undefined;
const app = conversationApi({
  store, client: new Client({ connection }), taskQueue: process.env.CONVERSATION_QUEUE ?? "conversations", model,
  authenticate: async authorization => {
    if (!authorization?.startsWith("Bearer ")) throw new Error("Missing bearer token");
    const caller = callerFromAuth(await verifyAccessToken(authorization.slice(7)));
    return { tenant: caller.orgId, user: caller.sub };
  },
});
const server = serve({ fetch: app.fetch, port: Number(process.env.CONVERSATION_PORT ?? 5050), hostname: "127.0.0.1" });
async function stop() { server.close(); store.close(); await connection.close(); }
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
