import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSchema, createYoga } from "graphql-yoga";
const seedPath = fileURLToPath(new URL("../seed.json", import.meta.url));
let rows = [];
let mutations = [];
let queries = [];
async function reset() {
    rows = JSON.parse(await readFile(seedPath, "utf8"));
    mutations = [];
    queries = [];
}
await reset();
const typeDefs = /* GraphQL */ `
  type Timesheet { id: ID!, orgId: ID!, managerId: ID!, workerName: String!, weekEnding: String!, hours: Float!, amount: Float!, status: TimesheetStatus!, note: String }
  enum TimesheetStatus { PENDING APPROVED REJECTED }
  type Query { pendingTimesheets(orgId: ID!, managerId: ID): [Timesheet!]!, timesheet(id: ID!): Timesheet }
  type Mutation { approveTimesheet(id: ID!, actorId: ID!, reason: String): Timesheet!, rejectTimesheet(id: ID!, actorId: ID!, reason: String!): Timesheet! }
`;
function visible(row, context) {
    return row.orgId === context.orgId;
}
function findRequired(id, context) {
    const row = rows.find((item) => item.id === id && visible(item, context));
    if (!row)
        throw new Error("timesheet not found in X-Org-Id scope");
    return row;
}
function mutationLog(mutation, id, actorId, reason) {
    const record = { ts: new Date().toISOString(), mutation, id, actorId, reason: reason ?? null };
    mutations.push(record);
    console.log(JSON.stringify(record));
}
function queryLog(query, context, managerId, id) {
    const record = { ts: new Date().toISOString(), query, orgId: context.orgId, managerId: managerId ?? null, id: id ?? null };
    queries.push(record);
    console.log(JSON.stringify(record));
}
const schema = createSchema({ typeDefs, resolvers: {
        Query: {
            pendingTimesheets: (_root, args, context) => {
                if (args.orgId !== context.orgId)
                    throw new Error("orgId must match X-Org-Id");
                queryLog("pendingTimesheets", context, args.managerId);
                return rows.filter((row) => visible(row, context) && row.status === "PENDING" && (!args.managerId || row.managerId === args.managerId));
            },
            timesheet: (_root, args, context) => {
                queryLog("timesheet", context, undefined, args.id);
                return rows.find((row) => row.id === args.id && visible(row, context)) ?? null;
            },
        },
        Mutation: {
            approveTimesheet: (_root, args, context) => {
                const row = findRequired(args.id, context);
                if (row.status === "APPROVED") {
                    context.alreadyApproved = true;
                    return row;
                }
                row.status = "APPROVED";
                mutationLog("approveTimesheet", row.id, args.actorId, args.reason);
                return row;
            },
            rejectTimesheet: (_root, args, context) => {
                const row = findRequired(args.id, context);
                if (!args.reason.trim())
                    throw new Error("reason is required");
                if (row.status !== "REJECTED") {
                    row.status = "REJECTED";
                    mutationLog("rejectTimesheet", row.id, args.actorId, args.reason);
                }
                return row;
            },
        },
    } });
const yoga = createYoga({
    schema,
    context: ({ request }) => {
        const orgId = request.headers.get("x-org-id");
        if (!orgId)
            throw new Error("X-Org-Id header is required");
        return { request, orgId, alreadyApproved: false };
    },
    plugins: [{ onExecute: ({ args }) => ({ onExecuteDone: ({ result, setResult }) => {
                    const context = args.contextValue;
                    if (context.alreadyApproved && !(Symbol.asyncIterator in Object(result)))
                        setResult({ ...result, extensions: { ...result.extensions, alreadyApproved: true } });
                } }) }],
});
const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
        response.setHeader("content-type", "application/json");
        response.end('{"ok":true}');
        return;
    }
    if (request.method === "GET" && request.url === "/admin/mutations") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(mutations));
        return;
    }
    if (request.method === "GET" && request.url === "/admin/queries") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(queries));
        return;
    }
    if (request.method === "POST" && request.url === "/admin/reset") {
        await reset();
        response.end('{"ok":true}');
        return;
    }
    if (request.method === "POST" && request.url === "/admin/seed") {
        const chunks = [];
        for await (const chunk of request)
            chunks.push(Buffer.from(chunk));
        const override = JSON.parse(Buffer.concat(chunks).toString());
        if (!Array.isArray(override)) {
            response.statusCode = 400;
            response.end('{"error":"array required"}');
            return;
        }
        rows = structuredClone(override);
        response.end('{"ok":true}');
        return;
    }
    yoga(request, response);
});
server.listen(4100, "0.0.0.0", () => console.log(JSON.stringify({ service: "mock-cws", port: 4100 })));
