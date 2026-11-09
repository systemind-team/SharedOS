import { describe, expect, it } from "vitest";

import type { HarnessTurnRequest } from "./harness.js";
import { ChildProcessTransport } from "./node.js";
import { HarnessProcess } from "./process.js";

const TURN = {
  executionId: "exec-1",
  prompt: "read the notes",
  tools: [],
  context: {},
} as unknown as HarnessTurnRequest;

/** A child that runs one inline script, so no fixture file has to be found at run time. */
function node(script: string): { readonly command: string; readonly args: readonly string[] } {
  return { command: process.execPath, args: ["-e", script] };
}

/** Outlives any test here, and still exits by itself if nothing ends it. */
const WAITS = "setTimeout(() => undefined, 20_000)";

describe("the harness process runner", () => {
  it("reads frames in order and keeps what is not a frame for diagnosis", async () => {
    const frames: unknown[] = [];
    const diagnostics: [string, string][] = [];
    const harness = new HarnessProcess(
      node(`
        console.log("Starting up...");
        console.log(JSON.stringify({ type: "one" }));
        console.log("   ");
        console.log("[1, 2]");
        console.error("warn: slow");
        console.log(JSON.stringify({ type: "two" }));
      `),
      {
        onFrame: (frame) => frames.push(frame),
        onDiagnostic: (text, stream) => diagnostics.push([stream, text]),
      },
    );

    expect(await harness.exited).toEqual({ code: 0 });
    harness.dispose();
    // A banner is diagnosis, a blank line is nothing, and JSON that is not an
    // object is neither a frame nor worth reporting.
    expect(frames).toEqual([{ type: "one" }, { type: "two" }]);
    expect(diagnostics).toContainEqual(["stdout", "Starting up..."]);
    expect(diagnostics).toContainEqual(["stderr", "warn: slow"]);
    expect(diagnostics).toHaveLength(2);
  });

  it("reads stderr by the line, joining a line the pipe delivered in pieces", async () => {
    const diagnostics: string[] = [];
    const harness = new HarnessProcess(
      node(`
        process.stderr.write("mcp-sharedos (@deepseek-ai/dsh-mcp-client): Er");
        setTimeout(() => process.stderr.write("ror: failed\\n\\nsecond line\\n  third"), 50);
      `),
      { onFrame: () => undefined, onDiagnostic: (text) => diagnostics.push(text) },
    );

    expect(await harness.exited).toEqual({ code: 0 });
    harness.dispose();
    expect(diagnostics).toEqual([
      "mcp-sharedos (@deepseek-ai/dsh-mcp-client): Error: failed",
      "second line",
      "  third",
    ]);
  });

  it("reports a command that cannot be started as an exit, not a throw", async () => {
    const harness = new HarnessProcess(
      { command: "sharedos-no-such-harness" },
      { onFrame: () => undefined },
    );
    const exit = await harness.exited;
    expect(exit.code).toBeNull();
    expect(exit.error).toBeInstanceOf(Error);
    harness.dispose();
  });

  it("ends the process when the turn's signal aborts", async () => {
    const abort = new AbortController();
    const harness = new HarnessProcess(node(WAITS), { onFrame: () => undefined }, abort.signal);
    abort.abort(new Error("deadline"));
    const exit = await harness.exited;
    expect(exit.code).not.toBe(0);
    harness.dispose();
  });

  it("ends a child that is still running when it is disposed", async () => {
    // Closing stdin is not enough for a harness that does not read it.
    const harness = new HarnessProcess(node(WAITS), { onFrame: () => undefined });
    harness.dispose();
    expect((await harness.exited).code).not.toBe(0);
  });

  it("refuses to start under a signal that has already aborted", () => {
    const abort = new AbortController();
    abort.abort(new Error("cancelled"));
    expect(() => new HarnessProcess(node("1"), { onFrame: () => undefined }, abort.signal)).toThrow(
      "cancelled",
    );
  });
});

describe("the stdio transport over the runner", () => {
  const ECHO = `
    const lines = require("node:readline").createInterface({ input: process.stdin });
    lines.on("line", (line) => console.log(JSON.stringify({ type: "echo", of: JSON.parse(line) })));
  `;

  it("writes the opening frames, then hands back what the harness answers", async () => {
    const seen: string[] = [];
    const transport = new ChildProcessTransport({
      ...node(`console.error("ready");${ECHO}`),
      openingFrame: (request) => [{ type: "hello" }, { type: "prompt", text: request.prompt }],
      onDiagnostic: (line) => seen.push(line),
    });
    const signal = new AbortController().signal;
    const channel = await transport.open(TURN, signal);

    expect(await channel.read(signal)).toEqual({ type: "echo", of: { type: "hello" } });
    expect(await channel.read(signal)).toEqual({
      type: "echo",
      of: { type: "prompt", text: "read the notes" },
    });
    await channel.write({ type: "tool_result" }, signal);
    expect(await channel.read(signal)).toEqual({ type: "echo", of: { type: "tool_result" } });
    expect(seen).toEqual(["ready"]);

    // Closing ends a harness that is still running, and a read after that is
    // the end of frames rather than a hang.
    await channel.close();
    expect(await channel.read(signal)).toBeUndefined();
  });

  it("reads the end of frames when the harness exits without an outcome", async () => {
    const transport = new ChildProcessTransport(node(`console.log('{"type":"only"}')`));
    const signal = new AbortController().signal;
    const channel = await transport.open(TURN, signal);
    expect(await channel.read(signal)).toEqual({ type: "only" });
    expect(await channel.read(signal)).toBeUndefined();
    await channel.close();
  });

  it("rejects a pending read, and ends the harness, when the turn aborts", async () => {
    const abort = new AbortController();
    const transport = new ChildProcessTransport(node(WAITS));
    const channel = await transport.open(TURN, abort.signal);
    const pending = channel.read(abort.signal);
    abort.abort(new Error("deadline"));
    await expect(pending).rejects.toThrow("deadline");
    await channel.close();
  });
});
