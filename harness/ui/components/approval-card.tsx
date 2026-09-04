"use client";

import { useState } from "react";

type Item = { id?: string; timesheet_id?: string; workerName?: string; worker_name?: string; amount: number; hours: number; recommendation?: string; reason?: string };
type Decision = { timesheet_id: string; action: "approve" | "reject" | "skip"; reason?: string };

export function ApprovalCard({ runId, items, stackUrl, accessToken }: { runId: string; items: Item[]; stackUrl: string; accessToken: string }) {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [state, setState] = useState<"ready" | "sending" | "sent" | "error">("ready");
  const update = (id: string, patch: Partial<Decision>) => setDecisions((current) => ({ ...current, [id]: { ...current[id], ...patch, timesheet_id: id, action: patch.action ?? current[id]?.action ?? "skip" } }));
  const submit = async () => {
    setState("sending");
    const response = await fetch(`${stackUrl}/runs/${encodeURIComponent(runId)}/decision`, {
      method: "POST", headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ decisions: items.map((item) => decisions[item.id ?? item.timesheet_id!] ?? { timesheet_id: item.id ?? item.timesheet_id!, action: "skip" }) }),
    });
    setState(response.ok ? "sent" : "error");
  };
  return <section data-run-id={runId} className="my-4 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4" aria-label="Human approval required">
    <div className="mb-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">Human decision required</p><h3 className="mt-1 text-lg font-medium">Review unusual timesheets</h3></div>
    <div className="space-y-3">{items.map((item) => { const id = item.id ?? item.timesheet_id!; return <article key={id} data-approval-id={id} className="rounded-lg border bg-black/20 p-3">
      <div className="flex flex-wrap justify-between gap-2"><strong>{item.workerName ?? item.worker_name ?? id}</strong><span className="font-mono text-sm">${item.amount.toLocaleString()} · {item.hours}h</span></div>
      <p className="my-2 text-sm text-neutral-300">{item.recommendation ?? item.reason ?? "Policy requires your review."}</p>
      <div className="flex flex-wrap gap-2">{(["approve", "reject", "skip"] as const).map((action) => <button key={action} type="button" onClick={() => update(id, { action })} className={`rounded-md border px-3 py-1.5 text-sm capitalize ${decisions[id]?.action === action ? "border-lime-300 bg-lime-300 text-black" : "bg-neutral-900"}`}>{action}</button>)}</div>
      {decisions[id]?.action === "reject" && <input aria-label={`Reason for ${id}`} className="mt-2 w-full rounded-md border bg-neutral-950 p-2 text-sm" minLength={3} maxLength={500} placeholder="Reason the worker will see" onChange={(event) => update(id, { reason: event.target.value })} />}
    </article>; })}</div>
    <button type="button" disabled={state === "sending" || state === "sent"} onClick={submit} className="mt-4 rounded-md bg-lime-300 px-4 py-2 font-medium text-black disabled:opacity-50">{state === "sent" ? "Decision sent" : state === "sending" ? "Sending..." : "Submit decisions"}</button>
    {state === "error" && <p className="mt-2 text-sm text-red-300">The decision endpoint rejected this response.</p>}
  </section>;
}
