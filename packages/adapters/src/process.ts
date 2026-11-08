import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import type { HarnessFrame } from "./harness.js";

/** How a harness process is started. */
export interface HarnessProcessLaunch {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  /** Merged over the ambient environment. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface HarnessProcessHandlers {
  /** One JSON object the harness wrote on a line of its stdout. */
  readonly onFrame: (frame: HarnessFrame) => void;
  /**
   * What the harness said beside its protocol: a stdout line that is not JSON,
   * or a line of stderr. Harnesses print banners next to their frames, so a
   * line that is not a frame is not an error; it is kept for diagnosis. stderr
   * is read by the line, as stdout is, so a reader looking for one line of it
   * sees that line whole however the pipe split it.
   */
  readonly onDiagnostic?: (text: string, stream: "stdout" | "stderr") => void;
  /** The harness has closed its stdout: no further frame will arrive. */
  readonly onOutputEnd?: () => void;
}

/** How a harness process ended: its exit code, or the error that kept it from starting. */
export interface HarnessProcessExit {
  readonly code: number | null;
  readonly error?: Error;
}

/**
 * A harness reached as a subprocess speaking JSON lines.
 *
 * The one runner under both ways a vendor CLI is seated: the stdio transport an
 * evaluation driver reads frames from, and the MCP harness runtime, where the
 * CLI's tool calls leave over MCP and its stdout is read for the turn's ending.
 * They frame, diagnose and stop a child the same way, and this is that way.
 *
 * It is abort-aware: the turn's signal ends the process, so a harness never
 * outlives a turn that was cancelled or reached its deadline. The signal is the
 * envelope's hard one. A turn that is draining does not signal its harness; the
 * harness reads the refusal of its next call and ends on its own.
 *
 * Node only.
 */
export class HarnessProcess {
  readonly #child: ChildProcessWithoutNullStreams;
  readonly #lines: Interface;
  readonly #errors: Interface;
  readonly #signal: AbortSignal | undefined;
  readonly #onAbort = (): void => this.kill();
  /** Resolves once, when the process has closed or failed to start. */
  readonly exited: Promise<HarnessProcessExit>;

  constructor(
    launch: HarnessProcessLaunch,
    handlers: HarnessProcessHandlers,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    this.#signal = signal;
    this.#child = spawn(launch.command, [...(launch.args ?? [])], {
      ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
      env: { ...process.env, ...launch.env },
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
    signal?.addEventListener("abort", this.#onAbort, { once: true });

    this.exited = new Promise<HarnessProcessExit>((resolve) => {
      this.#child.once("error", (error: Error) => resolve({ code: null, error }));
      this.#child.once("close", (code) => resolve({ code }));
    });
    // A harness that exits early closes its stdin under a pending write. The
    // write's own callback reports that; without a listener it would be an
    // unhandled stream error.
    this.#child.stdin.on("error", () => undefined);

    this.#lines = createInterface({ input: this.#child.stdout });
    this.#lines.on("line", (line) => {
      const trimmed = line.trim();
      if (trimmed === "") {
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        handlers.onDiagnostic?.(trimmed, "stdout");
        return;
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return;
      }
      handlers.onFrame(parsed as HarnessFrame);
    });

    this.#lines.on("close", () => handlers.onOutputEnd?.());

    this.#errors = createInterface({ input: this.#child.stderr });
    this.#errors.on("line", (line) => {
      const trimmed = line.trimEnd();
      if (trimmed.trim() !== "") {
        handlers.onDiagnostic?.(trimmed, "stderr");
      }
    });
  }

  get inputEnded(): boolean {
    return this.#child.stdin.writableEnded;
  }

  /** Write text to the harness's stdin, as given. */
  write(text: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#child.stdin.write(text, (error) =>
        error === null || error === undefined ? resolve() : reject(error),
      );
    });
  }

  /** Close stdin, which is how a one-shot harness is told its input is complete. */
  endInput(): void {
    if (!this.#child.stdin.writableEnded) {
      this.#child.stdin.end();
    }
  }

  kill(): void {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill("SIGTERM");
    }
  }

  /** Stop reading, close stdin and end the process if it is still running. */
  dispose(): void {
    this.#signal?.removeEventListener("abort", this.#onAbort);
    this.#lines.close();
    this.#errors.close();
    this.endInput();
    this.kill();
  }
}
