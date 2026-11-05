import { describe, expect, it } from "vitest";

import type {
  ExecutionRequest,
  JsonObject,
  ToolDefinition,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import { agentExecutionCapability } from "@aicoo/sharedos-core";
import {
  ESCALATION_ACTION,
  ESCALATION_RESOURCE_PATH,
  ESCALATION_TOOL_DEFINITION,
  ESCALATION_TOOL_NAMESPACE,
  PROMPT_HASH_ANNOTATION,
  SharedOSExecutor,
  createStandardRuntime,
  type AgentTurnDriver,
} from "@aicoo/sharedos-runtime";
import { createTestGrant, createTestKernel } from "@aicoo/sharedos-testkit";

import { EvalHarnessDriver, type EvalHarnessDriverOptions } from "./driver.js";
import {
  CLAUDE_CODE_REQUIREMENTS,
  CLAUDE_CODE_RUNTIME_MANIFEST,
  CLAUDE_CODE_VENDOR,
  CODEX_REQUIREMENTS,
  CODEX_RUNTIME_MANIFEST,
  CODEX_VENDOR,
  DEEPSEEK_REQUIREMENTS,
  DEEPSEEK_RUNTIME_MANIFEST,
  DEEPSEEK_VENDOR,
  PI_REQUIREMENTS,
  PI_RUNTIME_MANIFEST,
  PI_VENDOR,
  type HarnessVendor,
} from "./vendors.js";
import { claudeCodeProtocol } from "./claude-code/protocol.js";
import { codexProtocol } from "./codex/protocol.js";
import { deepseekProtocol } from "./deepseek/protocol.js";
import { piProtocol } from "./pi/protocol.js";
import { probeHarness } from "./node.js";
import { deepseekFrameWriter, piFrameWriter } from "./writer.js";
import { TranscriptTransport, type HarnessTranscript } from "./transcript.js";
import { harnessTurnText, type HarnessFrame } from "./harness.js";
import { handedPromptHash } from "./seat.js";

const NOW = "2026-08-18T09:00:00.000Z";
const AGENT = { kind: "agent", agentId: "agent-1" } as const;
const OWNER = { kind: "human", userId: "owner-1" } as const;

const READ_TOOL: ToolDefinition = {
  name: "files.read",
  description: "Read one authorized file",
  namespace: "files",
  source: "sharedos",
  readWrite: "read",
  inputSchema: { type: "object", properties: { path: { type: "array" } } },
  requiredCapability: {
    resource: { namespace: "files", path: ["Workspace"] },
    action: "read",
  },
  annotations: { readOnly: true },
};

function grants(escalation = false) {
  return [
    createTestGrant({
      id: "grant-turn",
      capabilities: [agentExecutionCapability(AGENT, OWNER)],
      purposes: ["test"],
    }),
    ...(escalation
      ? [
          createTestGrant({
            id: "grant-escalation",
            capabilities: [
              {
                resource: {
                  namespace: ESCALATION_TOOL_NAMESPACE,
                  path: [...ESCALATION_RESOURCE_PATH],
                  owner: OWNER,
                },
                actions: [ESCALATION_ACTION],
                scope: "descendants",
              },
            ],
            purposes: ["test"],
          }),
        ]
      : []),
    createTestGrant({
      id: "grant-files",
      capabilities: [
        {
          resource: { namespace: "files", path: ["Workspace"], owner: OWNER },
          actions: ["read"],
          scope: "descendants",
        },
      ],
      purposes: ["test"],
    }),
  ];
}

function request(escalation = false): ExecutionRequest {
  return {
    version: "1",
    executionId: "execution-1",
    agent: AGENT,
    context: {
      namespaceId: "namespace-1",
      enabledToolNamespaces: escalation ? ["files", ESCALATION_TOOL_NAMESPACE] : ["files"],
      actor: AGENT,
      authority: OWNER,
      owner: OWNER,
      purpose: "test",
      traceId: "trace-1",
      now: NOW,
    },
    message: {
      version: "1",
      id: "message-1",
      sender: AGENT,
      receiver: AGENT,
      purpose: "test",
      payload: { text: "read the workspace" },
      traceId: "trace-1",
      createdAt: NOW,
    },
    tools: escalation ? [READ_TOOL, ESCALATION_TOOL_DEFINITION] : [READ_TOOL],
  };
}

/** One vendor's wire codec in the evaluation driver, filed under that vendor's manifest. */
function driverFor(vendor: HarnessVendor) {
  return (options: Omit<EvalHarnessDriverOptions, "manifest" | "protocol">): EvalHarnessDriver =>
    new EvalHarnessDriver({ ...options, manifest: vendor.manifest, protocol: vendor.protocol });
}
const createCodexDriver = driverFor(CODEX_VENDOR);
const createClaudeCodeDriver = driverFor(CLAUDE_CODE_VENDOR);
const createDeepseekDriver = driverFor(DEEPSEEK_VENDOR);
const createPiDriver = driverFor(PI_VENDOR);

/**
 * Run one turn. With `escalation`, the affordance is registered, granted, and
 * its namespace enabled; without it the tool is still registered in the world,
 * so what an ungranted turn lacks is exactly the grant.
 */
async function runWith(driver: AgentTurnDriver, options: { readonly escalation?: boolean } = {}) {
  const escalation = options.escalation === true;
  const { kernel, audit } = createTestKernel({ grants: grants(escalation) });
  kernel.registerTool({
    definition: READ_TOOL,
    parseArguments: (arguments_) => arguments_,
    invoke: async (context, call) => ({
      callId: call.id,
      tool: call.tool,
      status: "succeeded",
      output: { text: "file body" },
      completedAt: context.now,
    }),
  });
  kernel.registerTool({
    definition: ESCALATION_TOOL_DEFINITION,
    parseArguments: (arguments_) => arguments_,
    invoke: async (context, call) => ({
      callId: call.id,
      tool: call.tool,
      status: "failed",
      error: { code: "escalation_not_terminated", message: "should never be invoked" },
      completedAt: context.now,
    }),
  });
  const result = await new SharedOSExecutor(kernel, createStandardRuntime({ driver }), {
    clock: () => NOW,
  }).execute(request(escalation));
  return { result, audit };
}

// `codex exec --json` for "Hi", recorded live, answered in prose with no tool
// call. The CLI prints only its own events on stdout: read as Responses
// frames they all meant nothing, so the turn completed with no output.
const cliTurn: HarnessFrame[] = [
  { type: "thread.started", thread_id: "019a4c6e-0000-7000-8000-000000000000" },
  { type: "turn.started" },
  { type: "item.started", item: { id: "item_0", type: "reasoning", text: "" } },
  { type: "item.completed", item: { id: "item_0", type: "reasoning", text: "A greeting." } },
  {
    type: "item.completed",
    item: { id: "item_1", type: "agent_message", text: "Hi! What can I help you with?" },
  },
  {
    type: "turn.completed",
    usage: { input_tokens: 1200, cached_input_tokens: 0, output_tokens: 12 },
  },
];

describe("the Codex protocol", () => {
  it("declares the permission-filtered catalogue as function tools", () => {
    expect(codexProtocol.describeTools([READ_TOOL])).toEqual([
      {
        type: "function",
        name: "files.read",
        description: READ_TOOL.description,
        parameters: READ_TOOL.inputSchema,
      },
    ]);
  });

  it("parses a function call, whose arguments arrive as a JSON string", () => {
    expect(
      codexProtocol.interpret({
        type: "function_call",
        call_id: "call-1",
        name: "files.read",
        arguments: '{"path":["Workspace"]}',
      }),
    ).toEqual([
      {
        type: "tool_call",
        callId: "call-1",
        tool: "files.read",
        arguments: { path: ["Workspace"] },
      },
    ]);
  });

  it("fails the turn rather than guessing when arguments will not parse", () => {
    const steps = codexProtocol.interpret({
      type: "function_call",
      call_id: "call-1",
      name: "files.read",
      arguments: "{not json",
    });

    expect(steps[0]).toMatchObject({ type: "failed" });
  });

  it("reports a refusal to the harness as a result, not as a crash", () => {
    const denied: ToolResult = {
      callId: "call-1",
      tool: "files.read",
      status: "denied",
      error: { code: "no_matching_grant", message: "denied" },
      completedAt: NOW,
    };
    const frame = codexProtocol.encodeToolResult(denied);

    expect(frame).toMatchObject({ type: "function_call_output", call_id: "call-1" });
    expect(JSON.parse(frame["output"] as string)).toEqual({
      status: "denied",
      error: { code: "no_matching_grant", message: "denied" },
    });
  });

  it("ignores frames that carry nothing relevant to the turn", () => {
    expect(codexProtocol.interpret({ type: "response.output_item.added" })).toEqual([]);
  });

  it("reads the prose of a CLI turn as its message, and turn.completed as its end", () => {
    expect(cliTurn.flatMap((frame) => codexProtocol.interpret(frame))).toEqual([
      { type: "message", text: "Hi! What can I help you with?" },
      { type: "complete" },
    ]);
  });

  it("reads the CLI's progress events as nothing", () => {
    const progress: HarnessFrame[] = [
      { type: "thread.started", thread_id: "t" },
      { type: "turn.started" },
      { type: "item.started", item: { id: "i", type: "agent_message", text: "partial" } },
      { type: "item.updated", item: { id: "i", type: "agent_message", text: "partial" } },
      {
        type: "item.completed",
        item: { id: "i", type: "mcp_tool_call", server: "sharedos", tool: "files.read" },
      },
      { type: "item.completed", item: { id: "i", type: "agent_message", text: "   " } },
      { type: "item.completed", item: "not an item" },
    ];
    for (const frame of progress) {
      expect(codexProtocol.interpret(frame), JSON.stringify(frame)).toEqual([]);
    }
  });

  it("reads turn.failed as a failed turn with the CLI's reason, or a stated one without", () => {
    expect(
      codexProtocol.interpret({ type: "turn.failed", error: { message: "401 Unauthorized" } }),
    ).toEqual([
      {
        type: "failed",
        error: { code: "harness_failed", message: "401 Unauthorized", retryable: true },
      },
    ]);
    expect(codexProtocol.interpret({ type: "turn.failed" })[0]).toMatchObject({
      type: "failed",
      error: { code: "harness_failed", message: "The Codex CLI reported a failed turn." },
    });
  });

  it("keeps the failure text whichever shape Codex reports it in", () => {
    // The Responses protocol nests the message under `error`; the CLI's JSON
    // mode puts it at the top level. Reading only the nested form reported every
    // live CLI failure as a generic one, which loses the only useful detail.
    const nested = codexProtocol.interpret({
      type: "response.failed",
      error: { code: "rate_limit", message: "slow down" },
    });
    const flat = codexProtocol.interpret({
      type: "error",
      message: "unexpected status 401 Unauthorized",
    });

    expect(nested[0]).toMatchObject({
      type: "failed",
      error: { code: "rate_limit", message: "slow down" },
    });
    expect(flat[0]).toMatchObject({
      type: "failed",
      error: { message: "unexpected status 401 Unauthorized" },
    });
  });
});

describe("the Claude Code protocol", () => {
  it("declares the permission-filtered catalogue as message tools", () => {
    expect(claudeCodeProtocol.describeTools([READ_TOOL])).toEqual([
      {
        name: "files.read",
        description: READ_TOOL.description,
        input_schema: READ_TOOL.inputSchema,
      },
    ]);
  });

  it("reads every content block of one assistant message, in order", () => {
    expect(
      claudeCodeProtocol.interpret({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "looking" },
            { type: "tool_use", id: "t1", name: "files.read", input: { path: ["Workspace"] } },
            { type: "thinking", thinking: "hidden" },
            { type: "tool_use", id: "t2", name: "files.write", input: {} },
          ],
        },
      }),
    ).toEqual([
      { type: "message", text: "looking" },
      { type: "tool_call", callId: "t1", tool: "files.read", arguments: { path: ["Workspace"] } },
      { type: "tool_call", callId: "t2", tool: "files.write", arguments: {} },
    ]);
  });

  it("distinguishes a completed result from a failed one", () => {
    expect(
      claudeCodeProtocol.interpret({ type: "result", subtype: "success", result: "done" }),
    ).toEqual([{ type: "complete", output: { text: "done" } }]);
    expect(
      claudeCodeProtocol.interpret({ type: "result", is_error: true, result: "boom" })[0],
    ).toMatchObject({ type: "failed" });
  });

  it("names why Claude stopped when it wrote no text for the failure", () => {
    expect(
      claudeCodeProtocol.interpret({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: 24,
      }),
    ).toEqual([
      {
        type: "failed",
        error: {
          code: "error_max_turns",
          message: "Claude Code stopped at its turn limit after 24 model turns (error_max_turns).",
          retryable: true,
        },
      },
    ]);
    expect(
      claudeCodeProtocol.interpret({
        type: "result",
        subtype: "error_max_turns",
        is_error: true,
        num_turns: "many",
      })[0],
    ).toMatchObject({
      type: "failed",
      error: { message: "Claude Code stopped at its turn limit (error_max_turns)." },
    });
    expect(
      claudeCodeProtocol.interpret({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
      })[0],
    ).toMatchObject({
      type: "failed",
      error: {
        code: "error_during_execution",
        message: "The Claude Code harness reported a failure (error_during_execution).",
      },
    });
    expect(claudeCodeProtocol.interpret({ type: "result", is_error: true })[0]).toMatchObject({
      type: "failed",
      error: { code: "harness_failed", message: "The Claude Code harness reported a failure." },
    });
  });

  it("marks a refused call so the harness knows it was refused", () => {
    const frame = claudeCodeProtocol.encodeToolResult({
      callId: "t1",
      tool: "files.read",
      status: "denied",
      error: { code: "no_matching_grant", message: "denied" },
      completedAt: NOW,
    });

    expect(frame).toMatchObject({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "t1", is_error: true }] },
    });
  });
});

describe("a harness driven as a SharedOS turn", () => {
  const codexTranscript: HarnessTranscript = {
    batches: [
      [
        {
          type: "function_call",
          call_id: "call-1",
          name: "files.read",
          arguments: '{"path":["Workspace","notes.md"]}',
        },
      ],
      [{ type: "response.completed", response: { output_text: "read it" } }],
    ],
  };

  it("gives a turn the CLI answered in prose that prose as its output", async () => {
    const transport = new TranscriptTransport({ batches: [cliTurn] });
    const { result } = await runWith(createCodexDriver({ transport }));

    expect(result.status).toBe("succeeded");
    expect(result.status === "succeeded" ? result.output : undefined).toEqual({
      text: "Hi! What can I help you with?",
    });
  });

  it("routes every harness tool call through the security envelope", async () => {
    const transport = new TranscriptTransport(codexTranscript);
    const { result, audit } = await runWith(createCodexDriver({ transport }));

    expect(result.status).toBe("succeeded");
    expect(result.status === "succeeded" ? result.output : undefined).toEqual({ text: "read it" });
    expect(audit.events.some(({ type }) => type === "tool.invoked")).toBe(true);
    expect(transport.written).toHaveLength(1);
    expect(transport.written[0]).toMatchObject({ type: "function_call_output" });
  });

  it("hands the harness where the turn may operate, and records what it was told", async () => {
    const transport = new TranscriptTransport(codexTranscript);
    const { result } = await runWith(createCodexDriver({ transport }));

    const opened = transport.opened[0];
    expect(opened?.instructions).toMatch(/\S/u);
    expect(harnessTurnText({ instructions: "where", prompt: "what" })).toBe("where\n\nwhat");
    expect(harnessTurnText({ prompt: "what" })).toBe("what");
    // The same identity a model seat told the same two texts would carry.
    expect(result.metadata?.[PROMPT_HASH_ANNOTATION]).toBe(
      await handedPromptHash(opened?.instructions, opened?.prompt ?? ""),
    );
  });

  it("places a host's standing guidance before the reach, and hands over none when told to", async () => {
    const plain = new TranscriptTransport(codexTranscript);
    await runWith(createCodexDriver({ transport: plain }));
    const guided = new TranscriptTransport(codexTranscript);
    await runWith(createCodexDriver({ transport: guided, instructions: "Read before you write." }));
    expect(guided.opened[0]?.instructions).toBe(
      `Read before you write.\n\n${String(plain.opened[0]?.instructions)}`,
    );

    const silent = new TranscriptTransport(codexTranscript);
    const { result } = await runWith(
      createCodexDriver({ transport: silent, instructions: () => undefined }),
    );
    expect(silent.opened[0]).not.toHaveProperty("instructions");
    expect(result.metadata?.[PROMPT_HASH_ANNOTATION]).toBe(
      await handedPromptHash(undefined, silent.opened[0]?.prompt ?? ""),
    );
  });

  it("shows the harness the sanitised context and nothing else", async () => {
    const transport = new TranscriptTransport(codexTranscript);
    await runWith(createCodexDriver({ transport }));

    expect(Object.keys(transport.opened[0]?.context ?? {}).sort()).toEqual([
      "actor",
      "namespaceId",
      "now",
      "owner",
      "purpose",
      "reach",
      "traceId",
    ]);
    expect(JSON.stringify(transport.opened)).not.toContain("grant-files");
  });

  it("passes an unexposed tool name through instead of filtering it", async () => {
    // The adapter must not enforce. A guess at a tool outside the catalogue has
    // to reach the envelope, or the attempt is erased rather than refused.
    const transport = new TranscriptTransport({
      batches: [
        [{ type: "function_call", call_id: "call-1", name: "admin.grant.issue", arguments: "{}" }],
        [{ type: "response.completed", response: { output_text: "blocked" } }],
      ],
    });
    const { result } = await runWith(createCodexDriver({ transport }));

    expect(result.status).toBe("succeeded");
    const completed = result.events.filter(({ type }) => type === "tool.completed");
    expect(completed[0]?.data).toMatchObject({ status: "denied", tool: "admin.grant.issue" });
    const written = transport.written[0] as { output: string };
    expect(JSON.parse(written.output)).toMatchObject({ status: "denied" });
  });

  it("executes tool calls from one frame one at a time", async () => {
    const transport = new TranscriptTransport({
      batches: [
        [
          {
            type: "assistant",
            message: {
              content: [
                { type: "tool_use", id: "t1", name: "files.read", input: { path: ["Workspace"] } },
                { type: "tool_use", id: "t2", name: "files.read", input: { path: ["Workspace"] } },
              ],
            },
          },
        ],
        [{ type: "result", subtype: "success", result: "done" }],
      ],
    });
    const { result, audit } = await runWith(createClaudeCodeDriver({ transport }));

    expect(result.status).toBe("succeeded");
    // Two calls, two authorization decisions: SharedOS re-authorizes per call,
    // so parallel requests are serialised rather than admitted as a batch.
    expect(audit.events.filter(({ type }) => type === "tool.invoked")).toHaveLength(2);
    expect(transport.written).toHaveLength(2);
  });

  it("files a turn's evidence under the harness that produced it", async () => {
    // The executor stamps the plugin's manifest onto the execution record, and
    // the loop is the same whichever driver is seated, so the runtime reports
    // the seated driver's manifest. A driver that states none is the standard.
    const transport = new TranscriptTransport(codexTranscript);
    const codexDriver = createCodexDriver({ transport });
    const codex = createStandardRuntime({ driver: codexDriver });
    const claude = createStandardRuntime({
      driver: createClaudeCodeDriver({ transport: new TranscriptTransport(codexTranscript) }),
    });

    expect(codex.manifest.id).toBe(CODEX_RUNTIME_MANIFEST.id);
    expect(claude.manifest.id).toBe(CLAUDE_CODE_RUNTIME_MANIFEST.id);
    expect(
      createStandardRuntime({
        driver: { open: (request, signal) => codexDriver.open(request, signal) },
      }).manifest.id,
    ).toBe("sharedos.standard");

    const { kernel } = createTestKernel({ grants: grants() });
    kernel.registerTool({
      definition: READ_TOOL,
      parseArguments: (arguments_) => arguments_,
      invoke: async (context, call) => ({
        callId: call.id,
        tool: call.tool,
        status: "succeeded",
        output: { text: "file body" },
        completedAt: context.now,
      }),
    });
    const result = await new SharedOSExecutor(kernel, codex, { clock: () => NOW }).execute(
      request(),
    );

    expect(result.metadata).toMatchObject({ runtime: { id: "sharedos.codex" } });
  });

  it("fails the turn when the harness stops without an outcome", async () => {
    const transport = new TranscriptTransport({ batches: [[{ type: "system", subtype: "init" }]] });
    const { result } = await runWith(createClaudeCodeDriver({ transport }));

    expect(result.status).toBe("failed");
  });
});

describe("a harness asking for a human", () => {
  const ask = (reason: string): HarnessTranscript => ({
    batches: [
      [
        {
          type: "function_call",
          call_id: "call-1",
          name: "sharedos.escalate",
          arguments: JSON.stringify({ reason }),
        },
      ],
      [{ type: "response.completed", response: { output_text: "asked" } }],
    ],
  });

  it("ends the turn as escalated when the catalogue offers the affordance", async () => {
    const transport = new TranscriptTransport(ask("this needs an owner's decision"));
    const { result, audit } = await runWith(createCodexDriver({ transport }), {
      escalation: true,
    });

    expect(result.status).toBe("escalated");
    expect(result.status === "escalated" ? result.escalation.reason : undefined).toBe(
      "this needs an owner's decision",
    );
    // Terminated on, never forwarded: no call reached the kernel and the
    // handler that fails on sight was not run.
    expect(result.events.filter(({ type }) => type === "tool.requested")).toHaveLength(0);
    expect(audit.events.some(({ type }) => type === "escalation.requested")).toBe(true);
    expect(transport.written).toHaveLength(0);
  });

  it("does not honour the affordance for a turn that was never granted it", async () => {
    const transport = new TranscriptTransport(ask("let me out"));
    const { result, audit } = await runWith(createCodexDriver({ transport }));

    // Ending the turn on the name would skip the envelope's catalogue check,
    // so the driver reads the catalogue first. Without the grant the call is
    // passed through and refused like any other unpublished name, the harness
    // is told so, and the turn ends the way the harness ended it.
    expect(result.status).toBe("succeeded");
    const completed = result.events.filter(({ type }) => type === "tool.completed");
    expect(completed[0]?.data).toMatchObject({
      tool: "sharedos.escalate",
      status: "denied",
      code: "tool_unavailable",
    });
    expect(audit.events.some(({ type }) => type === "escalation.requested")).toBe(false);
    const written = transport.written[0] as { output: string };
    expect(JSON.parse(written.output)).toMatchObject({ status: "denied" });
  });
});

/** Probe `node` standing in for a CLI whose `--version` writes these lines, stderr first. */
function probeAsVersionOutput(said: {
  readonly stdout?: readonly string[];
  readonly stderr?: readonly string[];
}) {
  const script = [
    ...(said.stderr ?? []).map((line) => `console.error(${JSON.stringify(line)});`),
    ...(said.stdout ?? []).map((line) => `console.log(${JSON.stringify(line)});`),
  ].join("");
  return probeHarness(
    { ...CODEX_REQUIREMENTS, executable: "node", versionArguments: ["-e", script] },
    { PATH: process.env["PATH"] ?? "", OPENAI_API_KEY: "test-key" },
  );
}

describe("harness availability", () => {
  it("reports a missing executable rather than failing a run", async () => {
    const availability = await probeHarness(CODEX_REQUIREMENTS, { PATH: "/nonexistent" });

    expect(availability).toMatchObject({ harness: "codex", available: false });
    expect(availability.reason).toMatch(/not on PATH/u);
  });

  it("finds an executable that is present", async () => {
    const availability = await probeHarness(
      { ...CLAUDE_CODE_REQUIREMENTS, executable: "node" },
      { PATH: process.env["PATH"] ?? "", ANTHROPIC_API_KEY: "test-key" },
    );

    expect(availability.available).toBe(true);
    expect(availability.detail).toMatchObject({ credential: "ANTHROPIC_API_KEY" });
  });

  it("records the build that answered, and the line it read that from", async () => {
    // A conformance result about a vendor CLI is a result about one version of
    // it, and only the harness can say which. `node --version` prints `vX.Y.Z`,
    // so this also pins that the token is read out of a line rather than the
    // line being taken for a token.
    const availability = await probeHarness(
      { ...CLAUDE_CODE_REQUIREMENTS, executable: "node" },
      { PATH: process.env["PATH"] ?? "", ANTHROPIC_API_KEY: "test-key" },
    );

    expect(availability.version).toMatch(/^\d+\.\d+\.\d+/u);
    expect(availability.detail?.["versionOutput"]).toContain(availability.version);
  });

  it("reads the version from stdout past a warning that reached stderr first", async () => {
    // What Codex does with `CODEX_HOME` under a temporary directory.
    const availability = await probeAsVersionOutput({
      stderr: [
        'WARNING: proceeding, even though we could not create PATH aliases: Refusing to create helper binaries under temporary dir "/tmp"',
      ],
      stdout: ["codex-cli 0.149.0"],
    });

    expect(availability.version).toBe("0.149.0");
    expect(availability.detail?.["versionOutput"]).toBe("codex-cli 0.149.0");
  });

  it("does not take a notice about a newer build for the build that answered", async () => {
    const notices = [
      "Update available: 0.149.0 -> 0.153.2",
      "A new version of Codex is available: 0.153.2",
      "Run `npm install -g @openai/codex@0.153.2` to update.",
    ];

    for (const notice of notices) {
      const ahead = await probeAsVersionOutput({ stdout: [notice, "codex-cli 0.149.0"] });
      expect(ahead.version).toBe("0.149.0");
      expect(ahead.detail?.["versionOutput"]).toBe("codex-cli 0.149.0");

      const onStderr = await probeAsVersionOutput({ stderr: [notice], stdout: ["0.149.0"] });
      expect(onStderr.version).toBe("0.149.0");

      const alone = await probeAsVersionOutput({ stdout: [notice] });
      expect(alone.available).toBe(true);
      expect(alone.version).toBeUndefined();
      expect(alone.detail?.["versionOutput"]).toBe(notice);
    }
  });

  it("reads the shapes the vendor CLIs answer in, and a version said only on stderr", async () => {
    const shapes: readonly (readonly [string, string])[] = [
      ["codex-cli 0.149.0", "0.149.0"],
      ["2.1.278 (Claude Code)", "2.1.278"],
      ["0.1.1-rc.2", "0.1.1-rc.2"],
      ["v22.14.0", "22.14.0"],
    ];

    for (const [line, version] of shapes) {
      expect((await probeAsVersionOutput({ stdout: [line] })).version).toBe(version);
      expect((await probeAsVersionOutput({ stderr: [line] })).version).toBe(version);
    }
  });

  it("records no version when two lines answer with different builds", async () => {
    const availability = await probeAsVersionOutput({
      stdout: ["latest 0.153.2", "codex-cli 0.149.0"],
    });

    expect(availability.available).toBe(true);
    expect(availability.version).toBeUndefined();
    expect(availability.detail?.["versionOutput"]).toBe("latest 0.153.2");
  });

  it("stays available when the executable will not say what it is", async () => {
    // Not knowing which build ran is worse evidence, never a reason to refuse to
    // run: an unreadable version leaves the field absent and the column open.
    const availability = await probeHarness(
      {
        ...CLAUDE_CODE_REQUIREMENTS,
        executable: "node",
        versionArguments: ["--no-such-flag"],
      },
      { PATH: process.env["PATH"] ?? "", ANTHROPIC_API_KEY: "test-key" },
    );

    expect(availability.available).toBe(true);
    expect(availability.version).toBeUndefined();
    expect(availability.detail).toMatchObject({ credential: "ANTHROPIC_API_KEY" });
  });

  it("requires a credential only when the harness cannot use a stored session", async () => {
    const strict = await probeHarness(
      { ...CODEX_REQUIREMENTS, executable: "node", credentialsOptional: false },
      { PATH: process.env["PATH"] ?? "" },
    );
    const lenient = await probeHarness(
      { ...CODEX_REQUIREMENTS, executable: "node" },
      { PATH: process.env["PATH"] ?? "" },
    );

    expect(strict.available).toBe(false);
    expect(lenient.available).toBe(true);
  });
});

describe("the DeepSeek Harness protocol", () => {
  /** One session-log event as the SDK runtime notification that carries it. */
  function event(type: string, data: JsonObject): JsonObject {
    return {
      jsonrpc: "2.0",
      method: "session.event",
      params: { sessionId: "session-1", event: { type, seq: 1, time: 0, data } },
    };
  }

  it("declares the permission-filtered catalogue as harness tool schemas", () => {
    expect(deepseekProtocol.describeTools([READ_TOOL])).toEqual([
      {
        name: "files.read",
        description: READ_TOOL.description,
        parameters: READ_TOOL.inputSchema,
      },
    ]);
  });

  it("parses a tool call, whose arguments arrive as a JSON string", () => {
    expect(
      deepseekProtocol.interpret(
        event("tool/call", {
          turn: 1,
          step: 1,
          callId: "call-1",
          name: "files.read",
          arguments: '{"path":["Workspace"]}',
        }),
      ),
    ).toEqual([
      {
        type: "tool_call",
        callId: "call-1",
        tool: "files.read",
        arguments: { path: ["Workspace"] },
      },
    ]);
  });

  it("reads a bare session-log envelope the same as a wrapped one", () => {
    // A recorded log holds bare envelopes and a live runtime wraps them. If the
    // two parsed differently, replaying a log would not exercise the live path.
    const data = { turn: 1, step: 1, callId: "call-1", name: "files.read", arguments: "{}" };

    expect(deepseekProtocol.interpret({ type: "tool/call", seq: 1, time: 0, data })).toEqual(
      deepseekProtocol.interpret(event("tool/call", data)),
    );
  });

  it("fails the turn rather than guessing when arguments will not parse", () => {
    const steps = deepseekProtocol.interpret(
      event("tool/call", { callId: "call-1", name: "files.read", arguments: "{not json" }),
    );

    expect(steps[0]).toMatchObject({ type: "failed" });
  });

  it("does not re-issue a call it already read from tool/call", () => {
    // The harness records the same call in its assistant message and in
    // tool/call. Reading both would execute every call twice.
    expect(
      deepseekProtocol.interpret(
        event("assistant/message", {
          turn: 1,
          step: 1,
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "looking" },
              { type: "tool-call", id: "call-1", name: "files.read", arguments: "{}" },
            ],
          },
        }),
      ),
    ).toEqual([{ type: "message", text: "looking" }]);
  });

  it("treats only a completed turn as an outcome", () => {
    expect(
      deepseekProtocol.interpret(event("turn/end", { reason: { kind: "completed" } })),
    ).toEqual([{ type: "complete" }]);
    for (const kind of ["aborted", "blocked", "error", "max-tokens", "interrupted"]) {
      expect(deepseekProtocol.interpret(event("turn/end", { reason: { kind } }))[0]).toMatchObject({
        type: "failed",
      });
    }
  });

  it("marks a refused call so the harness knows it was refused", () => {
    const frame = deepseekProtocol.encodeToolResult({
      callId: "call-1",
      tool: "files.read",
      status: "denied",
      error: { code: "no_matching_grant", message: "denied" },
      completedAt: NOW,
    });

    expect(frame).toMatchObject({
      method: "session/prompt",
      params: {
        contentBlocks: [{ type: "tool-result", toolCallId: "call-1", isError: true }],
      },
    });
  });

  it("ignores frames that carry nothing relevant to the turn", () => {
    expect(deepseekProtocol.interpret(event("step/start", { turn: 1, step: 1 }))).toEqual([]);
    expect(deepseekProtocol.interpret({ jsonrpc: "2.0", id: 1, result: {} })).toEqual([]);
  });
});

describe("the Pi protocol", () => {
  it("declares the permission-filtered catalogue as Pi tool definitions", () => {
    expect(piProtocol.describeTools([READ_TOOL])).toEqual([
      {
        name: "files.read",
        label: "files.read",
        description: READ_TOOL.description,
        parameters: READ_TOOL.inputSchema,
      },
    ]);
  });

  it("reads every content block of one assembled message, in order", () => {
    expect(
      piProtocol.interpret({
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "looking" },
            { type: "toolCall", id: "t1", name: "files.read", arguments: { path: ["Workspace"] } },
            { type: "thinking", thinking: "hidden" },
            { type: "toolCall", id: "t2", name: "files.write", arguments: {} },
          ],
        },
      }),
    ).toEqual([
      { type: "message", text: "looking" },
      { type: "tool_call", callId: "t1", tool: "files.read", arguments: { path: ["Workspace"] } },
      { type: "tool_call", callId: "t2", tool: "files.write", arguments: {} },
    ]);
  });

  it("does not read Pi's own tool execution as a call to make", () => {
    // tool_execution_start announces a tool Pi is already running itself. It is
    // not a request for the host, and reading it as one would both double-issue
    // every call and misreport who executed it.
    expect(
      piProtocol.interpret({
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "files.read",
        args: { path: ["Workspace"] },
      }),
    ).toEqual([]);
  });

  it("waits for a retrying run rather than reporting an outcome it has not reached", () => {
    expect(piProtocol.interpret({ type: "agent_end", willRetry: true })).toEqual([]);
    expect(piProtocol.interpret({ type: "agent_end", willRetry: false })).toEqual([
      { type: "complete" },
    ]);
  });

  it("fails the turn when the harness rejects the command outright", () => {
    expect(
      piProtocol.interpret({
        type: "response",
        command: "prompt",
        success: false,
        error: "no model configured",
      })[0],
    ).toMatchObject({ type: "failed", error: { message: "no model configured" } });
    expect(piProtocol.interpret({ type: "response", command: "prompt", success: true })).toEqual(
      [],
    );
  });

  it("marks a refused call so the harness knows it was refused", () => {
    const frame = piProtocol.encodeToolResult({
      callId: "t1",
      tool: "files.read",
      status: "denied",
      error: { code: "no_matching_grant", message: "denied" },
      completedAt: NOW,
    });

    expect(frame).toMatchObject({
      role: "toolResult",
      toolCallId: "t1",
      toolName: "files.read",
      isError: true,
    });
  });
});

describe("the DeepSeek and Pi harnesses driven as SharedOS turns", () => {
  const cases = [
    {
      label: "DeepSeek",
      writer: deepseekFrameWriter,
      driver: createDeepseekDriver,
      manifest: DEEPSEEK_RUNTIME_MANIFEST,
    },
    {
      label: "Pi",
      writer: piFrameWriter,
      driver: createPiDriver,
      manifest: PI_RUNTIME_MANIFEST,
    },
  ] as const;

  for (const harness of cases) {
    it(`routes every ${harness.label} tool call through the security envelope`, async () => {
      const transport = new TranscriptTransport({
        batches: [
          [harness.writer.toolCall("call-1", "files.read", { path: ["Workspace", "notes.md"] })],
          [harness.writer.message("read it"), harness.writer.complete()],
        ],
      });
      const { result, audit } = await runWith(harness.driver({ transport }));

      expect(result.status).toBe("succeeded");
      expect(audit.events.some(({ type }) => type === "tool.invoked")).toBe(true);
      expect(transport.written).toHaveLength(1);
    });

    it(`passes an unexposed tool name through instead of filtering it (${harness.label})`, async () => {
      const transport = new TranscriptTransport({
        batches: [
          [harness.writer.toolCall("call-1", "admin.grant.issue", {})],
          [harness.writer.complete()],
        ],
      });
      const { result } = await runWith(harness.driver({ transport }));

      expect(result.status).toBe("succeeded");
      const completed = result.events.filter(({ type }) => type === "tool.completed");
      expect(completed[0]?.data).toMatchObject({ status: "denied", tool: "admin.grant.issue" });
    });

    it(`files a ${harness.label} turn's evidence under the harness that produced it`, () => {
      const transport = new TranscriptTransport({ batches: [[harness.writer.complete()]] });

      expect(createStandardRuntime({ driver: harness.driver({ transport }) }).manifest.id).toBe(
        harness.manifest.id,
      );
    });

    it(`shows the ${harness.label} harness the sanitised context and nothing else`, async () => {
      const transport = new TranscriptTransport({ batches: [[harness.writer.complete()]] });
      await runWith(harness.driver({ transport }));

      expect(Object.keys(transport.opened[0]?.context ?? {}).sort()).toEqual([
        "actor",
        "namespaceId",
        "now",
        "owner",
        "purpose",
        "reach",
        "traceId",
      ]);
      expect(JSON.stringify(transport.opened)).not.toContain("grant-files");
    });

    it(`declares that the ${harness.label} catalogue is delivered out of band`, () => {
      // Neither harness has a wire frame for a tool catalogue: both run their
      // own tools. The claim a column makes is narrower as a result, so the
      // record says so rather than leaving it to be inferred.
      expect(harness.manifest.metadata).toMatchObject({ catalogueDelivery: "out-of-band" });
    });
  }

  it("pairs each writer with the protocol that reads it", () => {
    expect(deepseekFrameWriter.protocolId).toBe(deepseekProtocol.id);
    expect(piFrameWriter.protocolId).toBe(piProtocol.id);
  });

  it("reports a missing harness rather than failing a run", async () => {
    for (const requirements of [DEEPSEEK_REQUIREMENTS, PI_REQUIREMENTS]) {
      const availability = await probeHarness(requirements, { PATH: "/nonexistent" });

      expect(availability).toMatchObject({ harness: requirements.harness, available: false });
      expect(availability.reason).toMatch(/not on PATH/u);
    }
  });
});
