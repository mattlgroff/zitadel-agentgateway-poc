import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { ConversationStore } from "./store.js";

if (!process.env.CONVERSATION_DB || !process.env.TEMPORAL_ADDRESS) throw new Error("CONVERSATION_DB and TEMPORAL_ADDRESS are required");
const store = new ConversationStore(process.env.CONVERSATION_DB);
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS });
const worker = await Worker.create({
  connection,
  taskQueue: process.env.CONVERSATION_QUEUE ?? "conversations",
  workflowsPath: fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./workflow.ts" : "./workflow.js", import.meta.url)),
  activities: { prepare: store.prepare.bind(store), resolve: store.resolve.bind(store) },
});
process.on("SIGTERM", () => worker.shutdown());
process.on("SIGINT", () => worker.shutdown());
try { await worker.run(); }
finally { store.close(); await connection.close(); }
