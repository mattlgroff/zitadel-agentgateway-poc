import type { CallerContext } from "../types.js";
import { z } from "zod";

export const callerSchema = z.object({
  sub: z.string(),
  orgId: z.string(),
  roles: z.array(z.string()),
  humanDecisionFor: z.string().optional(),
  durable: z.boolean().optional(),
  tenant: z.enum(["acme", "globex"]).optional(),
  managerFixtureId: z.string().optional(),
});

export function callerFromOptions(options: { context: unknown }): CallerContext {
  const caller = options.context as CallerContext | undefined;
  if (!caller?.sub || !caller.orgId || !Array.isArray(caller.roles)) throw new Error("Caller context is unavailable.");
  return caller;
}
