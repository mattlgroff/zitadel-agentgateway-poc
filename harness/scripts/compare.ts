import { mkdir, readFile, writeFile } from "node:fs/promises";

type Result = { id: string; status: "pass" | "fail" | "skip"; evidence: unknown; durationMs: number };
const stacks = ["dotnet", "python", "typescript"] as const;
const results = new Map<string, Result[]>();
for (const stack of stacks) {
  try {
    results.set(stack, JSON.parse(await readFile(new URL(`../reports/${stack}/tests.json`, import.meta.url), "utf8")));
  } catch {
    results.set(stack, []);
  }
}

const lines = [
  "# T1-T16 acceptance matrix",
  "",
  "This matrix reports test status only. It deliberately computes no percentages or blended score.",
  "",
  "| Test | .NET | Python | TypeScript |",
  "| --- | --- | --- | --- |",
];
for (let number = 1; number <= 16; number++) {
  const id = `T${number}`;
  lines.push(`| ${id} | ${results.get("dotnet")?.find((item) => item.id === id)?.status ?? "missing"} | ${results.get("python")?.find((item) => item.id === id)?.status ?? "missing"} | ${results.get("typescript")?.find((item) => item.id === id)?.status ?? "missing"} |`);
}
lines.push("");
await mkdir(new URL("../reports/", import.meta.url), { recursive: true });
await writeFile(new URL("../reports/matrix.md", import.meta.url), `${lines.join("\n")}\n`);
console.log("wrote reports/matrix.md");
