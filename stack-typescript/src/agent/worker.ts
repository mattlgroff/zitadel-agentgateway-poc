import { createOpenAI } from "@ai-sdk/openai";
import { AiSdkPlugin } from "@temporalio/ai-sdk";
import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { upstreamActivities } from "../upstream/activities.js";

export async function createWorker(): Promise<Worker> {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? "temporal:7233" });
  const modelProvider = createOpenAI({
    baseURL: process.env.GATEWAY_BASE_URL ?? "http://agentgateway:3001/v1",
    apiKey: "gateway",
  });
  return Worker.create({
    connection,
    namespace: "default",
    taskQueue: "agents-typescript",
    workflowsPath: fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "./workflow.ts" : "./workflow.js", import.meta.url)),
    activities: upstreamActivities,
    plugins: [new AiSdkPlugin({ modelProvider })],
  });
}
