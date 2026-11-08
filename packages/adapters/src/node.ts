import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type {
  HarnessAvailability,
  HarnessChannel,
  HarnessFrame,
  HarnessRequirements,
  HarnessTransport,
  HarnessTurnRequest,
} from "./harness.js";

import { HarnessProcess } from "./process.js";
import {
  CLAUDE_CODE_REQUIREMENTS,
  CODEX_REQUIREMENTS,
  DEEPSEEK_REQUIREMENTS,
  PI_REQUIREMENTS,
} from "./vendors.js";

export * from "./mcp-runtime.js";

export interface ChildProcessTransportOptions {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Kept for diagnosis: the harness's stderr and the stdout lines that are not frames. */
  readonly onDiagnostic?: (line: string) => void;
  /**
   * Builds the opening frames written to the harness's stdin.
   *
   * The turn's prompt, tool catalogue, and sanitised context all arrive through
   * here, so a vendor whose CLI takes them as arguments instead supplies its own
   * `args` and returns `undefined`.
   *
   * Several frames may be returned, in order, for a harness that needs a
   * handshake before it will accept a prompt. DeepSeek Harness is one: its
   * JSON-RPC runtime answers `initialize` before any `session/prompt`, and a
   * transport that could only write one frame would have to fold the handshake
   * into the protocol, where it does not belong.
   */
  readonly openingFrame?: (
    request: HarnessTurnRequest,
  ) => HarnessFrame | readonly HarnessFrame[] | undefined;
}

/**
 * A harness reached as a subprocess speaking JSON lines on stdin and stdout.
 *
 * Both Codex and Claude Code expose exactly this: a long-running process, one
 * JSON object per line each way. Keeping it separate from the protocol means an
 * adapter can be exercised against a supplied transcript and then run live
 * without any change to the translation code that was tested.
 *
 * Node only. It is published from `@aicoo/sharedos-adapters/node` so the main
 * entry point stays host-neutral.
 */
export class ChildProcessTransport implements HarnessTransport {
  readonly #options: ChildProcessTransportOptions;

  constructor(options: ChildProcessTransportOptions) {
    this.#options = options;
  }

  async open(request: HarnessTurnRequest, signal: AbortSignal): Promise<HarnessChannel> {
    const channel = new ChildProcessChannel(this.#options, signal);
    const opening = this.#options.openingFrame?.(request);
    for (const frame of opening === undefined ? [] : toFrames(opening)) {
      await channel.write(frame);
    }
    return channel;
  }
}

function toFrames(opening: HarnessFrame | readonly HarnessFrame[]): readonly HarnessFrame[] {
  return Array.isArray(opening) ? opening : [opening as HarnessFrame];
}

/** The pull side of {@link HarnessProcess}: frames buffered until the driver reads them. */
class ChildProcessChannel implements HarnessChannel {
  readonly #process: HarnessProcess;
  readonly #buffered: HarnessFrame[] = [];
  readonly #waiting: ((frame: HarnessFrame | undefined) => void)[] = [];
  #ended = false;

  constructor(options: ChildProcessTransportOptions, signal: AbortSignal) {
    this.#process = new HarnessProcess(
      options,
      {
        onFrame: (frame) => this.#push(frame),
        // A harness that dies mid-turn must surface as a failed turn, never as
        // a silent completion: the driver reads the end of frames as that.
        onOutputEnd: () => this.#end(),
        ...(options.onDiagnostic === undefined
          ? {}
          : { onDiagnostic: (text: string) => options.onDiagnostic?.(text) }),
      },
      signal,
    );
    void this.#process.exited.then(() => this.#end());
  }

  async read(signal: AbortSignal): Promise<HarnessFrame | undefined> {
    const buffered = this.#buffered.shift();
    if (buffered !== undefined) {
      return buffered;
    }
    if (this.#ended) {
      return undefined;
    }
    return new Promise<HarnessFrame | undefined>((resolve, reject) => {
      const onAbort = (): void => reject(signal.reason ?? new Error("turn aborted"));
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push((frame) => {
        signal.removeEventListener("abort", onAbort);
        resolve(frame);
      });
    });
  }

  write(frame: HarnessFrame): Promise<void> {
    return this.#process.write(`${JSON.stringify(frame)}\n`);
  }

  async close(): Promise<void> {
    this.#process.dispose();
    this.#end();
    await Promise.resolve();
  }

  #push(frame: HarnessFrame): void {
    const waiting = this.#waiting.shift();
    if (waiting === undefined) {
      this.#buffered.push(frame);
    } else {
      waiting(frame);
    }
  }

  #end(): void {
    if (this.#ended) {
      return;
    }
    this.#ended = true;
    while (this.#waiting.length > 0) {
      this.#waiting.shift()?.(undefined);
    }
  }
}

/**
 * Whether a harness can be run here.
 *
 * The conformance suite calls this before opening a column, so a missing CLI is
 * reported as a column that was not exercised rather than as a failing one. An
 * absent harness is not evidence about SharedOS.
 */
export async function probeHarness(
  requirements: HarnessRequirements,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<HarnessAvailability> {
  const executable = await findExecutable(requirements.executable, environment["PATH"]);
  if (executable === undefined) {
    return {
      harness: requirements.harness,
      available: false,
      reason: `The ${requirements.executable} executable is not on PATH.`,
    };
  }

  const credential = requirements.credentialVariables.find(
    (name) => (environment[name] ?? "") !== "",
  );
  if (credential === undefined && !requirements.credentialsOptional) {
    return {
      harness: requirements.harness,
      available: false,
      reason: `None of ${requirements.credentialVariables.join(", ")} is set.`,
      detail: { executable },
    };
  }

  const reported = await reportedVersion(executable, requirements, environment);

  return {
    harness: requirements.harness,
    available: true,
    ...(reported.version === undefined ? {} : { version: reported.version }),
    detail: {
      executable,
      credential: credential ?? "none; relying on a stored session",
      ...(reported.output === undefined ? {} : { versionOutput: reported.output }),
    },
  };
}

/**
 * Ask the executable what build it is, and record what it said.
 *
 * A conformance result about a vendor CLI is a result about one version of it,
 * and until this ran the version was recorded nowhere: a reader had to take it
 * from whatever a runbook said had been installed, which is a claim about an
 * intention rather than about the binary that answered. Only the harness can
 * answer this: SharedOS neither installs nor pins it.
 *
 * Fails open in every direction. A CLI that has no version flag, prints
 * something unrecognisable, or exits non-zero leaves the field absent and the
 * harness available: not knowing which build ran is worse evidence, never a
 * reason to refuse to run. SharedOS sets no time limit on the answer, so a CLI
 * that never answers holds the probe until it does. Both halves are kept: the
 * parsed token because a table wants one, the line it came from because a token
 * nobody can check against the output is the same unverifiable claim in a new
 * place.
 *
 * stdout is read before stderr: Codex warns on stderr ahead of its answer.
 */
async function reportedVersion(
  executable: string,
  requirements: HarnessRequirements,
  environment: Readonly<Record<string, string | undefined>>,
): Promise<{ readonly version?: string; readonly output?: string }> {
  const streams = await new Promise<VersionProbeOutput | undefined>((resolve) => {
    const child = spawnVersionProbe(
      executable,
      [...(requirements.versionArguments ?? ["--version"])],
      environment,
    );
    if (child === undefined) {
      resolve(undefined);
      return;
    }

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", () => {
      resolve(undefined);
    });
    child.on("close", (code) => {
      resolve(code === 0 ? { stdout, stderr } : undefined);
    });
  });
  if (streams === undefined) {
    return {};
  }

  // Some CLIs answer on stderr.
  const answer = versionLine(streams.stdout) ?? versionLine(streams.stderr);
  if (answer !== undefined) {
    return answer;
  }
  const said = firstLine(streams.stdout) ?? firstLine(streams.stderr);
  return said === undefined ? {} : { output: said };
}

interface VersionProbeOutput {
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * A whole line that is a version answer: `codex-cli 0.149.0`,
 * `2.1.278 (Claude Code)`, `v22.14.0`. Anchored so an update notice
 * (`Update available: 0.149.0 -> 0.153.2`) is never read as the build that ran.
 */
const VERSION_LINE = /^(?:[\w@/.-]+\s+)?v?(\d+\.\d+\.\d+(?:[-+][\w.+-]+)?)(?:\s+\([^()]*\))?$/u;

function versionLine(
  text: string,
): { readonly version: string; readonly output: string } | undefined {
  const answers = nonEmptyLines(text).flatMap((line) => {
    const version = VERSION_LINE.exec(line)?.[1];
    return version === undefined ? [] : [{ version, output: line }];
  });
  // Answers naming different builds are no answer.
  const [first] = answers;
  return answers.every(({ version }) => version === first?.version) ? first : undefined;
}

function firstLine(text: string): string | undefined {
  return nonEmptyLines(text)[0];
}

function nonEmptyLines(text: string): readonly string[] {
  return text
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

function spawnVersionProbe(
  command: string,
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
) {
  try {
    return spawn(command, [...args], {
      env: { ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // A missing or non-executable file arrives as an `error` event rather than a
    // throw; this catches only a malformed invocation, which is still not a
    // reason to report the harness unavailable.
    return undefined;
  }
}

export function probeCodex(
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<HarnessAvailability> {
  return probeHarness(CODEX_REQUIREMENTS, environment);
}

export function probeClaudeCode(
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<HarnessAvailability> {
  return probeHarness(CLAUDE_CODE_REQUIREMENTS, environment);
}

export function probeDeepseek(
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<HarnessAvailability> {
  return probeHarness(DEEPSEEK_REQUIREMENTS, environment);
}

export function probePi(
  environment?: Readonly<Record<string, string | undefined>>,
): Promise<HarnessAvailability> {
  return probeHarness(PI_REQUIREMENTS, environment);
}

async function findExecutable(name: string, path: string | undefined): Promise<string | undefined> {
  for (const directory of (path ?? "").split(delimiter).filter((entry) => entry !== "")) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}
