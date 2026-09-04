import { readFile, writeFile } from "node:fs/promises";

const stack = process.argv[2];
if (!stack || !["dotnet", "python", "typescript", "ref"].includes(stack)) {
  throw new Error("STACK must be dotnet, python, typescript, or ref");
}

const host = stack === "ref" ? "ref-mcp" : `stack-${stack}`;
const port = stack === "ref" ? "4300" : "5000";
const url = stack === "ref" ? "http://localhost:4300" : "http://localhost:5000";
const path = new URL("../.env", import.meta.url);
let env = await readFile(path, "utf8");

for (const [key, value] of Object.entries({
  ACTIVE_STACK_HOST: host,
  ACTIVE_STACK_PORT: port,
  STACK_URL: url,
})) {
  const line = `${key}=${value}`;
  env = new RegExp(`^${key}=.*$`, "m").test(env)
    ? env.replace(new RegExp(`^${key}=.*$`, "m"), line)
    : `${env.trimEnd()}\n${line}\n`;
}

await writeFile(path, env);
console.log(`active stack: ${stack} (${host}:${port}, ${url})`);

