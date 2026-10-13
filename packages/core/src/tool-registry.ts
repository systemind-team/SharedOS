import type {
  AccessContext,
  CapabilityRequirement,
  JsonObject,
  ReplayKey,
  ToolCall,
  ToolDefinition,
  ToolNamespaceCatalog,
  ToolResult,
} from "@aicoo/sharedos-contracts";
import { ToolDefinitionSchema } from "@aicoo/sharedos-contracts";

import { DuplicateRegistrationError } from "./errors.js";
import { deepFreeze, readJsonObject } from "./internal.js";

export interface ToolHandler {
  readonly definition: ToolDefinition;
  /** Parse and normalize untrusted arguments before authorization or execution. */
  readonly parseArguments: (arguments_: JsonObject) => unknown;
  /** Resolve argument-selected resources immediately before execution. */
  readonly resolveRequirement?: (context: AccessContext, call: ToolCall) => CapabilityRequirement;
  /** The optional identity is trusted kernel provenance for stable nested operation IDs. */
  invoke(
    context: AccessContext,
    call: ToolCall,
    signal: AbortSignal,
    identity?: ReplayKey,
  ): Promise<ToolResult>;
}

/**
 * Supplies tools for exactly one trusted access context.
 *
 * Hosts use this port for user-specific MCP servers and other dynamic catalogs
 * instead of mutating one global registry shared by concurrent users.
 *
 * Called once per turn, not once per operation. The kernel holds what it
 * returns for the turn's length, so a provider that varies part-way through a
 * turn does not change what that turn is answered from (ADR 0026). The context
 * it is given is the one carried by the turn's first operation to need a
 * catalogue, which for `enabledToolNamespaces` may be older than the operation
 * being served: what the turn holds is the unfiltered registry, and the
 * namespace check still runs per operation over it.
 */
export interface ContextToolProvider {
  readonly id: string;
  listTools(context: AccessContext, signal: AbortSignal): Promise<readonly ToolHandler[]>;
}

export class ToolRegistry {
  readonly #tools = new Map<string, ToolHandler>();

  register(handler: ToolHandler): void {
    // Read as untrusted. `ToolHandler` is a host-implemented interface, so a
    // definition is whatever the caller passed, not necessarily an object.
    const source: unknown = handler.definition;
    if (typeof source !== "object" || source === null) {
      throw new TypeError("tool definition does not match the SharedOS contract");
    }

    // Undefined for a shape the copy would misrepresent, and for a blob the
    // walk will not vouch for. Both take the untouched path, where the schema
    // reads the definition the host actually passed.
    const blobs = spreadIsFaithful(source) ? readJsonBlobs(source) : undefined;
    const parsedDefinition =
      blobs === undefined
        ? ToolDefinitionSchema.safeParse(source)
        : ToolDefinitionSchema.safeParse({ ...source, ...standInFor(blobs) });
    if (!parsedDefinition.success) {
      throw new TypeError("tool definition does not match the SharedOS contract");
    }

    const name = parsedDefinition.data.name;
    if (name.length === 0) {
      throw new TypeError("tool name must not be empty");
    }
    if (this.#tools.has(name)) {
      throw new DuplicateRegistrationError("tool", name);
    }

    const definition = deepFreeze(
      cloneDefinition(
        blobs === undefined ? parsedDefinition.data : Object.assign(parsedDefinition.data, blobs),
      ),
    );
    const parseArguments = handler.parseArguments;
    const resolveRequirement = handler.resolveRequirement;
    const invoke = handler.invoke;
    const registered: ToolHandler = {
      definition,
      parseArguments: (arguments_) => parseArguments(arguments_),
      invoke: (context, call, signal, identity) => invoke(context, call, signal, identity),
      ...(resolveRequirement === undefined
        ? {}
        : {
            resolveRequirement: (context: AccessContext, call: ToolCall) =>
              resolveRequirement(context, call),
          }),
    };

    // Frozen because `copy()` shares this object rather than rebuilding it.
    // Re-registering used to make every derived registry a fresh snapshot; a
    // shared mutable entry would instead let a swapped `definition` or `invoke`
    // reach back into the registry it was copied from.
    this.#tools.set(name, Object.freeze(registered));
  }

  /**
   * A registry holding the same registrations as this one.
   *
   * The entries are shared, not re-registered. Every one of them has already
   * been contract-validated, cloned and deep-frozen by {@link register}, which
   * also freezes the entry itself, so re-deriving one spends a schema parse and
   * a JSON round trip to arrive at a value equal to the one already held. That was
   * being paid on the path of every mediated call, where the kernel builds the
   * effective catalogue by re-registering its whole static registry.
   *
   * Copying keeps both properties the rebuild was relied on for: the copy
   * carries the names, so registering a colliding one still raises
   * {@link DuplicateRegistrationError}, and later registrations land on the
   * copy alone -- a host registry is never mutated by the call that adds
   * context-supplied tools beside it.
   */
  copy(): ToolRegistry {
    const copied = new ToolRegistry();
    for (const [name, handler] of this.#tools) {
      copied.#tools.set(name, handler);
    }
    return copied;
  }

  get(name: string): ToolHandler | undefined {
    return this.#tools.get(name);
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  definitions(): readonly ToolDefinition[] {
    return [...this.#tools.values()]
      .map(({ definition }) => definition)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  handlers(): readonly ToolHandler[] {
    return [...this.#tools.values()].sort((left, right) =>
      left.definition.name.localeCompare(right.definition.name),
    );
  }

  namespaceCatalog(enabledToolNamespaces: readonly string[]): ToolNamespaceCatalog {
    const enabled = new Set(enabledToolNamespaces);
    const grouped = new Map<string, { sources: Set<string>; toolCount: number }>();

    for (const definition of this.definitions()) {
      const current = grouped.get(definition.namespace) ?? {
        sources: new Set<string>(),
        toolCount: 0,
      };
      current.sources.add(definition.source);
      current.toolCount += 1;
      grouped.set(definition.namespace, current);
    }

    const namespaces = [...grouped.entries()]
      .map(([namespace, value]) => ({
        namespace,
        sources: [...value.sources].sort(),
        toolCount: value.toolCount,
        enabled: enabled.has(namespace),
      }))
      .sort((left, right) => left.namespace.localeCompare(right.namespace));

    return {
      namespaces,
      summary: {
        total: namespaces.length,
        enabled: namespaces.filter((namespace) => namespace.enabled).length,
        disabled: namespaces.filter((namespace) => !namespace.enabled).length,
      },
    };
  }
}

/**
 * A definition's fields that the contract types as a free-form JSON object.
 *
 * Ordered as {@link ToolDefinitionSchema} declares them, so a field added to
 * the contract as a `JsonObjectSchema` is a visible omission here.
 */
const JSON_BLOB_FIELDS = ["inputSchema", "outputSchema", "metadata"] as const;

/** The fields of {@link JSON_BLOB_FIELDS} a definition carried, read and copied. */
type JsonBlobs = Partial<Record<(typeof JSON_BLOB_FIELDS)[number], JsonObject>>;

/**
 * What the contract schema is shown where a JSON blob was.
 *
 * Frozen and shared because it is only ever parsed, never stored: `register`
 * puts the walked value back over it before the definition is kept.
 */
const BLOB_STAND_IN: JsonObject = Object.freeze({});

/**
 * Whether `{ ...source }` is a faithful stand-in for `source` to the schema.
 *
 * The blob walk works by parsing a copy of the definition with cheap stand-ins
 * where the JSON blobs were. Spreading is how that copy is made, and a spread
 * takes own enumerable data properties and nothing else, while `z.object`
 * reads its shape by property access -- through the prototype chain -- and
 * collects unknown keys for `.strict()` with `for...in`, which walks it too.
 * For almost every definition those describe the same thing. Where they do
 * not, the copy is a different object from the one the host passed, and the
 * contract would be decided against the copy: a definition inheriting a
 * required field would be refused, and one inheriting `annotations` would be
 * accepted with the annotations dropped -- silently losing a `destructive`
 * hint that `superRefine` exists to catch.
 *
 * So the walk is taken only for definitions where the copy cannot differ, and
 * anything else is handed to the schema exactly as it arrived. The fallback is
 * the code this replaced, which is what makes the two verdicts equal by
 * construction rather than by enumeration.
 */
function spreadIsFaithful(source: object): boolean {
  // Anything else -- an array, a `Date`, a class instance, a null prototype --
  // both changes what `z.object` sees and can carry inherited properties.
  if (Object.getPrototypeOf(source) !== Object.prototype) {
    return false;
  }
  // A polluted `Object.prototype` puts enumerable keys in `for...in` that a
  // spread does not copy, so `.strict()` would refuse the original and accept
  // the copy.
  if (Object.keys(Object.prototype).length > 0) {
    return false;
  }
  for (const name of Object.getOwnPropertyNames(source)) {
    const descriptor = Object.getOwnPropertyDescriptor(source, name);
    // Non-enumerable, so the spread drops it; or an accessor, which the spread
    // would invoke a second time and could answer differently.
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      return false;
    }
  }
  return true;
}

/**
 * Read a definition's JSON blobs, or refuse it as `JsonObjectSchema` would.
 *
 * `inputSchema`, `outputSchema` and `metadata` are typed in the contract as
 * `JsonObjectSchema`, a recursive union tried at every branch of every node.
 * On the shipped `messages.request` definition, deciding that its JSON Schema
 * is JSON costs 1244 us of a 1302 us parse -- 93% of the 1340 us that
 * registering that tool took, and until the catalogue was held per turn
 * (ADR 0026) it was 93% of registering it again on every mediated call.
 * Registering it now reads 67 us, and the whole conformance world of nineteen
 * definitions 677 us against 7334 us.
 *
 * `readJsonObject` reaches the same verdict by walking the value once. It is
 * not a second opinion about the contract: `internal.test.ts` holds it to
 * `JsonObjectSchema` over forty-nine shapes -- verdict, value, and the own
 * names at every depth.
 *
 * A field is read exactly when the schema would see a value there, `undefined`
 * included, so an absent `inputSchema` is still the schema's refusal to make
 * and an `outputSchema` explicitly set to `undefined` is still optional. The
 * lookup is a property read rather than an own-key test for the same reason:
 * it is what `z.object` does.
 *
 * Only reached for a definition {@link spreadIsFaithful} accepts. Returning
 * `undefined` for a value that is not a JSON object is therefore not a
 * refusal: `register` falls back to the schema, which refuses it with the
 * issue it always did.
 */
function readJsonBlobs(source: object): JsonBlobs | undefined {
  const blobs: JsonBlobs = {};
  for (const field of JSON_BLOB_FIELDS) {
    const blob: unknown = (source as Record<string, unknown>)[field];
    if (blob === undefined) {
      continue;
    }
    const value = readJsonObject(blob);
    if (value === undefined) {
      return undefined;
    }
    blobs[field] = value;
  }
  return blobs;
}

/**
 * The blobs, as the schema sees them.
 *
 * Every field is still declared to the schema, so it still decides which are
 * required, which are optional and which are unknown; only what it recurses
 * into is replaced.
 */
function standInFor(blobs: JsonBlobs): JsonBlobs {
  const standIns: JsonBlobs = {};
  for (const field of JSON_BLOB_FIELDS) {
    if (blobs[field] !== undefined) {
      standIns[field] = BLOB_STAND_IN;
    }
  }
  return standIns;
}

/**
 * Copy what the schema returned, so nothing registered aliases a caller's value.
 *
 * Kept as a JSON round trip over the whole definition, blobs included, rather
 * than left to the copy the walk above already made. The round trip is an
 * identity on the values the walk emits but for one: it turns `-0` into `0`,
 * and a registration that stopped doing that would be a change to what a
 * definition holds, made silently, for a saving of 22 us against the 1273 us
 * the walk is here for.
 *
 * `structuredClone` was measured in its place and is slower -- 43 us against
 * 27 us on the widest shipped definition -- besides preserving the `-0` the
 * round trip normalizes.
 */
function cloneDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}
