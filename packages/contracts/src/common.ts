import { z } from "zod";

/**
 * The wire protocol version implemented by this package, as the one value
 * every request, event, result, envelope and manifest stamps on itself.
 *
 * `"1"` is the shape `1.0.0-preview` shipped and is frozen there: a change a
 * `1.0.0-preview` reader would reject moves this value (ADR 0019).
 */
export const PROTOCOL_VERSION = "1" as const;

/** The wire protocol version implemented by this package. */
export const ProtocolVersionSchema = z.literal(PROTOCOL_VERSION);
export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

/**
 * The SharedOS build, as every manifest, MCP server and conformance record
 * names it.
 *
 * The packages share one version and are published together, so there is one
 * constant. The release gate holds it equal to the synchronized package
 * version, because a record that names the wrong build is evidence attributed
 * to code that never ran.
 */
export const SHAREDOS_VERSION = "1.0.0-preview";

/** An opaque identifier. Callers choose its format; SharedOS only requires stability. */
export const IdentifierSchema = z.string().trim().min(1);
export type Identifier = z.infer<typeof IdentifierSchema>;

/** An RFC 3339 timestamp, represented as a string to remain JSON-safe. */
export const TimestampSchema = z.string().datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;
