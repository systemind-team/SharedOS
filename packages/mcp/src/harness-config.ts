import type { JsonObject } from "@aicoo/sharedos-contracts";

import { SHAREDOS_MCP_SERVER_NAME } from "./server.js";

/**
 * Harness configuration, which declares a CONNECTION and nothing else.
 *
 * This is the architectural rule the whole boundary rests on, and it is worth
 * stating where the files are generated:
 *
 *     Harness configuration declares a CONNECTION.
 *     SharedOS declares the TOOLS.
 *     SharedOS capabilities declare the AUTHORITY.
 *     RuntimeHost is the only EXECUTION path.
 *
 * So every emitter here produces a few lines naming a URL. None of them enumerate
 * tools, and none of them can: the catalogue is resolved per turn from the access
 * context, and a file on disk cannot know who is asking. A harness setting that
 * looks like authorization -- Codex's `enabled_tools`, Claude's `allowedTools` --
 * is defense in depth and UX policy over a catalogue SharedOS already filtered,
 * never the thing that decides.
 */

export interface HarnessMcpConnection {
  /** The Streamable HTTP endpoint the turn-scoped bridge is serving. */
  readonly url: string;
  /** The server name the harness will namespace its aliases under. */
  readonly name?: string;
  /**
   * Per-call timeout in the emitted config. Unset unless the host sets it;
   * unset writes no timeout, and the harness's own default applies.
   */
  readonly timeoutSec?: number;
  /** Bearer token for a sandboxed or remote harness. */
  readonly token?: string;
}

/**
 * The server name a harness namespaces its aliases under: the connection's own,
 * or `sharedos`. The one place the default is applied, so an emitted config, a
 * launch argument and a turn's metadata cannot name different servers.
 */
export function mcpServerName(connection: Pick<HarnessMcpConnection, "name">): string {
  return connection.name ?? SHAREDOS_MCP_SERVER_NAME;
}

/** One generated file: what to write, and what a harness expects it to be called. */
export interface HarnessMcpConfigFile {
  readonly harness: string;
  readonly filename: string;
  readonly contents: string;
}

/**
 * The settings a Codex MCP server entry carries, as key and TOML value.
 *
 * One list serves both forms Codex accepts -- the `[mcp_servers.<name>]` table
 * {@link codexMcpConfig} emits, and the `-c mcp_servers.<name>.<key>=<value>`
 * overrides a launch passes -- so the two cannot disagree. `bearer_token`,
 * present only when the connection carries one, belongs to the file alone: a
 * launch keeps it off the command line.
 *
 * `required = true` is deliberate. A Codex run whose SharedOS server failed to
 * start should not quietly continue with only its own tools -- that run would
 * look like a harness that declined to use the catalogue, which is a different
 * finding entirely.
 *
 * `default_tools_approval_mode = "approve"` is the same decision as Claude
 * Code's `--allowedTools`, and not an authorization one. Codex gates MCP calls
 * itself, and its default mode, `auto`, decides from the tool's `readOnlyHint`:
 * read-only tools run, everything else asks a human. A run with no human then
 * refuses every write inside Codex, with the kernel never consulted. `approve`
 * is scoped to this one server, leaves Codex's shell sandbox alone, and hands
 * the decision to the only thing that should be making it:
 * `RuntimeHost.invokeTool`, which re-authorizes every call.
 */
export function codexMcpServerSettings(
  connection: HarnessMcpConnection,
): readonly (readonly [key: string, value: string])[] {
  const settings: (readonly [string, string])[] = [
    ["url", JSON.stringify(connection.url)],
    ["required", "true"],
    ...(connection.timeoutSec === undefined
      ? []
      : [["tool_timeout_sec", String(connection.timeoutSec)] as const]),
    ["default_tools_approval_mode", JSON.stringify("approve")],
  ];
  if (connection.token !== undefined) {
    settings.push(["bearer_token", JSON.stringify(connection.token)]);
  }
  return settings;
}

/** Codex's `config.toml` fragment: {@link codexMcpServerSettings} as a table. */
export function codexMcpConfig(connection: HarnessMcpConnection): string {
  const name = mcpServerName(connection);
  const lines = [
    `[mcp_servers.${name}]`,
    ...codexMcpServerSettings(connection).map(([key, value]) => `${key} = ${value}`),
  ];
  return `${lines.join("\n")}\n`;
}

/** Claude Code's `.mcp.json`. */
export function claudeCodeMcpConfig(connection: HarnessMcpConnection): JsonObject {
  const name = mcpServerName(connection);
  return {
    mcpServers: {
      [name]: {
        type: "http",
        url: connection.url,
        ...(connection.token === undefined
          ? {}
          : { headers: { Authorization: `Bearer ${connection.token}` } }),
      },
    },
  };
}

/**
 * Claude Agent SDK options for a non-interactive evaluation.
 *
 * `allowedTools` auto-approves the SharedOS server, which is the correct setting
 * precisely because it is not an authorization decision: Claude separates tool
 * availability from permission prompting, and prompting a human for a run with no
 * human in it would stall the eval rather than secure it. What secures it is that
 * every one of those calls is re-authorized by the kernel.
 */
export function claudeAgentSdkMcpOptions(connection: HarnessMcpConnection): JsonObject {
  const name = mcpServerName(connection);
  const servers = claudeCodeMcpConfig(connection)["mcpServers"] as JsonObject;
  return {
    mcpServers: servers,
    allowedTools: [`mcp__${name}__*`],
  };
}

/**
 * DeepSeek Harness's plugin patch overlay.
 *
 * A dsh profile composes an ordered stack of plugin-bundle patch layers, and a
 * `--patch` overlay is the last one. Its entries are id-targeted: a bare `id:`
 * entry *overrides* a plugin already in the tree, and only an `insert:` entry
 * *adds* one. Getting that backwards fails quietly -- dsh warns `patch: entry
 * "..." not found` on stderr and boots without the plugin, which downstream
 * reads as a harness that declined to use the catalogue rather than as a
 * misconfigured one.
 *
 * The plugin itself must already be installed into the profile
 * (`dsh plugin --profile <name> add @deepseek-ai/dsh-mcp-client`). A patch
 * activates a plugin; it does not fetch one.
 *
 * `@deepseek-ai/dsh-mcp-client` then performs `tools/list`, converts the
 * schemas, and registers each result through `ctx.tools.register()`. Nothing in
 * this file describes a tool, for the same reason as the others.
 *
 * `failOnStartupError` is set for the same reason Codex's server is `required`:
 * a run that quietly continued with only the harness's own tools would look like
 * a harness that declined to use the catalogue, which is a different finding.
 */
export function deepseekMcpConfig(connection: HarnessMcpConnection): string {
  const name = mcpServerName(connection);
  const lines = [
    "- insert:",
    `    - id: mcp-${name}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    "      config:",
    `        serverName: ${name}`,
    "        transport: streamable-http",
    `        url: ${JSON.stringify(connection.url)}`,
    "        failOnStartupError: true",
    ...(connection.timeoutSec === undefined
      ? []
      : [`        toolCallTimeoutMs: ${connection.timeoutSec * 1_000}`]),
  ];
  if (connection.token !== undefined) {
    lines.push(
      "        headers:",
      `          Authorization: ${JSON.stringify(`Bearer ${connection.token}`)}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Pi's `.mcp.json`, read by an MCP extension.
 *
 * Pi ships no MCP client. Reaching an MCP server therefore requires an
 * extension, and *which* extension is a host choice rather than something
 * SharedOS mandates -- `pi-mcp-adapter` is the one this repository is exercised
 * against, and anything with the same job would serve. The file shape below is
 * that adapter's, which happens to be Claude Code's shape with its own
 * lifecycle and timeout keys.
 *
 * The effect is not identical to a native client, and the difference is worth
 * knowing when reading a Pi column. The adapter registers a single `mcp` proxy
 * tool and discovers the catalogue behind it on demand, so Pi's model calls
 * `mcp({tool: "files.read", ...})` rather than `files.read`, and the
 * harness-facing surface is one tool wide.
 *
 * None of that reaches SharedOS: what arrives at the bridge is an ordinary
 * `tools/call` naming the canonical tool, authorized exactly like any other.
 * Which is the point of keeping the harness-facing alias out of authorization.
 *
 * `lifecycle: "eager"` connects at startup rather than on first use, so the
 * catalogue is fetched inside the turn that opened the bridge rather than at
 * some later moment the turn may already have closed.
 */
export function piMcpConfig(connection: HarnessMcpConnection): JsonObject {
  const name = mcpServerName(connection);
  return {
    mcpServers: {
      [name]: {
        url: connection.url,
        lifecycle: "eager",
        ...(connection.timeoutSec === undefined
          ? {}
          : { requestTimeoutMs: connection.timeoutSec * 1_000 }),
        ...(connection.token === undefined
          ? {}
          : { auth: "bearer", bearerToken: connection.token }),
      },
    },
  };
}

/** The harnesses this package emits a connection for, by id. */
export const MCP_HARNESS_IDS = Object.freeze(["codex", "claude-code", "deepseek", "pi"] as const);
export type McpHarnessId = (typeof MCP_HARNESS_IDS)[number];

/** Every emitter above, addressed by harness id. */
export function harnessMcpConfigFile(
  harness: McpHarnessId,
  connection: HarnessMcpConnection,
): HarnessMcpConfigFile {
  switch (harness) {
    case "codex":
      return { harness, filename: "config.toml", contents: codexMcpConfig(connection) };
    case "claude-code":
      return {
        harness,
        filename: ".mcp.json",
        contents: `${JSON.stringify(claudeCodeMcpConfig(connection), undefined, 2)}\n`,
      };
    case "deepseek":
      // `cordis.patch.yml`, not `cordis.yml`: this is an overlay applied over the
      // profile's composed tree, which is what `dsh --patch` takes.
      return { harness, filename: "cordis.patch.yml", contents: deepseekMcpConfig(connection) };
    case "pi":
      return {
        harness,
        filename: ".mcp.json",
        contents: `${JSON.stringify(piMcpConfig(connection), undefined, 2)}\n`,
      };
  }
}

/**
 * The harness-facing alias a tool is likely to appear under.
 *
 * `mcp__<serverName>__<rawName>` is the shape Claude Code, Codex, and DeepSeek
 * Harness all use, so it is the one assumed here. It is still only an
 * approximation: DeepSeek normalises the raw name to `[A-Za-z0-9_-]` and, when
 * that changes the name -- which it does for every dotted SharedOS name --
 * appends a deterministic hash so two tools can never collapse into one alias.
 *
 * Which is exactly why nothing may authorize against this. The alias is recorded
 * so a vendor transcript can be read back to a canonical name, and SharedOS maps
 * a name it receives back to the catalogue rather than trusting a reconstruction.
 */
export function harnessToolAlias(serverName: string, tool: string): string {
  return `mcp__${serverName}__${tool.replace(/[^A-Za-z0-9_]/gu, "_")}`;
}
