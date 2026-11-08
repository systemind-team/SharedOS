import { z } from "zod";

import { IdentifierSchema } from "./common.js";
import { JsonObjectSchema } from "./json.js";

/** A machine-readable error that is safe to return over npm and HTTP APIs. */
export const ProtocolErrorSchema = z
  .object({
    code: IdentifierSchema,
    message: z.string().min(1),
    retryable: z.boolean().optional(),
    details: JsonObjectSchema.optional(),
  })
  .strict();

export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;
