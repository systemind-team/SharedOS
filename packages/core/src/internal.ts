import type {
  Address,
  CapabilityGrant,
  JsonObject,
  JsonValue,
  ProtocolError,
  ToolCall,
  ToolResult,
} from "@aicoo/sharedos-contracts";

import {
  type ProviderErrorContext,
  type ProviderErrorReporter,
  reportContainedError,
} from "./diagnostics.js";

/** Structural JSON equality for protocol values with unordered object keys. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

/**
 * A tool parser's return value, as `JsonObjectSchema` would have returned it.
 *
 * The verdict is the schema's, rule for rule, and so is the value. A number
 * is kept only when finite; `undefined`, a bigint, a symbol and a function
 * are refused wherever they sit; a Date, a Map, a Set and a thenable are
 * refused where an object was expected, and every other object is read as a
 * record -- the keys `for...in` reaches, inherited ones included, into a
 * fresh plain object with a `"__proto__"` key dropped at every depth, its
 * value still checked. An array is rebuilt element by element, so a hole is
 * refused as the `undefined` it reads as. Containers are always copied, as
 * the schema always copied them, so what comes back is plain whatever the
 * parser handed over.
 *
 * The schema reached the same answer by trying every branch of the value
 * union at every node, which cost some twenty-five times the clone that
 * follows.
 */
export function readJsonObject(value: unknown): JsonObject | undefined {
  if (!isRecordLike(value)) {
    return undefined;
  }
  const read = readJsonValue(value, false);
  return read === REFUSED ? undefined : (read as JsonObject);
}

/**
 * A JSON text, as `JsonObjectSchema` would have read what `JSON.parse` made
 * of it: text that is not JSON, or whose top level is not an object, is
 * refused as `undefined`.
 *
 * The parser's grammar already guarantees strings, booleans, `null`, arrays
 * and plain objects with own keys only, so the same walk as
 * {@link readJsonObject} runs here in its copy-on-write mode: it checks the
 * two places where the parser's output and the schema's verdict part -- a
 * number literal too large for a double comes back as an infinity, which the
 * schema refuses because it cannot round-trip, and a `"__proto__"` key comes
 * back as an own property, which the schema drops at every depth -- and hands
 * the parsed value back as it is when nothing had to be dropped, copying only
 * the containers on the path to a dropped key.
 */
export function parseJsonObject(text: string): JsonObject | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const read = readJsonValue(value, true);
  return read === REFUSED ? undefined : (read as JsonObject);
}

const REFUSED: unique symbol = Symbol("refused");

/** The objects the schema reads as records: what is left once its own types are named. */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { then?: unknown; catch?: unknown };
  if (typeof candidate.then === "function" && typeof candidate.catch === "function") {
    return false;
  }
  return !(value instanceof Map || value instanceof Set || value instanceof Date);
}

/**
 * One walk, two modes. With `fresh` false the value is whatever a parser
 * returned: every container is copied and a record's keys are the ones
 * `for...in` reaches. With `fresh` true the value is `JSON.parse` output:
 * containers are plain and keys are own, so a container is handed back as it
 * is unless something beneath it had to be dropped or replaced.
 */
function readJsonValue(value: unknown, fresh: boolean): JsonValue | typeof REFUSED {
  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : REFUSED;
    case "object":
      break;
    default:
      return REFUSED;
  }
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    let copy: JsonValue[] | undefined = fresh ? undefined : [];
    for (let index = 0; index < value.length; index += 1) {
      const item = readJsonValue(value[index], fresh);
      if (item === REFUSED) {
        return REFUSED;
      }
      if (copy !== undefined) {
        copy.push(item);
      } else if (item !== value[index]) {
        copy = value.slice(0, index) as JsonValue[];
        copy.push(item);
      }
    }
    return copy ?? (value as JsonValue[]);
  }
  if (!isRecordLike(value)) {
    return REFUSED;
  }
  const keys = fresh ? Object.keys(value) : enumerableKeys(value);
  let copy: JsonObject | undefined = fresh ? undefined : {};
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    const item = readJsonValue(value[key], fresh);
    if (item === REFUSED) {
      return REFUSED;
    }
    if (key === "__proto__") {
      copy ??= copyKeys(value, keys, index);
    } else if (copy !== undefined) {
      copy[key] = item;
    } else if (item !== value[key]) {
      copy = copyKeys(value, keys, index);
      copy[key] = item;
    }
  }
  return copy ?? (value as JsonObject);
}

/** The keys `for...in` reaches: own and inherited enumerable, in that order. */
function enumerableKeys(record: Record<string, unknown>): string[] {
  const keys: string[] = [];
  for (const key in record) {
    keys.push(key);
  }
  return keys;
}

/** The first `count` keys of a record the walk has already accepted as they are. */
function copyKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  count: number,
): JsonObject {
  const copy: JsonObject = {};
  for (let index = 0; index < count; index += 1) {
    const key = keys[index] as string;
    copy[key] = record[key] as JsonValue;
  }
  return copy;
}

/** Freeze a protocol value and everything reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

/** A protocol error in the one shape every refusal and failure carries. */
export function protocolError(code: string, message: string, retryable = false): ProtocolError {
  return { code, message, retryable };
}

/**
 * Hand one contained throw to a host's diagnostic sink.
 *
 * The one place a `ProviderErrorContext` is assembled. A call site contributes
 * what is specific to it -- what kind of port failed, the code returned in its
 * place, whichever identifiers that path has -- and the trace and namespace
 * come from the trusted context, which always knows them. The kernel and the
 * authorizer both report through here, so the two hooks a host may install
 * receive one shape built one way.
 */
export function reportProviderError(
  report: ProviderErrorReporter | undefined,
  error: unknown,
  context: { readonly traceId: string; readonly namespaceId: string },
  operation: Omit<ProviderErrorContext, "traceId" | "namespaceId">,
): void {
  reportContainedError(report, error, {
    ...operation,
    traceId: context.traceId,
    namespaceId: context.namespaceId,
  });
}

/**
 * A tool call answered without its handler's result: refused, or failed closed.
 *
 * One factory for the kernel, the message tool and the execution envelope, so
 * the three boundaries that answer in a handler's place answer in one shape.
 * The status is an argument rather than a function each: `denied` and `failed`
 * differ in nothing else.
 */
export function refusedToolResult(
  call: Pick<ToolCall, "id" | "tool">,
  status: "denied" | "failed",
  completedAt: string,
  code: string,
  message: string,
): ToolResult {
  return {
    callId: call.id,
    tool: call.tool,
    status,
    completedAt,
    error: protocolError(code, message),
  };
}

/** Drop absent keys, so an optional field never reaches the wire as `undefined`. */
export function compactObject(values: Readonly<Record<string, JsonValue | undefined>>): JsonObject {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined),
  );
}

/**
 * Await `work`, but stop waiting if `signal` aborts.
 *
 * For work one caller shares with others: the caller that gives up rejects
 * with its own reason and leaves the work running for whoever else is still
 * waiting on it, instead of taking their answer with it.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return work;
  }
  return new Promise<T>((resolve, reject) => {
    const abandon = (): void => {
      reject(signal.reason ?? new Error("operation aborted"));
    };
    if (signal.aborted) {
      abandon();
      return;
    }
    signal.addEventListener("abort", abandon, { once: true });
    void work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abandon);
    });
  });
}

/** The longest delay one `setTimeout` keeps; a longer one fires at once. */
const TIMER_CEILING_MS = 2_147_483_647;

/**
 * Run `fire` after `ms`, however long that is, and return what cancels it.
 *
 * A host may set a wait longer than one timer can hold (about 24.8 days), and
 * SharedOS sets no ceiling of its own, so a longer delay is waited out in
 * steps instead of being cut short. With `unref`, the wait does not by itself
 * keep a Node process running.
 */
export function after(
  ms: number,
  fire: () => void,
  options: { readonly unref?: boolean } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (remaining: number): void => {
    const wait = Math.min(remaining, TIMER_CEILING_MS);
    timer = setTimeout(() => {
      if (remaining > wait) {
        arm(remaining - wait);
      } else {
        fire();
      }
    }, wait);
    if (options.unref === true) {
      // Node's timers have `unref`; a browser's are plain numbers.
      (timer as { unref?: () => void }).unref?.();
    }
  };
  arm(ms);
  return (): void => clearTimeout(timer);
}

export function addressesEqual(left: Address, right: Address): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

export function pathIsWithin(parent: readonly string[], candidate: readonly string[]): boolean {
  return (
    parent.length <= candidate.length &&
    parent.every((segment, index) => segment === candidate[index])
  );
}

/**
 * The two instants one grant is judged against.
 *
 * They differ because the removals that can end a grant do not all become
 * observable at the same moment. See {@link grantIsActive}.
 */
export interface GrantInstants {
  /**
   * The instant the turn's authority was resolved.
   *
   * What the turn was admitted with. Everything that would *add* authority is
   * judged here, so a turn can never gain authority it was not admitted with.
   */
  readonly admittedAt: number;
  /**
   * The instant of the operation being authorized.
   *
   * Equal to {@link admittedAt} for a caller that names no separate operation
   * instant, which is what a kernel call outside any turn is.
   */
  readonly now: number;
}

/**
 * Time, revocation, and purpose eligibility for one grant considered alone.
 *
 * Every way a grant leaves an actor's authority funnels through here: not yet
 * active, expired, revoked, or withdrawn from the requested purpose. That makes
 * this the single point where "when is a removal observed?" is decided, and
 * there are two answers rather than one.
 *
 * Expiry is observed at the *operation* instant. It is a property the grant
 * already carried when the turn began, so refusing it part-way through costs no
 * store read and leaks no store state -- the grant set the turn holds already
 * says when its own authority ends, and honouring that needs nothing but a
 * clock.
 *
 * Everything else is observed at the instant the turn's authority was resolved.
 * Revocation and purpose withdrawal are store-side edits, invisible without
 * re-reading the store, and `SharedOSKernel` freezes a resolved authority for
 * the whole turn -- so they are observed by the *next* turn. `issuedAt` and
 * `notBefore` are frozen for the opposite reason: they would *widen* authority
 * mid-turn, and a request must carry the authority it was admitted with rather
 * than acquire more while it runs.
 *
 * The split is therefore directional, not a matter of where the fact came from:
 * the operation's clock may only take authority away. See ADR 0016 for the
 * decision and ADR 0010 for the turn boundary it narrows.
 *
 * An unparsable declared timestamp is treated as inactive so a malformed grant
 * can never outlive a well-formed one.
 */
export function grantIsActive(grant: CapabilityGrant, purpose: string, at: GrantInstants): boolean {
  return grantInactiveReason(grant, purpose, at) === undefined;
}

/**
 * Which of the two activity conditions a grant failed, for the host-facing
 * explanation. `grantIsActive` is this function's only other caller, so the
 * decision and the account of it can never disagree.
 */
export function grantInactiveReason(
  grant: CapabilityGrant,
  purpose: string,
  at: GrantInstants,
): "window" | "purpose" | undefined {
  const issuedAt = parseTimestamp(grant.issuedAt);
  const notBefore = parseTimestamp(grant.constraints.notBefore);
  const expiresAt = parseTimestamp(grant.constraints.expiresAt);
  const revokedAt = parseTimestamp(grant.revokedAt);
  // The later of the two instants, which is normally the operation's. Taking
  // the maximum rather than the operation instant alone means a host whose
  // clock runs backwards cannot revive an expired grant by presenting an
  // earlier instant than the one its turn was admitted at.
  const expiryObservedAt = Math.max(at.admittedAt, at.now);

  if (
    issuedAt === undefined ||
    issuedAt > at.admittedAt ||
    (grant.constraints.notBefore !== undefined && notBefore === undefined) ||
    (notBefore !== undefined && at.admittedAt < notBefore) ||
    (grant.constraints.expiresAt !== undefined && expiresAt === undefined) ||
    (expiresAt !== undefined && expiryObservedAt >= expiresAt) ||
    (grant.revokedAt !== undefined && revokedAt === undefined) ||
    (revokedAt !== undefined && at.admittedAt >= revokedAt)
  ) {
    return "window";
  }

  const purposes = grant.constraints.purposes;
  return purposes === undefined || purposes.includes(purpose) ? undefined : "purpose";
}
