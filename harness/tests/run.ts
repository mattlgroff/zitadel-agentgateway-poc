import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

type Status = "pass" | "fail" | "skip";
type Result = { id: string; status: Status; evidence: unknown; durationMs: number };

const stack = process.env.STACK;
if (!stack || !["dotnet", "python", "typescript", "ref"].includes(stack)) throw new Error("STACK must be dotnet, python, typescript, or ref");
const reportDir = new URL(`../reports/${stack}/`, import.meta.url);
const stackUrl = process.env.STACK_URL ?? "http://localhost:5000";
await mkdir(reportDir, { recursive: true });
const results: Result[] = [];
let failed = false;

async function record(id: string, status: Status, evidence: unknown, started: number): Promise<void> {
  const item = { id, status, evidence, durationMs: Date.now() - started } satisfies Result;
  results.push(item);
  await writeFile(new URL("tests.json", reportDir), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`${id} ${status.toUpperCase()} ${JSON.stringify(evidence)}`);
  if (status === "fail") failed = true;
}

async function check(id: string, action: () => Promise<unknown>): Promise<void> {
  const started = Date.now();
  try { await record(id, "pass", await action(), started); }
  catch (error) { await record(id, "fail", { error: error instanceof Error ? error.message : String(error) }, started); }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await check("T1", async () => {
  const response = await fetch("http://localhost:3000/.well-known/oauth-protected-resource/mcp");
  const value = await response.json() as Record<string, any>;
  assert(response.ok && value.authorization_servers?.includes("http://localhost:4200"), JSON.stringify(value));
  return value;
});

for (const [id, mode] of [["T2", "native"], ["T3", "broker"]] as const) {
  await check(id, async () => {
    const run = spawnSync("npx", ["tsx", "scripts/oauth-demo.ts", mode], { encoding: "utf8", env: process.env });
    const output = `${run.stdout}${run.stderr}`.trim();
    assert(run.status === 0, output);
    return { output };
  });
}

if (stack === "ref") {
  for (let number = 4; number <= 16; number++) await record(`T${number}`, "skip", { reason: "stack-specific test is not applicable to ref-mcp" }, Date.now());
} else {
  const { runStackTests } = await import("./stack-tests.js");
  if (await runStackTests(stack, stackUrl, record)) failed = true;
}

process.exit(failed ? 1 : 0);
