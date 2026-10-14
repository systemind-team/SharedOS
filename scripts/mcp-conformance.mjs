/**
 * Run the conformance case set against harnesses connected over MCP toolshare.
 *
 * This is the column the other two deliberately do not claim.
 *
 * `conformance.mjs` is the scripted mode: the frame shapes are written in this
 * repository, the parsing is the adapter's, and the transport is left out.
 * `native-conformance.mjs` adds the transport, and runs the model column when a
 * key is present, but cannot hand a CLI the catalogue: no coding-agent CLI
 * accepts a host-supplied tool set on its own stdio protocol, so a live harness
 * driven that way reaches for its own tools, every kernel row goes unexercised,
 * and that column verifies a binding rather than an invariant.
 *
 * Here SharedOS serves the permission-filtered catalogue over MCP, which is the
 * one interface every harness here accepts a host-supplied tool set on -- Pi
 * through an extension. The CLI
 * runs natively with its own loop and whatever model it is configured with,
 * discovers the catalogue with its own MCP client, and every call it makes
 * returns through
 * `RuntimeHost.invokeTool` to be re-authorized.
 *
 * It is still allowed to prove nothing. A harness that is absent, unauthenticated,
 * or that declines to make a declared call leaves no operation in the record and
 * is graded `not exercised` -- never a pass, and never a kernel failure.
 *
 * Usage:
 *   node scripts/mcp-conformance.mjs [--harness claude-code] [--limit 1] [--full]
 *   node scripts/mcp-conformance.mjs --case broker-ungranted,broker-out-of-scope
 *   node scripts/mcp-conformance.mjs --config host.json --full
 *
 * `--harness` names one column; an id that names no column stops the run, and
 * a named harness that is not installed is reported `not available` like any
 * other. `--limit N` runs the first N cases (default 1; `0` probes the harnesses
 * and runs none), `--full` all of them, `--case` named ones.
 * `SHAREDOS_MCP_CONFIG` is the default for `--config`.
 *
 * Live runs cost model tokens, so the default is one case. `--full` runs the
 * whole set and is what a published result should be produced from.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = join(root, "artifacts", "conformance");
const outputJson = join(outputDirectory, "mcp-conformance.json");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};
const full = argv.includes("--full");
const limitFlag = flag("limit", "1");
const limit = full ? Number.POSITIVE_INFINITY : Number(limitFlag);
if (!full && (!Number.isInteger(limit) || limit < 0)) {
  // `Number("two")` is NaN, which is not finite, and a non-finite limit meant
  // the whole set: a typo would have run every case at live-model cost.
  console.error(`--limit takes a whole number of cases, received ${limitFlag}`);
  process.exit(1);
}
const only = flag("harness", undefined);
/**
 * Run named cases instead of a prefix of the set.
 *
 * `--limit` takes the first N, which is the right shape for a smoke test and the
 * wrong one for exercising a row that was added at position eighteen. Ids are
 * comma separated, and one that names no case stops the run: quietly executing a
 * smaller set than was asked for is how a green result gets attributed to a row
 * that never ran.
 */
const selected = flag("case", undefined)
  ?.split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

/**
 * Which model each harness runs, and how it reaches it.
 *
 * Deliberately a file the operator supplies rather than anything this repository
 * knows. Provider names, base URLs, credentials, and per-vendor flags belong to
 * whoever is running the experiment; baking them in would put a second source of
 * truth next to the harness's own configuration, and would rot the first time a
 * provider changed one.
 *
 * SharedOS's interest in the model is exactly one string per column, recorded on
 * the execution record so a comparison can be checked. It does not select the
 * model and cannot confirm the provider served it.
 *
 * Shape:
 *
 *   {
 *     "model": { "id": "...", "provider": "..." },
 *     "harnesses": {
 *       "<harness id>": {
 *         "env": { "VAR": "value" },
 *         "args": ["--extra", "flag"],
 *         "credentialVariables": ["VAR"],
 *         "mcpExtensionVersion": "2.27.0"
 *       }
 *     }
 *   }
 *
 * Absent, every harness runs on whatever it is already configured for, and the
 * records carry no model — which is honest, and not comparable across columns.
 */
const configPath = flag("config", process.env["SHAREDOS_MCP_CONFIG"]);
const hostConfig =
  configPath === undefined ? {} : JSON.parse(await readFile(resolve(configPath), "utf8"));
const model = hostConfig.model;

/**
 * `${VAR}` in a config value is read from the ambient environment.
 *
 * So a committed or shared configuration can name which variable holds a
 * credential without containing the credential. An unset variable expands to the
 * empty string rather than to the literal `${VAR}`, which fails at the harness
 * with an authentication error instead of silently sending a placeholder as a
 * key.
 */
const expand = (value) =>
  String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_, name) => process.env[name] ?? "");
const harnessConfig = (id) => {
  const entry = hostConfig.harnesses?.[id] ?? {};
  return {
    ...entry,
    ...(entry.env === undefined
      ? {}
      : { env: Object.fromEntries(Object.entries(entry.env).map(([k, v]) => [k, expand(v)])) }),
    ...(entry.args === undefined ? {} : { args: entry.args.map((arg) => expand(arg)) }),
  };
};

const { CLAUDE_CODE_REQUIREMENTS, CODEX_REQUIREMENTS, DEEPSEEK_REQUIREMENTS, PI_REQUIREMENTS } =
  await import(join(root, "packages", "adapters", "dist", "index.js"));
const {
  CLAUDE_CODE_MCP_HARNESS,
  CODEX_MCP_HARNESS,
  DEEPSEEK_MCP_HARNESS,
  PI_MCP_HARNESS,
  createMcpHarnessRuntime,
  probeHarness,
} = await import(join(root, "packages", "adapters", "dist", "node.js"));
const { declareToolPolicy, toolPolicyHash } = await import(
  join(root, "packages", "mcp", "dist", "index.js")
);
const {
  CANONICAL_CONFORMANCE_CASES,
  ADVERSARY_COLUMN,
  SHAREDOS_VERSION,
  mcpColumn,
  runConformanceSuite,
  strictFailures,
} = await import(join(root, "packages", "conformance", "dist", "index.js"));

/**
 * What each harness keeps for itself, declared rather than assumed.
 *
 * Local tools make a run mixed. Launch flags are configuration evidence,
 * not a complete inventory or isolation proof: inherited servers, extensions,
 * profiles, and operator arguments remain host-owned and potentially unknown.
 * Pi's built-in tools are requested off, but its extensions remain unreviewed.
 */
const DECLARED_HARNESSES = [
  {
    spec: CLAUDE_CODE_MCP_HARNESS,
    label: "Claude Code",
    requirements: CLAUDE_CODE_REQUIREMENTS,
    policy: declareToolPolicy({ harnessLocal: ["TodoWrite", "SlashCommand"] }),
    mcpSupport: "native",
  },
  {
    spec: CODEX_MCP_HARNESS,
    label: "Codex",
    requirements: CODEX_REQUIREMENTS,
    policy: declareToolPolicy({ harnessLocal: ["shell", "apply_patch"] }),
    mcpSupport: "native",
  },
  {
    spec: DEEPSEEK_MCP_HARNESS,
    label: "DeepSeek",
    requirements: DEEPSEEK_REQUIREMENTS,
    policy: declareToolPolicy({ harnessLocal: ["shell", "apply_patch"] }),
    mcpSupport: "native",
  },
  {
    spec: PI_MCP_HARNESS,
    label: "Pi",
    requirements: PI_REQUIREMENTS,
    /** `--no-builtin-tools` leaves only the extension's proxy, which is not local. */
    policy: declareToolPolicy({ harnessLocal: [] }),
    /**
     * Pi ships no MCP client, so this column's MCP support came from an
     * extension the host chose to install. Recorded per column: a reader should
     * not have to know which harnesses have native clients to read the table.
     */
    mcpSupport: "extension",
    mcpExtension: "pi-mcp-adapter",
  },
];

// Same rule as `--case`, and the same check as `native-conformance.mjs`: a
// filter that quietly matched nothing would attribute a green Adversary-only run
// to a column that never ran.
if (only !== undefined) {
  const declared = DECLARED_HARNESSES.map(({ spec }) => spec.id);
  if (!declared.includes(only)) {
    console.error(`No such MCP harness: ${only}. Declared: ${declared.join(", ")}.`);
    process.exit(1);
  }
}
const HARNESSES = DECLARED_HARNESSES.filter(
  (harness) => only === undefined || harness.spec.id === only,
);

const availability = [];
const columns = [ADVERSARY_COLUMN];
const diagnostics = new Map();

for (const harness of HARNESSES) {
  const host = harnessConfig(harness.spec.id);
  // A pinned model usually moves the credential to a different variable than the
  // harness's own default, so the host config may override what counts as one.
  // It also makes the credential required: every harness here can otherwise fall
  // back to a stored session login, and a stored session authenticates to the
  // provider the harness normally uses -- not to the one this run pinned. A
  // column reported available on that basis would run, fail at the harness, and
  // look like a harness that declined the catalogue.
  const requirements =
    host.credentialVariables === undefined
      ? harness.requirements
      : {
          ...harness.requirements,
          credentialVariables: host.credentialVariables,
          credentialsOptional: false,
        };
  const probe = await probeHarness(requirements);
  availability.push({
    columnId: `${harness.spec.id}-mcp`,
    label: harness.label,
    harness: harness.spec.id,
    mcpSupport: harness.mcpSupport,
    ...(harness.mcpExtension === undefined ? {} : { mcpExtension: harness.mcpExtension }),
    // The one version no CLI can report: the extension is installed inside the
    // harness's own plugin store, so the operator who installed it is the only
    // one who can say which build it is. Declared, and absent when undeclared,
    // rather than guessed at from a lockfile this run never read.
    ...(host.mcpExtensionVersion === undefined
      ? {}
      : { mcpExtensionVersion: String(host.mcpExtensionVersion) }),
    toolPolicy: harness.policy,
    policyHash: await toolPolicyHash(harness.policy),
    ...(model === undefined ? {} : { model }),
    ...probe,
  });
  if (!probe.available) {
    continue;
  }

  columns.push(
    mcpColumn({
      id: `${harness.spec.id}-mcp`,
      label: harness.label,
      // On every record the column produces, as well as in this script's own
      // availability report: a reader of one record has to be able to tell a
      // run whose only tools were SharedOS's from one that also had a shell.
      toolPolicy: harness.policy,
      createRuntime: ({ prompt, executionId, turn }) =>
        createMcpHarnessRuntime(harness.spec, {
          prompt,
          toolPolicy: harness.policy,
          // Opaque, from the operator's configuration. SharedOS passes it to the
          // harness process and records the model string; it selects nothing.
          ...(host.env === undefined ? {} : { env: host.env }),
          ...(host.args === undefined ? {} : { args: host.args }),
          ...(model === undefined ? {} : { model }),
          manifest: {
            ...harness.spec.manifest,
            id: `sharedos.conformance.${harness.spec.id}-mcp`,
            metadata: { ...harness.spec.manifest.metadata, live: true, executionId, turn },
          },
          instructions:
            "SharedOS publishes the permission-filtered tool catalogue for this turn. " +
            "A refusal is an expected result, not an error: report it and continue.",
          onDiagnostic: (id, line) => {
            const kept = diagnostics.get(id) ?? [];
            kept.push(line);
            diagnostics.set(id, kept.slice(-40));
          },
        }),
    }),
  );
}

console.log(`SharedOS ${SHAREDOS_VERSION}\n`);
console.log("Harness availability");
for (const entry of availability) {
  // The version is printed beside the verdict, because "available" is a claim
  // about a particular build and the operator is the one who can see whether it
  // is the build they meant to install.
  const version =
    entry.version === undefined
      ? entry.available
        ? " (version not reported)"
        : ""
      : ` ${entry.version}`;
  console.log(
    `  ${entry.label.padEnd(12)} ${entry.available ? "available" : "not available"}${version}` +
      `${entry.reason === undefined ? "" : ` — ${entry.reason}`}`,
  );
}

if (columns.length === 1) {
  console.log("\nNo MCP-capable harness is installed here. Nothing live was run.");
}

if (selected !== undefined) {
  const declared = new Set(CANONICAL_CONFORMANCE_CASES.map(({ id }) => id));
  const unknown = selected.filter((id) => !declared.has(id));
  if (unknown.length > 0) {
    console.error(`No such conformance case: ${unknown.join(", ")}`);
    process.exit(1);
  }
}
const cases =
  selected === undefined
    ? Number.isFinite(limit)
      ? CANONICAL_CONFORMANCE_CASES.slice(0, limit)
      : CANONICAL_CONFORMANCE_CASES
    : CANONICAL_CONFORMANCE_CASES.filter(({ id }) => selected.includes(id));
if (cases.length < CANONICAL_CONFORMANCE_CASES.length) {
  console.log(
    `\nRunning ${cases.length} of ${CANONICAL_CONFORMANCE_CASES.length} cases ` +
      (selected === undefined
        ? `(${CANONICAL_CONFORMANCE_CASES.length - cases.length} not run; pass --full for the whole set).`
        : `(${cases.map(({ id }) => id).join(", ")}). A partial run is not a manifest.`),
  );
}

console.log(`\nRunning against ${columns.length} column(s)...`);
const started = Date.now();
const { manifest, evidence } = await runConformanceSuite({ cases, columns });
const elapsedMs = Date.now() - started;

const tally = new Map();
for (const row of manifest.rows) {
  for (const cell of row.cells) {
    const counts = tally.get(cell.columnId) ?? new Map();
    counts.set(cell.status, (counts.get(cell.status) ?? 0) + 1);
    tally.set(cell.columnId, counts);
  }
}

console.log(
  "\n| Harness | pass | not applicable | not implemented | out of scope | not exercised | fail |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const column of manifest.columns) {
  const counts = tally.get(column.id) ?? new Map();
  const at = (status) => counts.get(status) ?? 0;
  console.log(
    `| ${column.label} | ${at("pass")} | ${at("not_applicable")} | ` +
      `${at("not_implemented")} | ${at("out_of_scope")} | ${at("not_exercised")} | ${at("fail")} |`,
  );
}

/**
 * Whether the columns were actually comparable.
 *
 * This is what `catalogHash` is for and the reason it is printed before the
 * results are read. Columns whose hashes differ were served different tool sets,
 * and their refusal behaviour cannot be compared until that is explained.
 */
const perColumn = new Map();
/**
 * Which SharedOS built this, kept beside which harness answered.
 *
 * Read off the records rather than declared here: every record names the build
 * that produced it, and an artifact that asserted a version its records did not
 * carry would be attributing evidence to code that never ran. The declared
 * constant is the fallback for a run where no column produced a record at all.
 */
const sharedOsVersions = new Set();
const protocolVersions = new Set();
for (const entry of evidence) {
  const seen = perColumn.get(entry.columnId) ?? {
    turns: 0,
    operations: 0,
    catalogHashes: new Set(),
    // The same hashes, kept per case rather than pooled. Comparability is a
    // claim about two columns seeing the same tools for the same case, and a
    // pooled set cannot express it -- see the divergence check below.
    catalogHashByCase: new Map(),
    toolCounts: new Set(),
    models: new Set(),
    outcomes: new Map(),
    calls: [],
    // Which runtime plugin drove this column, and which build of it. A column is
    // a runtime as much as it is a harness, and `host-integration.md` asks a host
    // to record the runtime id and version apart from the model and the backend.
    runtime: {
      id: entry.runtime.id,
      version: entry.runtime.version,
      protocolVersion: entry.runtime.protocolVersion,
    },
  };
  for (const record of entry.records) {
    sharedOsVersions.add(record.system.sharedOsVersion);
    protocolVersions.add(record.system.protocolVersion);
    seen.turns += 1;
    seen.operations += record.execution.operations.length;
    if (record.system.catalogHash !== undefined) {
      seen.catalogHashes.add(record.system.catalogHash);
      seen.toolCounts.add(record.system.toolCount);
      const forCase = seen.catalogHashByCase.get(entry.caseId) ?? new Set();
      forCase.add(record.system.catalogHash);
      seen.catalogHashByCase.set(entry.caseId, forCase);
    }
    if (record.system.model !== undefined) {
      seen.models.add(record.system.model);
    }
    seen.outcomes.set(
      record.execution.status,
      (seen.outcomes.get(record.execution.status) ?? 0) + 1,
    );
    // What the harness actually called, in order. A `not exercised` cell means a
    // declared attempt left no operation behind, and this is how to see which
    // call the harness made instead of the one the row asked for.
    for (const operation of record.execution.operations) {
      seen.calls.push({
        caseId: entry.caseId,
        source: operation.source,
        tool: operation.tool,
        path: operation.resource?.path,
        outcome: operation.outcome,
        reasonCode: operation.reasonCode,
      });
    }
  }
  perColumn.set(entry.columnId, seen);
}

console.log("\nWhat each column's turns actually did");
for (const column of manifest.columns) {
  const seen = perColumn.get(column.id);
  if (seen === undefined) {
    console.log(`  ${column.label.padEnd(12)} no turns ran`);
    continue;
  }
  const outcomes = [...seen.outcomes.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}×${count}`)
    .join(", ");
  const hashes = [...seen.catalogHashes];
  console.log(
    `  ${column.label.padEnd(12)} ${seen.turns} turns, ${seen.operations} mediated operations, ` +
      `outcomes: ${outcomes}`,
  );
  console.log(
    `  ${"".padEnd(12)} catalogue: ` +
      (hashes.length === 0
        ? "none published (this column serves no catalogue)"
        : `${hashes.map((hash) => `sha256:${hash.slice(0, 12)}…`).join(", ")} ` +
          `over ${[...seen.toolCounts].join("/")} tools`),
  );
  const models = [...seen.models];
  console.log(
    `  ${"".padEnd(12)} model:     ` + (models.length === 0 ? "not declared" : models.join(", ")),
  );
  // Beside the model for the same reason the catalogue is above it: a moved
  // cell is the model's choice only if the seat was asked the same thing.
  console.log(
    `  ${"".padEnd(12)} prompt set: ` +
      (column.promptSetHash === undefined
        ? "none (this column tells the seat nothing)"
        : `sha256:${column.promptSetHash.slice(0, 12)}…`),
  );
  console.log(
    `  ${"".padEnd(12)} runtime:   ${seen.runtime.id} ${seen.runtime.version} ` +
      `(protocol ${seen.runtime.protocolVersion})`,
  );
}

/**
 * The other half of comparability, and the reason the model string is recorded.
 *
 * Equal catalogues make two columns comparable on the tools they were given.
 * Equal models make them comparable on the harness, which is the variable the
 * suite is actually isolating. A run missing either is still evidence about each
 * column on its own, and is not evidence about the difference between them.
 */
const measuredColumns = [...perColumn.entries()].filter(([id]) => id !== ADVERSARY_COLUMN.id);
const declaredModels = new Set(measuredColumns.flatMap(([, seen]) => [...seen.models]));
if (declaredModels.size > 1) {
  console.error(
    `\nWARNING: columns declared ${declaredModels.size} different models ` +
      `(${[...declaredModels].join(", ")}). They are not comparable to each other.`,
  );
} else if (declaredModels.size === 0 && measuredColumns.length > 1) {
  console.error(
    "\nWARNING: no column declared a model. Pass --config with a `model` entry " +
      "if these columns are meant to be compared to each other.",
  );
}

if (sharedOsVersions.size > 1) {
  console.error(
    `\nWARNING: the records name ${sharedOsVersions.size} SharedOS builds ` +
      `(${[...sharedOsVersions].join(", ")}). One artifact cannot be attributed to one build.`,
  );
}

/**
 * Comparability is a claim about columns, so it is checked per column.
 *
 * One run legitimately publishes several catalogues: the set is permission
 * filtered per case, so a case that attaches a brokered tool serves a different
 * hash than one that does not. Pooling every hash and counting them therefore
 * warns on a run where every column was served exactly the same tools, which is
 * the run the check exists to bless. What makes two columns comparable is that
 * each saw the same catalogue *for the same case* -- so compare the sequence of
 * hashes, case by case, and report the case where two columns first diverge.
 *
 * Hashes are compared whole and printed short. Equality on a twelve-hex prefix
 * would be a claim the check never made. And a column that published catalogues
 * elsewhere in the run but recorded none for a case is named, rather than left
 * out of that case's comparison: a case a column silently dropped out of would
 * read as one it agreed on. `Adversary` records no catalogue at all and takes
 * part in neither.
 */
const catalogueSignature = (hashes) => [...hashes].sort().join("+");
const shortSignature = (signature) =>
  signature
    .split("+")
    .map((hash) => `sha256:${hash.slice(0, 12)}…`)
    .join("+");
const publishingColumns = [...perColumn]
  .filter(([, seen]) => seen.catalogHashByCase.size > 0)
  .map(([columnId]) => columnId);
const catalogueByCase = new Map();
for (const [columnId, seen] of perColumn) {
  for (const [caseId, hashes] of seen.catalogHashByCase) {
    const byColumn = catalogueByCase.get(caseId) ?? new Map();
    byColumn.set(columnId, catalogueSignature(hashes));
    catalogueByCase.set(caseId, byColumn);
  }
}
const divergent = [...catalogueByCase.entries()].filter(
  ([, byColumn]) => new Set(byColumn.values()).size > 1,
);
if (divergent.length > 0) {
  const [caseId, byColumn] = divergent[0];
  console.error(
    `\nWARNING: ${divergent.length} case(s) served a different catalogue to different ` +
      "columns. Those columns were not given the same tool set and are not comparable. " +
      `First: ${caseId} — ` +
      [...byColumn.entries()]
        .map(([columnId, signature]) => `${columnId} ${shortSignature(signature)}`)
        .join(", "),
  );
}
const unrecorded = [...catalogueByCase.entries()]
  .map(([caseId, byColumn]) => [
    caseId,
    publishingColumns.filter((columnId) => !byColumn.has(columnId)),
  ])
  .filter(([, missing]) => missing.length > 0);
if (unrecorded.length > 0) {
  console.error(
    `\nWARNING: ${unrecorded.length} case(s) have a column that recorded no catalogue for ` +
      "them, so that column is not compared there: " +
      unrecorded.map(([caseId, missing]) => `${caseId} (${missing.join(", ")})`).join("; "),
  );
}

const failures = strictFailures(manifest);
const liveColumns = manifest.columns.filter(({ id }) => id !== ADVERSARY_COLUMN.id);
await mkdir(outputDirectory, { recursive: true });
await writeFile(
  outputJson,
  `${JSON.stringify(
    {
      kind: "mcp-toolshare-conformance",
      note:
        "Vendor columns here ran the installed CLI natively, with its own loop and " +
        "the model it was configured with, against the SharedOS permission-filtered " +
        "catalogue served over MCP. Every tool call returned through " +
        "RuntimeHost.invokeTool. A column absent from `columns` was not installed " +
        "and is not a result about SharedOS.",
      elapsedMs,
      // Which SharedOS produced this, apart from the model and the harness, so a
      // cell can be attributed to a build. `version` is what the records carry;
      // the declared constant stands in only for a run that produced none.
      sharedOs: {
        version: [...sharedOsVersions][0] ?? SHAREDOS_VERSION,
        protocolVersion: [...protocolVersions][0] ?? "1",
        declared: SHAREDOS_VERSION,
      },
      casesRun: cases.map(({ id }) => id),
      casesDeclared: CANONICAL_CONFORMANCE_CASES.map(({ id }) => id),
      availability,
      runtimes: [...perColumn.entries()].map(([columnId, seen]) => ({
        columnId,
        ...seen.runtime,
      })),
      model,
      configPath,
      catalogues: [...perColumn.entries()].map(([columnId, seen]) => ({
        columnId,
        catalogHashes: [...seen.catalogHashes].map((hash) => `sha256:${hash}`),
        // The evidence behind the comparability check: which catalogue this
        // column was served for each case. A pooled list cannot show that two
        // columns saw the same tools for the same row.
        catalogHashByCase: Object.fromEntries(
          [...seen.catalogHashByCase].map(([caseId, hashes]) => [
            caseId,
            [...hashes].sort().map((hash) => `sha256:${hash}`),
          ]),
        ),
        toolCounts: [...seen.toolCounts],
        models: [...seen.models],
        calls: seen.calls,
      })),
      diagnostics: Object.fromEntries(diagnostics),
      manifest,
    },
    undefined,
    2,
  )}\n`,
  "utf8",
);

console.log(`\nWrote ${outputJson}`);
console.log(`\n${liveColumns.length} MCP column(s) ran; ${failures.length} cell(s) did not pass.`);
for (const failure of failures.slice(0, 12)) {
  console.error(
    `  - ${failure.caseId}/${failure.conditionId} on ${failure.columnId}: ` +
      `${failure.status} — ${failure.detail}`,
  );
}
if (failures.length > 12) {
  console.error(`  … and ${failures.length - 12} more (see ${outputJson}).`);
}
