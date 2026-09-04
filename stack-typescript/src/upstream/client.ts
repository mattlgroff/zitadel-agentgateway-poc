import type { Timesheet } from "../types.js";

async function graphql<T>(tenant: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(process.env.MOCK_CWS_URL ?? "http://mock-cws:4100/graphql", {
    method: "POST",
    headers: { "content-type": "application/json", "x-org-id": tenant },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json() as { data?: T; errors?: Array<{ message: string }>; extensions?: Record<string, unknown> };
  if (!response.ok || payload.errors?.length || !payload.data) throw new Error(payload.errors?.[0]?.message ?? `GraphQL ${response.status}`);
  return payload.data;
}

const fields = "id orgId managerId workerName weekEnding hours amount status note";

export async function pending(tenant: string, managerId?: string): Promise<Timesheet[]> {
  const data = await graphql<{ pendingTimesheets: Timesheet[] }>(tenant, `query Pending($orgId: ID!, $managerId: ID) { pendingTimesheets(orgId: $orgId, managerId: $managerId) { ${fields} } }`, { orgId: tenant, managerId });
  return data.pendingTimesheets;
}

export async function detail(tenant: string, id: string): Promise<Timesheet | null> {
  const data = await graphql<{ timesheet: Timesheet | null }>(tenant, `query Detail($id: ID!) { timesheet(id: $id) { ${fields} } }`, { id });
  return data.timesheet;
}

export async function approve(tenant: string, id: string, actorId: string, reason?: string): Promise<Timesheet> {
  const data = await graphql<{ approveTimesheet: Timesheet }>(tenant, `mutation Approve($id: ID!, $actorId: ID!, $reason: String) { approveTimesheet(id: $id, actorId: $actorId, reason: $reason) { ${fields} } }`, { id, actorId, reason });
  return data.approveTimesheet;
}

export async function reject(tenant: string, id: string, actorId: string, reason: string): Promise<Timesheet> {
  const data = await graphql<{ rejectTimesheet: Timesheet }>(tenant, `mutation Reject($id: ID!, $actorId: ID!, $reason: String!) { rejectTimesheet(id: $id, actorId: $actorId, reason: $reason) { ${fields} } }`, { id, actorId, reason });
  return data.rejectTimesheet;
}
