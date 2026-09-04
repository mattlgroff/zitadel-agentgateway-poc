import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSchema, createYoga } from "graphql-yoga";

type Status = "PENDING" | "APPROVED" | "REJECTED";
type Timesheet = { id: string; orgId: string; managerId: string; workerName: string; weekEnding: string; hours: number; amount: number; status: Status; note: string | null };
type Context = { request: Request; orgId: string; alreadyApproved: boolean };
type MutationRecord = { ts: string; mutation: string; id: string; actorId: string; reason: string | null };
type QueryRecord = { ts: string; query: string; orgId: string; managerId: string | null; id: string | null };

const seedPath = fileURLToPath(new URL("../seed.json", import.meta.url));
let rows: Timesheet[] = [];
let mutations: MutationRecord[] = [];
let queries: QueryRecord[] = [];
let delayedMutation: { id: string; milliseconds: number } | undefined;

async function reset(): Promise<void> {
  rows = JSON.parse(await readFile(seedPath, "utf8"));
  mutations = [];
  queries = [];
  delayedMutation = undefined;
}
await reset();

const typeDefs = /* GraphQL */ `
  type Timesheet { id: ID!, orgId: ID!, managerId: ID!, workerName: String!, weekEnding: String!, hours: Float!, amount: Float!, status: TimesheetStatus!, note: String }
  enum TimesheetStatus { PENDING APPROVED REJECTED }
  type Query { pendingTimesheets(orgId: ID!, managerId: ID): [Timesheet!]!, timesheet(id: ID!): Timesheet }
  type Mutation { approveTimesheet(id: ID!, actorId: ID!, reason: String): Timesheet!, rejectTimesheet(id: ID!, actorId: ID!, reason: String!): Timesheet! }
`;

function visible(row: Timesheet, context: Context): boolean {
  return row.orgId === context.orgId;
}

function findRequired(id: string, context: Context): Timesheet {
  const row = rows.find((item) => item.id === id && visible(item, context));
  if (!row) throw new Error("timesheet not found in X-Org-Id scope");
  return row;
}

function mutationLog(mutation: string, id: string, actorId: string, reason?: string): void {
  const record = { ts: new Date().toISOString(), mutation, id, actorId, reason: reason ?? null };
  mutations.push(record);
  console.log(JSON.stringify(record));
}

function queryLog(query: string, context: Context, managerId?: string, id?: string): void {
  const record = { ts: new Date().toISOString(), query, orgId: context.orgId, managerId: managerId ?? null, id: id ?? null };
  queries.push(record);
  console.log(JSON.stringify(record));
}

const schema = createSchema({ typeDefs, resolvers: {
  Query: {
    pendingTimesheets: (_root, args: { orgId: string; managerId?: string }, context: Context) => {
      if (args.orgId !== context.orgId) throw new Error("orgId must match X-Org-Id");
      queryLog("pendingTimesheets", context, args.managerId);
      return rows.filter((row) => visible(row, context) && row.status === "PENDING" && (!args.managerId || row.managerId === args.managerId));
    },
    timesheet: (_root, args: { id: string }, context: Context) => {
      queryLog("timesheet", context, undefined, args.id);
      return rows.find((row) => row.id === args.id && visible(row, context)) ?? null;
    },
  },
  Mutation: {
    approveTimesheet: async (_root, args: { id: string; actorId: string; reason?: string }, context: Context) => {
      const row = findRequired(args.id, context);
      if (row.status === "APPROVED") { context.alreadyApproved = true; return row; }
      row.status = "APPROVED";
      mutationLog("approveTimesheet", row.id, args.actorId, args.reason);
      const delay = delayedMutation;
      if (delay?.id === row.id) await new Promise((resolve) => setTimeout(resolve, delay.milliseconds));
      return row;
    },
    rejectTimesheet: (_root, args: { id: string; actorId: string; reason: string }, context: Context) => {
      const row = findRequired(args.id, context);
      if (!args.reason.trim()) throw new Error("reason is required");
      if (row.status !== "REJECTED") { row.status = "REJECTED"; mutationLog("rejectTimesheet", row.id, args.actorId, args.reason); }
      return row;
    },
  },
} });

const yoga = createYoga<Context>({
  schema,
  context: ({ request }) => {
    const orgId = request.headers.get("x-org-id");
    if (!orgId) throw new Error("X-Org-Id header is required");
    return { request, orgId, alreadyApproved: false };
  },
  plugins: [{ onExecute: ({ args }: any) => ({ onExecuteDone: ({ result, setResult }: any) => {
    const context = args.contextValue as Context;
    if (context.alreadyApproved && !(Symbol.asyncIterator in Object(result))) setResult({ ...result, extensions: { ...(result as any).extensions, alreadyApproved: true } } as any);
  } }) }],
});

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") { response.setHeader("content-type", "application/json"); response.end('{"ok":true}'); return; }
  if (request.method === "GET" && request.url === "/admin/mutations") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(mutations)); return; }
  if (request.method === "GET" && request.url === "/admin/queries") { response.setHeader("content-type", "application/json"); response.end(JSON.stringify(queries)); return; }
  if (request.method === "POST" && request.url === "/admin/reset") { await reset(); response.end('{"ok":true}'); return; }
  if (request.method === "POST" && request.url === "/admin/chaos") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const value = JSON.parse(Buffer.concat(chunks).toString()) as { id?: string; milliseconds?: number };
    delayedMutation = value.id && value.milliseconds ? { id: value.id, milliseconds: value.milliseconds } : undefined;
    response.end('{"ok":true}'); return;
  }
  if (request.method === "POST" && request.url === "/admin/seed") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const override = JSON.parse(Buffer.concat(chunks).toString()) as Timesheet[];
    if (!Array.isArray(override)) { response.statusCode = 400; response.end('{"error":"array required"}'); return; }
    rows = structuredClone(override);
    response.end('{"ok":true}'); return;
  }
  yoga(request, response);
});
server.listen(4100, "0.0.0.0", () => console.log(JSON.stringify({ service: "mock-cws", port: 4100 })));
