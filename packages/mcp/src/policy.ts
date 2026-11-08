import type { ToolPolicy } from "@aicoo/sharedos-contracts";
import { ToolPolicySchema } from "@aicoo/sharedos-contracts";
import { hashJson } from "@aicoo/sharedos-core";

import { SHAREDOS_MCP_SERVER_NAME } from "./server.js";

/** A host declaration of the tool surface, never proof of process isolation. */
export interface DeclareToolPolicyOptions {
  readonly mode?: ToolPolicy["mode"];
  /** Unknown unless the host explicitly attests a complete inventory with evidence. */
  readonly inventory?: ToolPolicy["inventory"];
  /** SharedOS MCP endpoints. Defaults to the one this package serves. */
  readonly managedMcp?: readonly string[];
  /** All local tools outside the broker, including shell, writes, and reads. */
  readonly harnessLocal?: readonly string[];
  /** MCP servers the harness was configured with independently. */
  readonly externalDirect?: readonly string[];
  /** References supporting this declaration; these are not isolation attestations. */
  readonly evidence?: readonly string[];
}

export function declareToolPolicy(options: DeclareToolPolicyOptions = {}): ToolPolicy {
  const harnessLocal = [...(options.harnessLocal ?? [])];
  const externalDirect = [...(options.externalDirect ?? [])];
  const inventory = options.inventory ?? "unknown";
  if (
    inventory === "complete" &&
    (options.harnessLocal === undefined || options.externalDirect === undefined)
  ) {
    throw new TypeError(
      "a complete tool inventory must explicitly list harnessLocal and externalDirect",
    );
  }
  return parseToolPolicy({
    version: "2",
    mode:
      options.mode ??
      (harnessLocal.length > 0 || externalDirect.length > 0
        ? "mixed"
        : inventory === "complete"
          ? "broker-only"
          : "unknown"),
    inventory,
    managedMcp: [...(options.managedMcp ?? [SHAREDOS_MCP_SERVER_NAME])],
    harnessLocal,
    externalDirect,
    evidence: [...(options.evidence ?? [])],
  });
}

export function parseToolPolicy(value: unknown): ToolPolicy {
  const parsed = ToolPolicySchema.safeParse(value);
  if (!parsed.success) {
    throw new TypeError(
      `tool policy is not valid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  return Object.freeze({
    ...parsed.data,
    managedMcp: Object.freeze([...parsed.data.managedMcp]),
    harnessLocal: Object.freeze([...parsed.data.harnessLocal]),
    externalDirect: Object.freeze([...parsed.data.externalDirect]),
    evidence: Object.freeze([...parsed.data.evidence]),
  }) as ToolPolicy;
}

/** A content identifier for the declared policy, including its evidence references. */
export function toolPolicyHash(policy: ToolPolicy): Promise<string> {
  return hashJson(parseToolPolicy(policy));
}
