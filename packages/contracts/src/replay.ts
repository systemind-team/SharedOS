import { z } from "zod";

import { IdentifierSchema } from "./common.js";
import { JsonValueSchema } from "./json.js";

/** A structural tenant-scoped identity; scope is an execution ID for tool calls. */
export const ReplayKeySchema = z
  .object({
    namespaceId: IdentifierSchema,
    kind: z.enum(["execution", "tool", "resource", "message"]),
    scope: z.string().max(256),
    id: IdentifierSchema,
  })
  .strict();
export type ReplayKey = z.infer<typeof ReplayKeySchema>;

/** Durable identity survives result-body expiry and never becomes claimable again. */
export const ReplayRecordSchema = z
  .object({
    key: ReplayKeySchema,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
    token: IdentifierSchema,
    state: z.enum(["pending", "completed", "failed", "interrupted", "expired"]),
    result: JsonValueSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    const terminal = record.state === "completed" || record.state === "failed";
    if (terminal !== (record.result !== undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only completed/failed records carry a result",
      });
    }
  });
export type ReplayRecord = z.infer<typeof ReplayRecordSchema>;
