import { proxyActivities } from "@temporalio/workflow";
import type { CallerContext } from "../types.js";
import type { UpstreamActivities } from "./activities.js";
import * as direct from "./client.js";

type BusinessUpstream = Pick<UpstreamActivities, "pending" | "detail" | "approve" | "reject">;

const durable = proxyActivities<BusinessUpstream>({
  startToCloseTimeout: "1 minute",
  retry: { maximumAttempts: 5 },
});

export function upstreamFor(caller: CallerContext): BusinessUpstream {
  return caller.durable ? durable : direct;
}
