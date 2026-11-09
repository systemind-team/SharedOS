import {
  PROTOCOL_VERSION,
  SHAREDOS_VERSION,
  type JsonObject,
  type RuntimeManifest,
} from "@aicoo/sharedos-contracts";
import type { McpHarnessId } from "@aicoo/sharedos-mcp";

import { claudeCodeProtocol } from "./claude-code/protocol.js";
import { codexProtocol } from "./codex/protocol.js";
import { deepseekProtocol } from "./deepseek/protocol.js";
import type { HarnessProtocol, HarnessRequirements } from "./harness.js";
import { piProtocol } from "./pi/protocol.js";

/** What one vendor harness is, stated once: its id, its codec, what it needs, how its records are named. */
export interface HarnessVendor {
  /** The id this harness goes by everywhere: manifests, requirements, MCP specs, scripts. */
  readonly id: McpHarnessId;
  readonly protocol: HarnessProtocol;
  /** What a live session needs before it can run. */
  readonly requirements: HarnessRequirements;
  /** The manifest of a turn the SharedOS loop drives, speaking the vendor's wire format. */
  readonly manifest: RuntimeManifest;
  /** The manifest of a turn the vendor CLI runs itself, connected over MCP. */
  readonly mcpManifest: RuntimeManifest;
}

export interface HarnessVendorDefinition {
  readonly id: McpHarnessId;
  readonly protocol: HarnessProtocol;
  /** Executable expected on PATH. */
  readonly executable: string;
  /** Environment variables, any one of which satisfies the credential need. */
  readonly credentialVariables: readonly string[];
  /**
   * The harness runs its own tools, so the permission-filtered catalogue
   * cannot be declared in a frame. Stamped on every record its driven manifest
   * produces, because a column whose catalogue arrived out of band is making a
   * narrower claim than one whose catalogue was on the wire.
   */
  readonly catalogueOutOfBand?: boolean;
  /** What else the MCP manifest says about how this harness reaches MCP. */
  readonly mcpMetadata?: JsonObject;
}

const PACKAGE = "@aicoo/sharedos-adapters";

/**
 * One vendor's manifests and requirements from its few facts.
 *
 * Every harness here can also authenticate from a session it stored itself
 * (`codex login`, a Claude subscription, `dsh`'s credentials file, Pi's
 * `auth.json`), so credentials are optional for all of them.
 */
export function defineHarnessVendor(definition: HarnessVendorDefinition): HarnessVendor {
  const { id, protocol } = definition;
  return Object.freeze({
    id,
    protocol,
    requirements: Object.freeze({
      harness: id,
      executable: definition.executable,
      credentialVariables: Object.freeze([...definition.credentialVariables]),
      credentialsOptional: true,
    }),
    manifest: Object.freeze({
      id: `sharedos.${id}`,
      version: SHAREDOS_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      metadata: {
        package: PACKAGE,
        harness: id,
        wireProtocol: protocol.id,
        executionModel: "bounded-driver-loop",
        ...(definition.catalogueOutOfBand === true ? { catalogueDelivery: "out-of-band" } : {}),
      },
    }),
    mcpManifest: Object.freeze({
      id: `sharedos.${id}.mcp`,
      version: SHAREDOS_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      metadata: {
        package: PACKAGE,
        harness: id,
        toolshare: "mcp",
        executionModel: "native-harness-loop",
        ...definition.mcpMetadata,
      },
    }),
  });
}

/**
 * The four vendor harnesses SharedOS ships a codec for.
 *
 * A vendor CLI is seated in a product through `createMcpHarnessRuntime`, which
 * reads its MCP manifest here. Its wire codec is seated only by evaluation,
 * behind `EvalHarnessDriver`, and that turn is filed under `manifest`.
 */
export const CODEX_VENDOR: HarnessVendor = defineHarnessVendor({
  id: "codex",
  protocol: codexProtocol,
  executable: "codex",
  credentialVariables: ["OPENAI_API_KEY", "CODEX_API_KEY"],
});

export const CLAUDE_CODE_VENDOR: HarnessVendor = defineHarnessVendor({
  id: "claude-code",
  protocol: claudeCodeProtocol,
  executable: "claude",
  credentialVariables: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
});

export const DEEPSEEK_VENDOR: HarnessVendor = defineHarnessVendor({
  id: "deepseek",
  protocol: deepseekProtocol,
  executable: "dsh",
  credentialVariables: ["DEEPSEEK_API_KEY", "DSH_API_KEY"],
  catalogueOutOfBand: true,
});

export const PI_VENDOR: HarnessVendor = defineHarnessVendor({
  id: "pi",
  protocol: piProtocol,
  executable: "pi",
  /**
   * Pi routes to whichever provider its model config names, so no single
   * variable is the credential. These are the ones its shipped providers read.
   */
  credentialVariables: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "PI_API_KEY"],
  catalogueOutOfBand: true,
  /**
   * Named, not implied. Pi has had an MCP client of its own since 0.99, and a
   * record from before then names the extension that stood in for it, so a
   * record from now on says which of the two it was.
   */
  mcpMetadata: { mcpSupport: "native" },
});

export const CODEX_HARNESS_ID = CODEX_VENDOR.id;
export const CODEX_RUNTIME_MANIFEST: RuntimeManifest = CODEX_VENDOR.manifest;
export const CODEX_REQUIREMENTS: HarnessRequirements = CODEX_VENDOR.requirements;

export const CLAUDE_CODE_HARNESS_ID = CLAUDE_CODE_VENDOR.id;
export const CLAUDE_CODE_RUNTIME_MANIFEST: RuntimeManifest = CLAUDE_CODE_VENDOR.manifest;
export const CLAUDE_CODE_REQUIREMENTS: HarnessRequirements = CLAUDE_CODE_VENDOR.requirements;

export const DEEPSEEK_HARNESS_ID = DEEPSEEK_VENDOR.id;
export const DEEPSEEK_RUNTIME_MANIFEST: RuntimeManifest = DEEPSEEK_VENDOR.manifest;
export const DEEPSEEK_REQUIREMENTS: HarnessRequirements = DEEPSEEK_VENDOR.requirements;

export const PI_HARNESS_ID = PI_VENDOR.id;
export const PI_RUNTIME_MANIFEST: RuntimeManifest = PI_VENDOR.manifest;
export const PI_REQUIREMENTS: HarnessRequirements = PI_VENDOR.requirements;
