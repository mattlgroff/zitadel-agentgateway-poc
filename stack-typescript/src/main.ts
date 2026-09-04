import { serve } from "@hono/node-server";
import { Client, Connection } from "@temporalio/client";
import { registerAgentRoutes } from "./agent/routes.js";
import { createWorker } from "./agent/worker.js";
import { app } from "./mcp-server/server.js";

const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233" });
const client = new Client({ connection });
registerAgentRoutes(app, client);
const worker = await createWorker();
const workerRun = worker.run();
const server = serve({ fetch: app.fetch, port: 5000, hostname: "0.0.0.0" });

async function shutdown(): Promise<void> {
  server.close();
  worker.shutdown();
  await workerRun;
  await connection.close();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
