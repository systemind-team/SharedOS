# Changelog

All notable changes to SharedOS are recorded here. The packages share one
version and are published together under npm's `next` dist-tag.

SharedOS is a `1.0.0` preview: contracts may change between previews, and
each entry calls out what a host has to update.

## Unreleased

### Added

- **A host can write files into the turn's workspace before the CLI starts.**
  `createMcpHarnessRuntime` takes `turnFiles`, a function of the turn request
  returning `{ filename, contents }` pairs, written beside the generated
  configuration and named in `configPaths`. The workspace is the CLI's working
  directory, which is where Codex, Claude Code and Pi read a project
  instruction file from, so a host can hand a vendor CLI its standing
  instructions as the `AGENTS.md` the CLI's own loader reads rather than as
  prompt text. A name that would leave the workspace, or that is the generated
  configuration's own, fails the turn before launch. The Codex spec now passes `project_root_markers=[]`, so the scratch
  workspace is the project root and a checkout anywhere above it is never
  read as this turn's instructions. Nothing a host already does changes.

### Changed

- **The repository is `systemind-team/SharedOS`.** It moved from
  `Aicoo-Team/SharedOS`, and old URLs redirect. Each package's `repository`
  field, the release workflow's repository guard and the documentation links
  name the new address. The API reference's source links are now built from
  `sourceLinkTemplate` in `typedoc.json` rather than from the checkout's git
  remote, so `pnpm docs:api:check` gives the same answer in a fork, a mirror
  and CI. Nothing a host imports changes. Before the next release is tagged,
  each package's npm trusted publisher has to name the new address
  (`docs/npm-release.md`).

- **Protocol `"1"` is the `1.0.0-preview` shape, and it is frozen there.**
  `0.1.0-alpha.4` added optional fields to `.strict()` schemas without moving
  the version, and ADR 0019 deferred the move to a later release. The deferral
  is closed without one. `"1"` names what `1.0.0-preview` ships; the
  `0.1.0-alpha` builds are not supported peers of it, so a consumer still on
  one upgrades. From here a change a `1.0.0-preview` reader would reject moves
  the version in the same change. No object is re-stamped, the routes stay
  under `/v1`, and existing records stay readable. ADR 0019 is revised and the
  `ProtocolVersionSchema` row in `docs/open-items.md` is closed.

### Fixed

- **A turn Codex answers in prose now has that prose as its output.** The
  Codex protocol read the OpenAI Responses shape and said the CLI's own
  event envelope was the transport's to carry; but `CODEX_MCP_HARNESS` is
  that transport, and `codex exec --json` prints nothing of the
  Responses shape on stdout. The model's prose is an `agent_message` item in
  `item.completed`, and the turn ends with `turn.completed` or `turn.failed`.
  Read as Responses frames they all meant nothing, so the turn was read from
  the CLI's exit alone: a turn answered in prose ended `succeeded` with empty
  output, and a failed one ended `harness_exited_without_outcome` with the
  exit code and not the CLI's reason. It did not show while Codex answered
  through a tool, since tool calls travel over MCP, not stdout. The protocol now reads those
  three events as well: the prose is a message, `turn.completed` completes
  the turn with the messages as its output, and `turn.failed` fails it as
  `harness_failed` with the CLI's message. The CLI's progress events still
  yield nothing. Responses frames read as before, so a scripted column and a
  direct Responses transport are unchanged. A host that read the CLI's events
  itself before handing frames to the protocol can stop.
- **Two executions that share an actor, purpose and trace no longer share a
  turn.** A turn's authority lease was keyed on namespace, actor, authority,
  owner, purpose and trace, so a second execution that agreed on all six while
  the first was still open was answered from the first's lease: authority
  loaded before it began, no `authority.resolved` of its own, the first's
  catalogue. `AccessContext` gains an optional `executionId` that is part of
  the key, and `SharedOSExecutor` copies the request's onto the turn's context.
  **A run submitted under an execution id that is still running is now refused**
  `denied` with the new code `execution_in_progress`, where it used to share
  the running turn's authority and do its work a second time; wait for the
  original or use a new id. A finished id can still run again. Two opens of one
  context with no id that raced also overwrote each other's lease, so the first
  to close removed the authority the second still held; the later one now
  joins. Nothing on the wire changes: the HTTP schemas omit the context. ADR
  0010 is revised.
- **Reading a Claude Code or Pi tool call no longer pays for a failed parse.**
  The content-block walk the vendor codecs share recognised prose by running
  `TextBlockSchema.safeParse` on every block, where each codec had compared
  `block.type` before the walk was shared. A call block fails that parse, and
  the failure cost more than the rest of the walk: parse-and-translate read
  17.5 µs per call for Claude Code and 17.9 µs for Pi at `1.0.0-preview`,
  against 12.9 and 12.2 µs at `0.1.0-alpha.5`. The walk compares again and
  they read 11.9 and 12.4 µs. The same blocks are read as prose and as calls;
  DeepSeek, whose calls arrive in a frame of their own, and Codex, which does
  not use the walk, never paid it.

## 1.0.0-preview

### Changed — breaking

- **The standard loop is `createStandardRuntime({ driver })`, and the names say
  what each thing is.** "Standard" names the SharedOS-owned default at each
  layer. `StandardRuntime` read as a runtime with a model in it and was the loop;
  `ModelRuntime` and `HarnessRuntime` were that loop again, wrapped only to report
  the driver's manifest in place of `sharedos.standard`. There is now one
  factory. It seats one `AgentTurnDriver` and reports that driver's manifest, so
  a record names what sat in the seat; a driver that states none (the new
  optional `AgentTurnDriver.manifest`) is reported as `sharedos.standard`. The
  loop class is private. `ModelDriver` is `StandardTurnDriver`, the SharedOS
  driver that puts a model API in the seat; `HarnessDriver` is
  `EvalHarnessDriver`, which seats a vendor's wire format for evaluation and
  nothing else. No name has a deprecated alias. Manifest ids are unchanged, so
  no record and no hash moves. ADR 0007 is rewritten in these names and takes
  in ADR 0027, which is withdrawn.

  **Migration.**

  | Before                                                     | After                                                                                                                                                                                                                    |
  | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
  | `new StandardRuntime(driver, options)`                     | `createStandardRuntime({ driver, ...options })`                                                                                                                                                                          |
  | `new ModelRuntime(new ModelDriver(o), options)`            | `createStandardRuntime({ driver: new StandardTurnDriver(o), ...options })`                                                                                                                                               |
  | `new HarnessRuntime(new HarnessDriver(o))`                 | `createStandardRuntime({ driver: new EvalHarnessDriver(o) })`                                                                                                                                                            |
  | `new DriverRuntime(driver)`                                | `createStandardRuntime({ driver })`                                                                                                                                                                                      |
  | `createCodexRuntime({ transport })`, and the three like it | `createMcpHarnessRuntime(CODEX_MCP_HARNESS)` in a product; in an evaluation, `createStandardRuntime({ driver: new EvalHarnessDriver({ transport, manifest: CODEX_VENDOR.manifest, protocol: CODEX_VENDOR.protocol }) })` |
  | `ModelDriverOptions`, `HarnessDriverOptions`               | `StandardTurnDriverOptions`, `EvalHarnessDriverOptions`                                                                                                                                                                  |
  | `StandardRuntimeOptions` as a second argument              | The same fields beside the required `driver`                                                                                                                                                                             |

- **What the kernel states on an audit event is a field, not a `metadata` key.**
  `source`, `cause`, `failClosed`, `consumed` and `endedBy` are `AuditEvent`
  fields. ADR 0023 first put `source` and `cause` in `metadata`, beside
  `failClosed` and `consumed`, so the event kept its top-level shape; ADR 0020
  then recorded a decision's own metadata in the same object, where a host
  ceiling's `failClosed: true` could stand on any denial the kernel had not
  marked, and the kernel carried a function to strip it. `metadata` now holds
  what a host port supplied and the details particular to one event type
  (`grantIds`, `catalogHash`, `withheldCount`, the authorizer's account of a
  denial, an escalation's `detail`), and nothing a port writes can reach a
  field. ADR 0023 is revised in place.

  **Migration.** Read `event.source`, `event.cause`, `event.failClosed`,
  `event.consumed` and `event.endedBy` where you read the `metadata` key of the
  same name. A host that persists audit under a closed schema adds five optional
  fields; `AuditEventSchema` in `@aicoo/sharedos-contracts` is the shape, and the
  kernel's `AuditEvent` type is inferred from it. `version` stays `"1"` and no
  release writes both. A report spanning old and new events filters on both for
  as long as the old ones are in its window.

- **`turn.ended` carries no `source`.** It said `envelope` on every turn ending,
  because the envelope records every turn ending: who recorded, not who refused,
  and a second meaning for the field. Who ended a failed turn is `endedBy`.
  `classifyRefusal` no longer needs to check the event type before reading
  `source`.

- **`RefusalExplanation.source` is typed `AuditSource | undefined`**, where it was
  `string | undefined`, and is read from the field.

- **`AuditOutcome` gains `interrupted`.** Five values become six. It is written on
  `tool.invoked`, `resource.invoked` and `message.sent` for an operation whose
  port was entered and stopped before it answered: the effect may have committed
  in part or in whole. `reason` is `operation_aborted` or `audit_unavailable`.

  **Migration.** A host that persists audit under a closed schema adds the value;
  `AuditOutcomeSchema` in `@aicoo/sharedos-contracts` is the list. A report that
  counts failures decides where `interrupted` belongs, and it is not with the
  refusals. Nothing that was recorded before is recorded differently: these
  operations used to leave no event at all.

- **A sink that throws on a record written before an effect rejects with
  `AuditUnavailableError`**, where the kernel re-threw whatever the sink threw.
  The sink's error is its `cause`, `code` is `audit_unavailable`, and `effect`
  says whether the operation's port had been entered. A caller that matched on
  the sink's own error type or message reads `error.cause`.

- **`retryable` on a turn's ending says whether running it again repeats
  anything.** `turn_cancelled` and `runtime_failed` said `true` whatever the turn
  had done, and a plugin's own failure said what the plugin said, which for the
  harness adapters is `true` on any harness failure. A host that followed the
  flag after a turn had sent a payment sent it twice. The envelope now decides
  it for `turn_cancelled`, `runtime_failed` and `audit_unavailable`, and caps a
  plugin's `true`: it is `false` once a call to a `write` tool not declared
  `idempotent` came back anything but `denied`, or was still with the kernel
  when the turn ended. Calls to `read` tools never count, so a turn that only
  searched and ran out of time is still retried. ADR 0007 is revised in place.

  **Migration.** A host that retried every `turn_cancelled` or `runtime_failed`
  will retry fewer; that is the fix. Check your tool definitions, because the
  rule rests on them: `readWrite: "read"` only where a second run changes
  nothing, `annotations.idempotent` only where a second run is a no-op.

- **`TurnKernel` requires its four turn ports.** `openTurnAuthority`,
  `recordEscalation`, `recordTurnEnd` and `recordRefusedCall` were optional
  members, so a partial kernel could run a turn that re-read its authority on
  every call and recorded none of what the envelope decided. They are required,
  and the executor no longer branches on their absence. ADR 0023 is revised in
  place.

  **Migration.** A host that passes a `SharedOSKernel` changes nothing. A host
  or test that hands `SharedOSExecutor` its own narrow kernel implements the
  four: a lease whose `close` may do nothing, and three recorders that may.

- **The conformance record carries a refusal's cause and an `interrupted`
  outcome, and the judge is version 6.** `OperationRecord` gains an optional
  `cause`, copied from the audit event, and `outcome` gains `interrupted`, where
  the assembler used to write `failed`. A reader that switches on the three
  outcomes has a fourth to handle; a receipt still reports `failed`, which is
  what the caller saw, and the judge credits no boundary with an interrupted
  call. The cause was recovered before by joining a call's sibling operations by
  id, which only ever found a refused dispatch's code. Read off the operation,
  every kernel `tool_unavailable` names its situation: 42 committed cells gain
  `cause not_offered`. `execution.endedBy` is new and optional. Two rows are
  added, `audit_unavailable` and `turn_draining`, so the manifest has 34 rows
  and `caseSetHash` and `worldSetHash` move: a live column recorded against the
  old pair is no longer comparable with the scripted columns by hash.
  `experiment.specHash` ignores descriptions, as `caseSetHash` does, and moves
  once on every record. ADRs 0014 and 0023 are revised in place.

  **Migration.** Regenerate any stored manifest. Code that called
  `operationsUnder(record, id).cause` reads `cause` on the `tool` operation
  under that id.

### Fixed

- **A harness probe reads the version a CLI answered with, not the first thing
  it printed.** `probeHarness` read stdout and stderr as one text and took the
  first line, so Codex -- which warns on stderr when `CODEX_HOME` is under a
  temporary directory before it answers on stdout -- was recorded with its
  warning as `versionOutput` and no `version`, and its build in a conformance
  artifact was whatever the runbook said had been installed. The streams are
  now read apart, stdout first, and a line counts only if the whole of it is a
  version answer (`codex-cli 0.149.0`, `2.1.278 (Claude Code)`, `v22.14.0`):
  a notice that a newer build exists is a sentence, or names two versions, and
  is never taken for the build that ran. Lines that answer with different
  builds record none. Still fails open: no readable answer leaves `version`
  absent, `versionOutput` the first line said, and the harness available.

- **A deadline no longer has to stop a handler half-way.** A `transfer_funds`
  between its debit and its credit when the deadline fired stopped there. A
  host may now set `drainGraceMs` on `SharedOSExecutor`: the turn stops taking
  tool calls that long before its deadline (`denied`, `turn_draining`, recorded),
  handlers already running are not signalled and answer with their real outcome,
  and the abort reaches what is still running at `timeoutMs`, which is recorded
  `interrupted`. The grace is inside the limit, never on top of it, and the turn
  ends as soon as what was in flight has answered; the standard loop asks the
  seat nothing more once it is draining. An audit outage drains the
  same way; a host's own cancellation still stops the turn at once. Zero, the
  default, is the behaviour before. ADR 0007 is revised in place.

- **A tool call refused at discovery records why.** `invokeTool` checks
  discovery before it authorizes, and a call refused there wrote an
  `authorization.checked` event with the reason and nothing else: no
  `grantsResolved`, no `rejectedGrants`, no `missingDependency`. That is the
  path a missing `usageStore` always takes for a tool whose only grant is
  bounded, so the wiring fault `docs/host-integration.md` says is "diagnosable
  from the trail" was absent from the trail exactly where a host meets it. The
  kernel now asks for the account on that check, and `canDiscover` takes an
  optional `onExplain` (`DiscoverOptions`) to hand it over. `listTools` does not
  ask, so filtering a catalogue still records no account, and a discovery
  denial still carries no `requiredAuthority` (ADR 0019). The caller is told
  what it was told before.

- **A session that opens after its turn was cancelled is closed.** The standard
  loop stops waiting for `AgentTurnDriver.open` when the turn is cancelled. A
  driver that does not honour its signal, or loses the race with it, handed back
  a session nothing held, so `close` was never called and whatever the session
  had taken stayed open. The loop now keeps the promise and closes a session
  that arrives late, with the turn's ending and under `closeTimeoutMs`. The turn
  does not wait for it. A driver may therefore see `close` on a session that was
  never asked for a decision.

- **A sink that hangs after an effect no longer holds the result.** A sink that
  threw there was already handed to `onAuditError`; one that never answered kept
  the result of a committed effect waiting, and a turn that reached its deadline
  first lost it. `auditWriteTimeoutMs` on the kernel bounds the write: past it
  `onAuditError` receives an `AuditWriteTimeoutError` and the caller its result.
  Records written before an effect are never limited. ADR 0023 is revised in
  place.

- **An audit outage before an effect ends the turn `audit_unavailable`, by the
  envelope.** A sink that threw on an authority load, a decision or a catalogue
  listing rejected into the turn body, and the turn ended `runtime_failed`, "The
  runtime plugin failed" -- for an outage the plugin had no part in, and also
  when the outage was met before any plugin ran. A plugin that caught the
  rejection could call again, and be refused again. The executor now notes the
  typed error where it called the kernel itself, stops the turn taking anything
  new, and ends it `failed` / `audit_unavailable` with `endedBy: envelope` and
  `failClosed`; a plugin can neither carry on past it nor throw the error itself
  to be credited with the refusal. `retryable` follows the rule above.
  `onTurnError` receives the error.
  A record that fails _after_ an effect still never ends a turn. ADR 0023 is
  revised in place.

- **An operation stopped mid-effect leaves a record.** A handler that did part of
  its work, saw the turn's deadline and threw left a trail ending at
  `authorization.checked: allowed`: the abort was re-thrown ahead of the
  operation event, so a cancelled or timed-out turn could hide a debit. The
  event is now written first, as `interrupted`. The abort is still re-thrown and
  still not reported to `onProviderError`; a port that answers despite the abort
  is recorded with its real outcome, and a call stopped before its port was
  entered writes nothing. The conformance record reads `interrupted` as `failed`,
  never `denied`.

- **An outage is marked `failClosed` on every operation event.** `docs/errors.md`
  tells a host to exclude `failClosed` records before computing a denial rate.
  `tool.invoked` carried the flag; `resource.invoked` and `message.sent` were
  built separately and never did, so a grant store that was down read as one
  outage and two deliberate refusals. One builder states the operation facts for
  all three.

- **A turn whose audit sink is down still ends `escalated`.** A sink that threw on
  `escalation.requested` rejected `recordEscalation` inside the executor's `try`:
  the turn ended `failed` / `runtime_failed`, the plugin was blamed, and the
  throw went to `onTurnError`. The record is the turn's terminal, not a gate, so
  it is written on the path that reports to `onAuditError` and leaves the ending
  alone. The rule it follows is stated and tested for the first time: a record
  written before an effect (an authority load, a decision, a catalogue listing)
  rejects the operation when the sink throws, and nothing runs; a record written
  after one never changes the answer. No behaviour moved for the first kind.

- **A turn that never returns still records what it was asked.** `promptHash`
  rode on the turn's outcome metadata alone, and a turn cancelled at its deadline
  has no outcome: the plugin threw at the abort and the envelope built the
  `cancelled` result from its own provenance. The same held for a turn the
  standard loop ended itself — `step_limit_exceeded` carries no driver metadata.
  Such a turn then dropped out of its column's prompt set, and the column's
  moved `promptSetHash` read as a reworded prompt — the one confusion the hash
  exists to remove; the 2026-09-08 live run showed it, one stalled Claude Code
  turn folding 28 entries against the other columns' 29. A runtime now states
  the hash to the envelope through the new `RuntimeHost.annotate`, before the
  model or harness is sent anything, and the envelope writes it into
  `ExecutionResult.metadata` on every ending: completed, failed, escalated,
  cancelled, a plugin that threw, an outcome that did not parse (ADR 0007).
  `createMcpHarnessRuntime` states it before binding its port or spawning the
  CLI; the standard loop states it once `open` has resolved, before the first
  step, for any `AgentTurnSession` that states a `promptHash`, which
  `StandardTurnDriver`'s session now does, in place of restating it on its terminal
  metadata. A turn cancelled before there is a hash to state -- inside a
  driver's `open`, or before the MCP runtime has composed its prompt -- still
  carries none. `assembleExecutionRecord` reads the metadata as before; a
  malformed value reads as absent, as a malformed catalogue hash does.
  **What a host has to update:** nothing; a driver that hands the seat text
  and wants its stalled turns identified states `promptHash` on its session,
  hashed before its `open` sends anything. The committed `Standard` prompt-set
  hash moves once, `ece3b355…` to `4dbefcbd…`, because the
  `budget-exceeded/step-ceiling` turn now counts; the case-set and world-set
  hashes do not move.

### Changed

- **A driven harness is told where its turn may operate, and its record says what
  it was told.** `EvalHarnessDriver` handed its harness a prompt and nothing else,
  and its session stated no `promptHash`, so the four vendor columns carried no
  prompt set. It now takes `instructions` like the other two seats (the turn's
  reach by default), carries them on the new optional
  `HarnessTurnRequest.instructions`, and states the hash of both texts.
  `harnessTurnText` renders the two as one message, and
  `scripts/native-conformance.mjs` sends that in each opening frame where it
  sent the prompt alone. The reference-host example driver states its hash the
  same way.

  **Hash effect.** `Codex`, `Claude Code`, `DeepSeek` and `Pi` gain a
  `promptSetHash` in the conformance manifest, and their records a
  `system.promptHash`. No other hash moves; `Standard`'s prompt set is unchanged.
  A transport of your own that opens a harness from `HarnessTurnRequest` should
  hand `instructions` over, since the hash now covers it.

- **One vocabulary for what a seat states about its turn, and
  `callsAfterEscalation` in the record.** The standard driver and the MCP harness
  runtime each built their result metadata as an untyped object, and `model` and
  `modelProvider` meant "served" on one path and "declared" on the other with
  nothing saying so. Both now return the exported `SeatMetadata`, which declares
  every key and says which seat states it and what it means there; the keys and
  their values are unchanged. ADR 0018 names `callsAfterEscalation` as the only
  place "the harness kept going after it asked" can be read, and nothing read
  it: the conformance record now lifts it as `execution.callsAfterEscalation`,
  optional and ungraded, so the record's `version` and the grading rules'
  version do not move. `harnessOutcome`, `harnessErrorCode` and
  `malformedToolCalls` stay on the result, documented, for the host that ran the
  turn. The open-items mention closes.

- **One default for the MCP server name.** `connection.name ??
SHAREDOS_MCP_SERVER_NAME` was written at ten sites across the config emitters,
  the launch arguments and the turn's metadata. `mcpServerName(connection)` in
  `@aicoo/sharedos-mcp` applies it, and the four shipped `McpHarnessSpec` entries
  no longer restate the default as their `serverName`.

- **One vendor descriptor.** Each of the four vendor folders declared its id, its
  driven manifest and its requirements from a copied template, and
  `mcp-runtime.ts` declared each MCP manifest again. `defineHarnessVendor` builds
  all of it from a vendor's few facts (id, codec, executable, credential
  variables), and `CODEX_VENDOR`, `CLAUDE_CODE_VENDOR`, `DEEPSEEK_VENDOR` and
  `PI_VENDOR` are exported beside the names that were already there. Every
  manifest and every requirements object is what it was, key for key.

- **One child-process runner under both ways a vendor CLI is seated.**
  `ChildProcessTransport` and the MCP harness runtime each spawned, framed JSON
  lines, kept diagnostics and stopped their child in a copy of their own, and
  only the MCP copy ended its child when the turn was aborted. Both now run on
  one `HarnessProcess`, so a driven harness is also ended by the turn's signal
  where it was left to `close`. Each copy kept a capped tail of the harness's
  stderr (4,096 and 8,192 characters) that nothing read; diagnostics now go to
  the callback alone, and `ChildProcessTransportOptions` gains the `onDiagnostic`
  the MCP runtime already had. A stdout line that is not a frame reaches it too,
  where the transport dropped it.

- **One seat module in `@aicoo/sharedos-adapters`.** The model driver, the harness
  driver and the MCP harness runtime each composed the seat's two texts, hashed
  them, recognised the escalate affordance and stamped a `ToolCall` in their own
  copy, with the reason the catalogue gates the affordance's name written out
  three times. They now share `seat.ts`, and the reason is stated once. No
  behaviour changes. `ModelDriverOptions.instructions` also accepts a string,
  placed before the turn's reach, as `McpHarnessRuntimeOptions.instructions`
  always has; both interfaces extend the exported `SeatTextOptions`, and
  `declareStep` is typed by the exported `DeclareStep`.

- **The route-lease row quotes one refusal code, and carries the transport's as
  its cause.** A `messages.request` the transport refuses leaves two operations
  under one call id: `message.sent`, denied with the transport's code, then the
  tool call, failed with `message_request_not_accepted`. The scripted columns'
  record reader took the first operation under the id and the live columns and
  `Adv` read the second, so `route-lease-revoked` printed `route_lease_revoked`
  in five columns and `message_request_not_accepted` in the rest, and the
  expectation accepted either. The split was mistaken for a difference between
  observing the tool result and observing the record (ADR 0025 said as much); it
  was audit order. `receiptsFromRecord` now takes the tool operation as the
  attempt's receipt, the expectation names `message_request_not_accepted` alone
  — what SharedOS says, in every column — and `judgeCase` joins the other
  operation's code to the attempt by call id as `cause`, reported and never
  graded, because a host's vocabulary is not a claim about the kernel.
  `AttemptOutcome.cause`, `CaseJudgement.causes` and `ConformanceCell.causes`
  are new; the manifest prints `cause` after `reason` where a cell has one. The
  case-set hash moves, `1515d09c…` to `85fc0fb5…`, because the expectation is
  in it; the world-set and prompt-set hashes do not. **What a host has to
  update:** a reader of manifest cells sees one more array field; a host's own
  `AttemptExpectation` for a refused dispatch should name the tool's code, not
  the transport's.

### Added

- **`DiscoverOptions`, and `onExplain` on `CapabilityAuthorizer.canDiscover`.**
  The account `authorize` already hands a host, on a discovery check that asks
  for it. Optional, and unset wherever a catalogue is filtered. It exists for
  the fix above: a call refused at discovery now records why.
- **testkit: `expire()` on the two grant stores, `UnavailableGrantUsageStore`,
  and `InMemoryMessageRequestRouter`.** testkit is where ADR 0002 puts the
  in-memory stand-ins for the storage a host supplies, and the conformance world
  restated four of them for want of these. `expire` edits a grant's window in
  place and throws on an id the store does not hold, as `revoke` does. The
  conformance package now depends on testkit and builds its world on these
  stores.
- **`terminalSource` in `@aicoo/sharedos-runtime`.** Who ended a failed turn,
  read from its events: `envelope` or `runtime`. It is the reader the envelope
  uses for its own `turn.ended` record, exported so whoever assembles a record
  does not write a second one.
- **`receiptBase` in `@aicoo/sharedos-conformance`,** the declared half of an
  attempt receipt, shared by the three places that build one.
- **A conformance column can declare its tool policy.** `RuntimeColumn.toolPolicy`
  and `McpColumnOptions.toolPolicy`; the runner writes it to
  `system.toolPolicy` on every record the column produces, which is where ADR
  0014 said it belonged. `scripts/mcp-conformance.mjs` passes each CLI's.
- **`ConformanceWorldOptions.auditFailsAfterOperations` and `drainGraceMs`,** for
  the two new rows, and `ConformanceWorld.envelope`, the envelope options a
  condition armed.
- **`SHAREDOS_VERSION` in `@aicoo/sharedos-contracts`.** The one statement of the
  build, read by every runtime manifest, the MCP server's greeting and the
  conformance record, and the one constant the release gate checks.

- **`RuntimeHost.draining`**, an `AbortSignal` aborted once the turn takes
  nothing new. Optional on the type so a host double stays viable; the envelope
  always supplies it. Its reason is fixed and carries nothing from the host.
  `TURN_DRAINING`, `AuditWriteTimeoutError` and `AUDIT_WRITE_TIMEOUT` are
  exported beside it.

- **A refused `messages.request` names what the transport answered.** The caller is
  told `message_request_not_accepted` whatever the transport said, and only the
  sibling `message.sent` carried the transport's code, so a reader joined the two
  by call id to say why. The tool's own `tool.invoked` carries it as `cause`. It
  travels inside the kernel, never through the handler's result, which is
  returned to the caller whole (ADR 0012).

- **`EscalationOptions.executionId`.** Optional. `recordEscalation` records it as
  the event's `operationId`, which that turn's `turn.ended` has always carried, so
  a reviewer's queue built from audit joins an escalation to its turn on an id.
  The execution envelope passes it.

- **An envelope refusal carries the turn's `catalogHash`.** The kernel's own
  `tool.invoked` has since ADR 0026; the envelope's was built apart and did not,
  so a `not_offered` refusal could not be joined to the catalogue that did not
  offer the tool.

- **`RuntimeHost.annotate(key, value)`: a fact stated for the turn's record.**
  `emit` is for something that happened at a moment; this is for something that
  is true of the turn. The executor holds a frozen clone of a JSON value and
  merges it into the result's metadata after the outcome's own and before
  `runtime`, on every way out of the turn. It throws a `TypeError` for an empty
  key, for the reserved key `runtime`, for the key `__proto__`, and for a value
  that is not JSON, and for nothing else: a write while the turn is aborted but open is kept, a write
  after the turn closed is dropped, so a call site needs no guard. The last
  write wins. `PROMPT_HASH_ANNOTATION`, `ESCALATION_ASKED_ANNOTATION` and
  `escalationAskedAnnotation` name the two facts SharedOS's own runtimes state.
  **What a host has to update:** only a test double that builds its own
  `RuntimeHost` adds the member; a plugin is unaffected (ADR 0007).

- **A refusal's gate is readable from its audit record, by call id.**
  `tool_unavailable` is one code over "not registered", "namespace disabled",
  and "not discoverable to you", and `no_matching_grant` is one code over nine
  conditions, so a caller cannot map the permission topology from refusals
  (ADR 0012). The host is not the caller, and the record already said which:
  `cause`, `source`, `failClosed`, `rejectedGrants`.
  What a host still did by hand was join a denied `ToolResult` to those records
  and decide which check refused. `@aicoo/sharedos-core` now exports
  `classifyRefusal(event)`, which names one of six gates — `envelope`,
  `registration`, `request`, `infrastructure`, `ceiling`, `grant` — for a denied
  audit event, and `explainRefusal(result, events)`, which finds the event for a
  result by `operationId` and names it. Both return recorded facts and no prose;
  what each gate means and what fixes it is one table in `docs/errors.md`. The
  join is on the call id and never on recency: two turns interleaved on one sink
  put another call's refusal last. Nothing here reaches the wire, and
  `docs/errors.md` now says in so many words that a host which narrates the gate
  back to the model has handed it the oracle the coarse code withholds.

### Changed

- **The discovery decision behind a `tool_unavailable` carries the call's id.**
  `SharedOSKernel.invokeTool` refuses a tool no grant makes discoverable with a
  recorded `authorization.checked` decision, and that record now carries the
  call's `operationId`, as the `tool.invoked` refusal after it already did. The
  two joined only on time order before. A sink or reader keyed on
  `authorization.checked` events without an `operationId` sees one more that has
  it.
- **A delegate's ask is a record field, and the grading rules read it there.**
  The standard loop, the MCP escalation latch and the conformance adversary
  announced the ask as an `escalation.asked` runtime event, each behind its own
  guard against a host that refuses events. They now state it through
  `RuntimeHost.annotate` as `escalationAsked: { tool, reason }`, with no guard.
  The judge grades an `ExecutionRecord`, which carries none of a result's
  metadata, so the record gains an optional `execution.escalationAsked` and
  `assembleExecutionRecord` lifts the stated ask into it, validated on shape.
  `JUDGE_VERSION` goes 4 to 5: the rule is unchanged, its source moved. No
  committed cell and no hash moves; a record written under version 4 carries the
  event and not the field, so the two are not cell-comparable on the escalation
  row.

- **One route table, one version constant, one home for the primitives.**
  `@aicoo/sharedos-contracts` now exports `SHAREDOS_ROUTES`, the HTTP surface
  as one table of path, verb, request schema and response schema, which
  `createSharedOSHandler` routes from and `SharedOSClient` calls through; a
  path with two verbs is two entries, so the handler's `405` names the verbs
  the table has for that path. `WireSchema<T>` is the shape both sides need
  from a schema, and `SharedOSApiErrorCode` names the seven codes the handler
  itself answers with; `SharedOSHttpError.code` and `SharedOSClientError.code`
  are typed by it, widened to any string because a host's `resolveContext`
  throws codes of its own and an older client must still carry a newer
  server's. The wire is unchanged. `PROTOCOL_VERSION` is the one value
  `ProtocolVersionSchema` accepts, and every runtime manifest, request, event,
  result and envelope SharedOS builds reads it; the conformance record, the
  adversarial report, the conformance manifest and the cost report keep their
  own `"1"`, which are versions of their own shapes. `isJsonObject` sits in
  contracts beside the `JsonObject` type. The helpers the runtime and the
  adapters had each copied from core — `deepFreeze`, `protocolError`,
  `raceAbort`, `readJsonObject`, now with `parseJsonObject` beside it for JSON
  text, and `compactObject` — are exported once, from
  `@aicoo/sharedos-core/internal`, a subpath and not the package index. The
  runtime's `deepFreeze` had short-circuited on a frozen container; core's
  recurses first. **What a host has to update:** a driver's `open` takes
  `RuntimeTurnRequest`, the name `AgentTurnRequest` was an alias of; the
  standard composition is `new SharedOSExecutor(kernel,
createStandardRuntime({ driver }))`, which `TurnExecutor` built (see Removed).
- **`MessageEnvelope.provenance` is host-owned metadata, and says so.** The
  kernel checks its shape with the envelope, neither sets nor reads it, and hands
  it to the transport as sent. Its row in `docs/open-items.md` is closed on that
  reading; the schema and the threat model state it. ADR 0025 is revised in
  place for where the `route-lease-revoked` row reads the transport's code: the
  tool operation's `cause`, not a second operation joined by call id. No
  behaviour, record or hash changes.
- **The root README is rewritten around what ships, and installs are untagged.**
  It opens on Grant, Delegate, Execute, the tagline and the three parts of
  "About SharedOS"; names the two shipped runtimes,
  `createStandardRuntime` and `createMcpHarnessRuntime`; turns the examples into
  a table; and leaves the ADR list to the index in `docs/README.md`, which gains
  the conformance manifest and the systems-cost page under "Start here". Every
  install line is `npm install @aicoo/sharedos…` with no `@next`, so it takes
  the release npm's `latest` tag points at. The release runbook still verifies
  a new publication under `next`, where releases land.
- **The pages the root README links are corrected against the code.** The
  quickstart's first program now prints what it says, `docs/mcp-api.md` imports
  the HTTP transport from `@aicoo/sharedos-mcp/node`, `docs/endpoints.md` counts
  what ships, and the design pages name the two runtimes and the turn endings
  `docs/errors.md` already described. Docs only.

### Removed

- From `@aicoo/sharedos-conformance`: `operationsUnder` and `CallOperations`
  (the operation carries its `cause`); `contentHash` (use `hashJson`, exported
  from the same place); `ConformanceChainResolver` (`ConformanceWorld.chain` is
  testkit's `InMemoryDelegationChainResolver`); and nine declarations nothing
  set or read: `SystemIdentity.adapterVersion`, `ConformanceWorldOptions.now`,
  `HostileRuntimeOptions.version`, `HostileRuntime.moves`,
  `ConformanceGrantSource.loads`, `SpanCollector.pause`, `resume` and `named`,
  and `AttemptReceipt.forgedGrantId`. No alias for any of them.
- From `@aicoo/sharedos-core`: `MID_TURN_AUTHORITY_REFRESH`, and the
  per-operation authority path it switched on. It was an exported `const false`:
  a host could not set it, no test did, and since ADR 0016 moved expiry to the
  operation's instant the one thing left behind it was seeing a store edit
  before the next turn, at a store read per operation. A turn resolves authority
  once. A kernel call outside any turn still resolves its own, which is a turn
  of one operation and is unchanged. ADRs 0009, 0010 and 0016 are revised in
  place, and the open-items row is closed.
- From `@aicoo/sharedos-core`: `AuthorizationRequest`. It was
  `CapabilityRequirement` from contracts declared a second time: the same
  `resource` and `action`, and `POST /v1/authorize` already took the contract
  schema. Core uses the contract type throughout, the two host ports that named
  the old one included: `HostCeiling.narrow` and
  `MessageCapabilityResolver.resolve`. A host that builds the object without
  importing the type changes nothing; one that imports it renames one type. ADR
  0020 is revised in place.
- From `@aicoo/sharedos-runtime`: `StandardRuntime`. See
  `createStandardRuntime` under "Changed — breaking".
- From `@aicoo/sharedos-adapters`: `ModelRuntime`, `HarnessRuntime` and
  `DriverRuntime`; `ModelDriver` and `HarnessDriver` with their `…Options` types,
  under their new names; `createCodexDriver`, `createClaudeCodeDriver`,
  `createDeepseekDriver`, `createPiDriver` and the four `create…Runtime`
  functions built on them, with `CodexDriverOptions`, `ClaudeCodeDriverOptions`,
  `DeepseekDriverOptions` and `PiDriverOptions`. A driver is not a plugin, so
  there is no factory per driver or per vendor: a vendor CLI is seated in a
  product through `createMcpHarnessRuntime`, and its wire codec only by an
  evaluation, from its `*_VENDOR` descriptor. `parseToolArguments` is no longer
  exported; it was a re-export of an internal helper that no SharedOS interface
  takes or returns.
- Seven version constants: `STANDARD_RUNTIME_VERSION` from
  `@aicoo/sharedos-runtime`, `MCP_SERVER_VERSION` from `@aicoo/sharedos-mcp`, and
  `MCP_ADAPTER_VERSION`, `CODEX_ADAPTER_VERSION`, `CLAUDE_CODE_ADAPTER_VERSION`,
  `DEEPSEEK_ADAPTER_VERSION` and `PI_ADAPTER_VERSION` from
  `@aicoo/sharedos-adapters`. The packages share one version, so each was the
  same string kept equal by the release gate. Read `SHAREDOS_VERSION` from
  `@aicoo/sharedos-contracts`, which `@aicoo/sharedos-conformance` still exports
  under the same name. Every manifest states the same version as before.
- `OpenToolBridgeOptions.step` from `@aicoo/sharedos-mcp`, and the `options`
  parameter of `BridgeToolInvoker.invokeTool` with it. No caller passed a step:
  a harness keeps its own loop, so a turn served over MCP declares none and is
  bounded by `maxToolCalls` and `timeoutMs`, which `docs/mcp-toolshare.md` now
  says. `RuntimeHost` still satisfies `BridgeToolInvoker`. The open-items row
  closes.
- `ESCALATION_ASKED_EVENT` and `escalationAskedEvent` from
  `@aicoo/sharedos-runtime`, shipped in 0.1.0-alpha.4. A delegate states the ask
  through `RuntimeHost.annotate` under `ESCALATION_ASKED_ANNOTATION`, in the
  shape `escalationAskedAnnotation` builds; a reader takes
  `execution.escalationAsked` from the record, or `metadata.escalationAsked`
  from the result, instead of decoding a `runtime.event`.
- `TurnExecutor` and `TurnExecutorOptions` from `@aicoo/sharedos-runtime`. The
  facade built exactly `new SharedOSExecutor(kernel,
createStandardRuntime({ driver }))` and forwarded `onTurnError` to both; a host writes
  that composition itself and installs one sink in both options. Open-items
  row 19 closes.
- `AgentVisibleContext` and `AgentTurnRequest` from `@aicoo/sharedos-runtime`,
  the backwards-compatible spellings of `RuntimeVisibleContext` and
  `RuntimeTurnRequest`. The first had no user; the second was the parameter
  type of `AgentTurnDriver.open`, which now names the type it always was.
- `ContextCapsule`, `ContextCapsuleSchema`, `validateContextCapsule`,
  `contextCapsulePreview`, `CONTEXT_CAPSULE_ITEM_KINDS` and the
  `MAX_CONTEXT_CAPSULE_*` limits from `@aicoo/sharedos-contracts`, and their
  row in the `docs/errors.md` limits table. Not dead surface: a feature stub, a
  bounded, content-addressed payload for delegating across a trust boundary,
  removed because no message, tool or turn path carries a capsule and no ADR
  asks for one. It returns under governed views, with an ADR of its own.
  Open-items row 14 closes.
- `JsonArraySchema` from `@aicoo/sharedos-contracts`. `JsonValueSchema`
  validates arrays inline; the `JsonArray` type stays.
- `ToolClassSchema` and `ToolClass` from `@aicoo/sharedos-contracts`, with
  `classifyTool` from `@aicoo/sharedos-mcp`. Nothing but their own test called
  them, and neither the conformance package nor the grading rules read a
  per-call tool class: ADR 0014 declares the classes per run through
  `ToolPolicy`, which stays with `declareToolPolicy`, `parseToolPolicy` and
  `toolPolicyHash`, the last of which the MCP conformance script uses for its
  columns' `policyHash`.
- `CompositeAuditSink` from `@aicoo/sharedos-core`. The kernel takes one sink;
  fanning out to several is a five-line host utility, not a SharedOS claim.
- `measureSync` from `@aicoo/sharedos-core`. Every operation SharedOS measures
  is asynchronous.
- `formatCatalogHash` from `@aicoo/sharedos-core`. The record stores the bare
  hex, and the `sha256:`-prefixed form it produced had no carrier; its comment
  claiming the record renders it was wrong.

## 0.1.0-alpha.5

### Changed — breaking

- **A turn's tool catalogue is resolved once, and every call in the turn is
  answered from it.** Three things already said so: `OpenToolBridge` computes its
  catalogue once, because "a catalogue that could change between `tools/list` and
  `tools/call` would make `catalogHash` a claim about a moment rather than about
  the turn"; the MCP server answers `initialize` with
  `capabilities.tools.listChanged: false`, a promise on the wire to every client;
  and an execution token binds `catalogHash` into its claims, so a stale sandbox
  cannot reconnect and call tools it was never shown. The kernel did not — it
  re-derived the effective registry on every operation. A static registry cannot
  differ between two derivations, but a `ContextToolProvider` can: it is an async
  port called with the turn's context, and the MCP server or host configuration
  behind it is live, so a turn's second call could be decided against a definition
  its listing never published. The resolved registry is now held for the turn on
  the authority lease ADR 0010 already opens, keyed by the same `turnAuthorityKey`;
  an operation with no lease resolves its own, which is a turn of one operation
  (ADR 0026, `docs/adr/0026-catalogue-resolved-once-per-turn.md`).

  What the turn holds is the unfiltered registry, not a decision. `canDiscover`
  and the invocation check still run per operation against authority resolved at
  `context.now`, so a grant that expires part-way through a turn still refuses
  part-way through it (ADR 0016), and `updateToolNamespaces` still takes effect
  within the turn it is called in.

  **What a host has to update.** A `ContextToolProvider` is called once per turn
  rather than once per operation, so a provider written to return different tools
  as a turn proceeds no longer changes what that turn is answered from — that
  window is the one this closes. A provider that branches on
  `enabledToolNamespaces` reads the value the turn resolved with rather than the
  current operation's, because the lease key deliberately excludes that field;
  `ContextToolProvider`'s own documentation now states both. A provider that is
  slow, remote or rate-limited is called once a turn instead of once a call.
  A provider returning freshly constructed `ToolHandler`s gets one set per turn
  rather than one per operation, so a handler carrying state between its own
  `resolveRequirement` and `invoke` must key that state on the call it was given
  and not hold it on the handler: the turn's concurrent calls now share the
  instance. SharedOS's own message-request handler was written the other way and
  has been corrected.

  A new conformance case grades it. In `catalogue-moved-mid-turn` a provider
  publishes a tool for the turn's listing and then moves its declared capability
  onto an action no grant carries. The call made after the move succeeds in all
  six columns with this decision and fails in all six without it, and the same
  tool aimed outside the granted tree is still denied `no_matching_grant` — what
  the turn holds is the catalogue, not the decision. The manifest goes to 32 rows
  and 165 passing cells, and the case-set, world-set and prompt-set hashes move
  with it.

  Resolving the catalogue reads 14.3 µs against 1.33 ms, under 1% of a mediated
  call against 45%, and one whole call 968 µs against 2.44 ms.

### Added

- **The shipped runtimes tell the model where it may operate.**
  `RuntimeVisibleContext.reach` was handed to every runtime and read by none, so a
  model still searched from the root and collected denials, which is the problem
  the field was added to end. `describeReach`, exported from
  `@aicoo/sharedos-runtime`, renders the result as words: each entry as its
  namespace, its path as the JSON array a `path` argument takes, and whether it
  covers what lies beneath; an empty reach as "nowhere"; an `unavailable` one as
  exactly that, with its reason code, so "unknown" never reads as "nothing" (ADR
  0021). `ModelDriver` sends it as a system message ahead of the prompt, and
  `createMcpHarnessRuntime` hands it to the harness as the MCP server's initialize
  instructions, with the host's own `instructions` string placed before it. Both
  are overridable: `ModelDriverOptions.instructions` is a function of the turn
  request, `McpHarnessRuntimeOptions.instructions` now also accepts one, and
  returning `undefined` sends nothing. A host writing its own driver can call
  `describeReach` and say the same thing the same way.

  **What a host has to update.** A model transcript or a test that pinned the
  first message to the prompt now sees a system message before it. A harness that
  does not surface MCP instructions shows its model the catalogue alone, which is
  what it saw before.

- **Every `AuditEvent` carries an `id`.** A record's identity was its content: the
  kernel stamps `at` from the turn's `AccessContext.now`, a bare `authorize` carries
  no `operationId`, and nothing else on the record distinguishes one emission from
  the next, so the same question asked twice in one turn produced two byte-identical
  records. A sink that deduplicated on a content hash -- the natural idempotency key
  when the record offers no other -- kept one and dropped the rest; an end-to-end run
  over 1,444 host decision records lost more than a quarter of them that way. The
  id is minted when the event is made, a random UUID by default, and
  `SharedOSKernelOptions.createAuditId` supplies a deterministic one for a replayed
  fixture. `auditEvent` and `autoDecisionAuditEvent` take the same factory as a
  trailing argument.

  **A sink that deduplicates keys on `id`.** A content hash is still the right
  fallback for a record written before this field existed, and only for one.
  `at` is unchanged and still the turn's instant: two records with one `at` are
  one turn's work, not one record, and their order within the turn is the order
  the sink received them.

- **A model client can name its reasoning mode, and the turn records it.**
  `OpenAiCompatibleModelClientOptions.thinking` sends DeepSeek's `thinking`
  request field, `enabled` or `disabled`. It is opt-in: the field is not part of
  the OpenAI wire shape and a provider that does not know it rejects the request,
  so nothing is sent until a host asks. A mode is a configuration rather than a
  model, so `ModelClient` gains an optional `settings` object — what the client
  sends beyond the model name — and `ModelDriver` records it on every turn as
  `modelSettings` beside `model`, `modelProvider` and `requestedModel`. A host
  with its own `ModelClient` may leave `settings` undefined and sees no change.

- **A turn records what the seat was told, and the manifest names it per column.**
  The catalogue a model was served has carried a hash on every record since the
  MCP bridge existed; the prompt it was given carried none, so rewording it moved
  nothing on disk, and a cell that moved between two runs could not be told apart
  from the model changing its mind. One sentence about what the tool-call channel
  carries took five `not exercised` cells to none on the same model, and neither
  run said it had asked a different question. Both shipped runtimes now compute
  `promptHash` before the seat is sent anything, over the same two texts in the
  same shape — `{instructions, prompt}` in canonical JSON, `instructions` being
  the reach as `ModelDriver`'s system message or as `createMcpHarnessRuntime`'s
  initialize instructions, `null` when the host sends none — and it lands in
  `SystemIdentity.promptHash` beside `catalogHash`. The conformance manifest folds
  each column's per-turn hashes, in row order, into `promptSetHash` on the column
  entry, so the committed manifest pins the question the Standard column is asked
  and `conformance:check` moves when the wording does. Columns that hand the seat
  no text — the adversary, a vendor column driven by written frames — carry none.
  The live scripts print it beside the model. It covers what SharedOS said: a
  CLI's own system prompt is added on the far side of the wire and is not claimed.

  **What a host has to update.** Nothing. `promptHash` and `promptSetHash` are
  optional additions. A host comparing two live runs of one column should now
  hold `promptSetHash` equal along with the case-set and world-set hashes before
  reading a moved cell as the model's choice.

- **`tool.invoked` names the catalogue its turn was served.** `catalogHash` was
  recorded on `tool.catalog.listed` and on no other event, so "every call in this
  turn was answered against the catalogue that was listed" was a claim in a source
  comment rather than something a reader of the trail could check. The kernel now
  holds the listing's hash beside the resolution it identifies and puts it in
  `tool.invoked`'s metadata, on the refused calls as well as the served ones. A
  turn that never listed leaves the field off rather than inventing one, so its
  absence reads as "no catalogue was published to this turn" and never as "a
  different one".

  **A reader joins the two events on the value.** Time order was the only
  inference available before, and is no longer needed.

### Changed

- **A string-carrying adapter reads tool arguments without the recursive schema.**
  Codex, DeepSeek and the native harness's driver each carry a call's arguments as
  a JSON-encoded string, and `parseToolArguments` parsed it and then ran the result
  through `JsonObjectSchema`, which tries every branch of the value union at every
  node. That pass was most of what those three spent per call: 118–130 µs against
  the 13 µs of Pi and Claude Code, whose frames carry the object already parsed.
  The parsed value is now read by a walk that checks only where the parser's output
  and the schema's verdict part — a number literal that overflowed to an infinity
  is refused, a `"__proto__"` key is dropped at every depth — and hands the value
  back as it was otherwise. The verdict and the value are the schema's, blob for
  blob, and a test holds them to it. In `docs/conformance/systems-cost.md` the
  translate rows read Standard 11.7 µs, Codex 4.97 µs and DeepSeek 15 µs on the
  reference machine, from 128, 118 and 130. The kernel's own `JsonObjectSchema`
  pass over every call's arguments is unchanged.

- **The kernel reads a tool parser's return value without the recursive schema.**
  Every registered tool's `parseArguments` runs before authorization, and what it
  returns is the call the kernel carries forward — into `resolveRequirement`, the
  decision, `invoke` and the audit record. The kernel held that value to
  `JsonObjectSchema` so a parser that handed back a Date, a Map, an `undefined`
  field or a non-finite number was refused as `invalid_tool_arguments` and the
  call stayed a plain JSON object. It still is, by a walk that gives the schema's
  verdict rule for rule — finite numbers only; `undefined`, bigints, symbols and
  functions refused wherever they sit; Dates, Maps, Sets and thenables refused
  where an object was expected; every other object read as a record of the keys
  `for...in` reaches, into a fresh plain object with a `"__proto__"` key dropped at
  every depth — and a test holds the two to each other over forty-nine shapes. The
  refusal code, its place before authorization and the `structuredClone` that
  follows are unchanged; the schema's own copy of every container, made before
  the clone made another, is what goes. On the reference machine the check and
  the clone together read 6.4 µs per call, from 155.

- **The live conformance prompt says what the model seat's channel does, and
  stops labelling the arguments.** A live model in the Standard column skipped
  every call to a name absent from its tool list and reported it as refused
  without making it, because it believed the function-calling channel carries
  only defined names; the hidden-tool, rollback-unavailable, broker-ungranted,
  escalation and record-completeness rows were `not exercised` in most runs
  without the kernel being asked. `MovePromptOptions.unknownNamesReachKernel`
  adds one sentence saying the channel accepts any name and the kernel refuses it
  there; the two model columns pass it, and no other column does, because an MCP
  client's own router refuses an unlisted name before it is sent. Each call now
  reads "with {...}" rather than "with arguments: {...}": the label led the model
  to nest every call's arguments under an `arguments` key, which the kernel fails
  as `invalid_tool_arguments`, and a control failed that way is a row that proved
  nothing. Over the full set on deepseek-v4-flash, twice each: 5 and 4
  `not exercised` before, 0 and 1 after. `promptSetHash`, now added above, covers
  the prompt, and the Standard column's entry in the committed manifest pins this
  wording.

- **`pnpm conformance:native` runs its model column with reasoning off.** The
  column measures whether a call reaches the kernel and how the kernel answers,
  not how the model deliberates, and with reasoning on deepseek-v4-flash spent up
  to its whole 4,096-token reply budget on the test prompt before its first call,
  failing the turn under `model_output_truncated` with nothing attempted. The
  default is now `thinking: disabled`; `SHAREDOS_MODEL_THINKING=enabled` restores
  reasoning and `provider` sends no such field. The mode is in the column's label
  — `Standard (deepseek-v4-flash, thinking off)` — in the availability entry, and
  in every turn's `modelSettings`, so a run in one mode is never read as a run in
  the other. A full run takes two minutes instead of four to five.

- **The kernel copies its tool registry instead of rebuilding it per call.**
  `listTools`, `listToolNamespaces`, `updateToolNamespaces` and `invokeTool` each
  resolve the effective catalogue, and resolving it meant constructing a fresh
  `ToolRegistry` and re-`register`ing every static handler: a
  `ToolDefinitionSchema.safeParse`, a `JSON.parse(JSON.stringify(...))` clone and
  a deep freeze per tool, over definitions `register` had already parsed, cloned
  and frozen once, arriving each time at a value guaranteed equal to the one it
  started from. The price grew with the catalogue, so when the conformance world
  moved to the shipped file vocabulary — five published tools to seventeen —
  catalogue resolution went with it, to 79% of one mediated call. `ToolRegistry`
  gains `copy()`, which shares the registered entries, and the kernel resolves
  from that. In `docs/conformance/systems-cost.md` resolving the catalogue reads
  1.33 ms against 6.99, and one whole mediated call 2.44 ms against 8.23, on the
  reference machine.

  What the catalogue contains does not change, `catalogHash` with it, and neither
  do the two properties the rebuild was carrying: a `ContextToolProvider` offering
  a name a host already registered still fails closed on the duplicate, and a
  registry a host passes as `options.tools` is still never mutated by the call
  that adds context-supplied tools beside it. A third property the rebuild had
  been carrying silently is now explicit: `register` freezes the entry, not only
  the definition inside it, because two registries sharing a mutable entry would
  let an assignment through one of them change what the other serves. Host code
  that wrote to a registered handler was reaching into kernel state and now
  raises a `TypeError`. The message-request tool is still
  constructed per call, because its handler holds the envelope it prepared between
  `resolveRequirement` and `invoke` and one instance per call is what keeps that
  state from being shared by concurrent calls.

- **Registering a tool reads its JSON Schema without the recursive value schema.**
  `ToolRegistry.register` held every definition to `ToolDefinitionSchema`, whose
  `inputSchema`, `outputSchema` and `metadata` are `JsonObjectSchema` — a union
  tried at every branch of every node. On the shipped `messages.request`
  definition, whose `inputSchema` is a nested `oneOf`, deciding that its JSON
  Schema is JSON cost 1244 µs of a 1302 µs parse: 93% of the 1340 µs the
  registration took. Those three fields are now read by the same single-pass walk
  the kernel already uses for a tool parser's return value, and the schema is
  shown an empty object where each one was, so it still decides which fields are
  required, which are optional and which are unknown, and it still decides every
  other field itself. The walk's verdict is held to `JsonObjectSchema`'s over
  forty-nine shapes, and `register`'s whole result to what it produced before over
  thirty more in each of the three fields.

  The walk parses a copy of the definition, so it is taken only where the copy
  cannot say something different from the original: a plain-prototype object
  whose own properties are all enumerable data properties, with
  `Object.prototype` unpolluted. A definition that inherits a field, hides one
  behind a non-enumerable descriptor or a getter, or arrives carried by an array
  or a `Date`, goes to the schema exactly as it was passed — the path this
  replaced, unchanged — because a spread would drop what `z.object` reads
  through the prototype chain and what `.strict()` collects with `for...in`.
  Whether a definition is accepted, and what it holds once registered, is
  therefore the same as before for every definition, not only for the common
  ones.

  Registering `messages.request` reads 70 µs against 1340, and the conformance
  world's nineteen definitions 723 µs against 7334. Since a catalogue is resolved
  once per turn this is a per-turn cost, paid where the turn's catalogue is
  derived, so `docs/conformance/systems-cost.md` — every figure in which is a span
  inside one mediated call — is unchanged and cannot show it.

  Nothing a definition holds changes. The JSON round trip that follows the schema
  is kept over the whole definition rather than left to the copy the walk makes,
  because it is the only step that normalizes `-0` to `0`, and a registration that
  quietly stopped doing that would hold a different value.

## 0.1.0-alpha.4

### Changed — breaking

- **`tool.catalog.listed` no longer lists tool names.** Its `metadata` carried
  `visibleTools`, one name per tool the listing returned. It is gone. The event
  now records what the listing was computed from and what it came to, as
  identifiers and a count: `catalogHash`, the catalogue the caller was shown,
  computed exactly as `listPublishedTools` computes it so an execution's
  manifest and the audit record match on one value; `enabledNamespaces`, the
  caller's own filter; `hostPolicyVersion`, the version the turn's
  `PolicySource` stated, when one loaded; and `withheldCount`. `authorityHash`
  stays at the top level. `failClosed: true` now also appears on a `succeeded`
  listing when at least one tool was withheld by an outage rather than by a
  decision, which the count alone could not say.

  **A consumer reading `visibleTools` from audit rebuilds from the identifiers
  instead.** The names a listing returned are what
  `listPublishedTools` returned, and `catalogHash` says whether two listings
  returned the same ones; an attempted call on a withheld tool is still
  recorded on `tool.invoked` with its own `cause`. ADR 0023 records the shape.

- **`requiredCapability` on a denial is now `requiredAuthority`, and `Escalation.request`
  is now `requestedAuthority`.** 0.1.0-alpha.3 shipped `AuthorizationDecision.requiredCapability`,
  the `CapabilityRequest` a `no_matching_grant` denial describes, and `Escalation.request`, with
  `EscalationOptions.request` carrying one into `SharedOSKernel.recordEscalation`. Both are
  renamed: one concept in two roles, each ending in the noun this repository uses for what grants
  confer — and not `requiredCapability`, because `ToolDefinition.requiredCapability` already means
  something else in the same package, a bare `CapabilityRequirement` rather than the fuller
  `CapabilityRequest` these carry, and it is the field a reader meets first. What they carry is
  unchanged: a description and not an offer, minted from the trusted context, granting nothing.
  `AuditEvent` gains a top-level `requestedAuthority`, written on `escalation.requested` when the
  escalation named a capability. ADR 0019 is rewritten around the new names.

  **A host reading `requiredCapability` off a decision, or passing `request` to
  `recordEscalation`, renames both; a consumer of audit events admits `requestedAuthority`.** The
  schemas are `.strict()`, so nothing here is additive for a reader: a consumer built against
  alpha.3 rejects `requestedAuthority` on an `ExecutionResult`'s escalation as an unknown key
  rather than ignoring it, and surfaces a malformed-response error with nothing to explain it.
  Upgrade every consumer of these types in step with the host that writes them.
  `ProtocolVersionSchema` is deliberately left at `"1"`: it is one literal shared by
  `ExecutionRequest`, `ExecutionEvent`, `ExecutionResult`, `MessageEnvelope`, and
  `RuntimeManifest`, so moving it would re-stamp four objects that did not change in order to
  signal one renamed field on a fifth. The bump rides the next release with its own reason to
  move; `docs/open-items.md` holds the row, and ADR 0019 records the decision and the failure mode
  it accepts.

- **A host ceiling is consulted per candidate grant, before consumption, and its audit flag
  moves to `authority.resolved`.** 0.1.0-alpha.3 installed `hostCeiling` on
  `CapabilityAuthorizer` and consulted it once, on the decision a grant had already produced: a
  policy refusal had spent a `maxUses` grant by the time it was refused, and a second grant that
  policy would have allowed was never tried. It is now consulted per matching grant and before
  consumption. A refused call does not spend the grant, a refusal ends that grant's candidacy
  rather than the decision, and when nothing is left the reason follows a fixed precedence: the
  fail-closed delegation denials, then `host_policy_denied`, then `grant_exhausted`, then
  `no_matching_grant`. Discovery consults the same port, so a catalogue is never offered on
  authority invocation would refuse.

  `narrow` gains a fourth argument, `policy`, the value the turn's `PolicySource` loaded (under
  _Added_); a ceiling written against alpha.3 still compiles and runs, since the parameter is
  trailing and admits `undefined`. A throw from `narrow` is reported to the new
  `CapabilityAuthorizerOptions.onProviderError` as `kind: "policy"` — the same shape
  `SharedOSKernelOptions.onProviderError` takes, declared on the authorizer because that is where
  the ceiling is installed; pass one function to both. A malformed return — an `async narrow`, or
  a branch that falls off the end, both yield something whose `allowed` is `undefined` — fails
  closed as `host_policy_unavailable` rather than being read as a denial, and a refusal whose
  `reasonCode` is anything but `host_policy_denied` has it replaced, so a ceiling cannot re-emit
  the misattribution the separate code ends.

  **Audit record:** the `hostCeiling: true` key alpha.3 wrote on `authorization.checked` when a
  ceiling was installed is gone from that event. Every `authority.resolved` event now carries
  `hostCeiling: "installed" | "absent"` and `hostPolicy: "loaded" | "unavailable" | "absent"`,
  where `absent` means no source is installed. A host comparing either event's `metadata` with
  `toEqual` sees the change. The manifest gains a `host-policy-denied` row, passing in all six
  columns: a grant covers the frozen path, so the refusal that would otherwise read
  `no_matching_grant` reads `host_policy_denied`, and the same ceiling withholds every mutation
  tool from discovery, so the row also asserts that what the ceiling refuses at invocation is
  absent from the catalogue. Both boundaries appear in one cell, `envelope` and `kernel`.

### Changed — behaviour

- **`authorization.checked` now carries the decision's own metadata.** Until now
  the event's `metadata` held only the two keys the kernel states, `consumed` and
  `failClosed`, and alpha.3's `hostCeiling` flag, which moves to `authority.resolved` (under
  _Changed — breaking_). It now also carries whatever the decision carried: a
  `HostCeiling`'s own keys, and — new to audit, though it has existed on the
  decision all along — the `delegation` detail (`code` and `grantId`) behind a
  `delegation_chain_invalid` or `delegation_chain_unverified` denial. Hosts
  persist audit events under closed schemas of their own, so this is a change to
  record. The kernel's two keys are stripped from the decision's copy rather than
  overwritten, so no port can set them.

- **`GrantSource` returns the grants the actor holds and applies no policy.**
  The host guide previously instructed the opposite — apply the ceiling in the
  source, by not returning the grant it forbids. That is the one refusal path
  that misreports itself: the kernel records `no_matching_grant` while the grant
  sits in the store. Policy moves to the `HostCeiling` above. Nothing in the code
  enforces this, and nothing can — SharedOS never sees what a source withheld —
  so it is a contract, and the `hostCeiling` flag on every authority load is the
  most a reader gets: it says whether a policy port exists, not whether the
  source stopped filtering.

  The trade is worth stating: `AuthoritySnapshot.hash` now identifies _authority
  held_, not authority usable. A snapshot may list grants a ceiling will refuse,
  so an auditor reading one alone overstates what a turn could do and has to read
  the decisions as well.

- The conformance judge is at version 4: a row graded on how the turn ended
  is no longer failed when the delegate never asked for that ending. For an
  `escalate` terminal the ending is elected by the delegate, and a live column
  is a real model that may answer the prompt and stop; version 3 reported that
  choice as a SharedOS failure, and asymmetrically -- a column that issued
  nothing at all was already `not exercised` on the control guard, so the more
  cooperative column graded worse for the same behaviour. The judge now reads
  the ask from the record: `sharedos.escalate` among the operations (a delegate
  that did not recognise the name and forwarded the call) or the new
  `escalation.asked` runtime event (one that did). Neither trace grades
  `not exercised` and says so in the cell; either trace with an unmet ending is
  still `fail`. Only the `escalate` terminal is treated this way. No scripted
  cell moves, and the case-set and world-set hashes are unchanged; artifacts
  graded under version 3 and version 4 are not cell-comparable on the
  escalation row.

- **The ask is announced before the turn ends on it.** Every path that honours
  `sharedos.escalate` ends the turn without forwarding the call, so a working
  ask left no operation in the record -- and neither would one the envelope
  then failed to honour. The standard loop, the MCP latch and the conformance
  adversary now emit `escalation.asked` through `RuntimeHost.emit` the moment
  the affordance is recognised, carrying the tool name and reason; it lands in
  the record as a `runtime.event` whatever the turn then does. Announcing is
  for the record only: a host that will not take the event does not change
  what the delegate decided. It is the delegate's own claim and can only make
  a row grade harder, never credit a pass. Distinct from the kernel's
  `escalation.requested` audit event, which records an escalation the envelope
  honoured. Additive; a host reading `runtime.event` sees one more type.

### Added

- **The native harness's translation cost is measured, and its layer can be
  read on its own.** `pnpm bench` now prices the model driver's
  parse-and-translate per call beside the four vendor adapters', through the
  driver's own functions rather than a copy: `decodeChatCompletion`,
  `encodeModelMessage`, `readModelToolCall` and `modelToolResultMessage` are
  exported from `@aicoo/sharedos-adapters`, extracted unchanged from
  `ModelClient` and `ModelDriver`, and `ToolNameCodec` accepts any `{ name }`
  list. `docs/conformance/systems-cost.md` gains a `model.chat-completions`
  row, 123 µs per call on the reference machine, where it read _not measured_.
  Additive for a host; nothing the driver does on a turn changed.

- **A turn is told where it may operate, and a remote caller can ask.**
  `SharedOSKernel.reach(context)` answers the turn's own reach: the namespace,
  path, actions and scope of every place some grant would authorize something at
  this instant, with no grant id, issuer, expiry or budget -- the derivation
  `readAgentCard` performs for a subject, pointed at the caller. The execution
  envelope reads it once per turn and hands it to the runtime as
  `RuntimeVisibleContext.reach`, narrowed by `reachThroughTools` to the
  namespaces the turn's catalogue operates on, so a driver can tell a model where
  to look without the host reading raw grants to write a prompt. `ReachResult`
  moves to `@aicoo/sharedos-contracts` as a schema and gains
  `authority_unavailable` beside `usage_store_unavailable`; a reach that cannot
  be established is handed to the runtime as `unavailable` rather than as an
  empty list, and the turn still runs -- a call that depends on the unreadable
  budget fails closed on its own, as before. `GET /v1/reach` and
  `SharedOSClient.reach()` serve the same answer to a caller driving its own
  loop over the API. **Host note:** `TurnKernel` now requires `reach`; a host
  passing `SharedOSKernel` is unaffected, a narrow test double adds one member.
  The narrowing is keyed on the resource namespace a tool requires a capability
  over, not on `enabledToolNamespaces`, because tool namespaces and resource
  namespaces are different vocabularies (`messages` operates on
  `sharedos.messaging`) and the resource plane is not gated by tool namespaces;
  the kernel's answer and the HTTP route are therefore grant reach, unfiltered.
  ADR 0021 records the decisions; PRs #12 and #13 are superseded.

- **A conformance row for the route lease.** `route-lease-revoked` sends twice
  on one turn's authority with the host's route lease revoked between the
  dispatches, so a send the kernel authorized is refused at delivery and
  terminates rather than delivering. See ADR 0025.

- **`@aicoo/sharedos-precedent` decides whether an auto-decision may stand in for a person.** A new opt-in package: `PrecedentKey` and `precedentKeyDigest` give the mechanism a typed key instead of a string-encoded one, `PrecedentLookup` keeps the rows host-side, and `admitAutoDecision` applies ADR 0022's R1-R4 to a proposal a host's matcher already made. It never widens: a refusal carries no width to read, R2 reuses `capabilityIsWithin` (now exported from `@aicoo/sharedos-core`), R3 takes the tightest envelope with `delegationDepth: 0`, and R4 marks every decision so a matcher's whole output can be revoked at once. Nothing here is an `AuthorizationDecision`, and `escalation.auto_decided` joins `AuditEventType`.

- **One ordering for a constraint envelope.** `tightestConstraints` and
  `constraintsAreWithin` in `@aicoo/sharedos-core` are the meet and the
  containment check over `purposes`, `notBefore`, and `expiresAt`. Delegation's
  attenuation and derivation checks and precedent R3 all read the same one, so
  the three places that each spelled it out cannot drift. One alignment falls
  out: a present timestamp that does not parse now violates its field on either
  side, where attenuation previously ignored a malformed child bound beneath an
  unbounded parent.

- **SharedOS can describe an agent, not only address and authorize one.**
  `SharedOSKernel.readAgentCard(context, subject, { view })` serves a card made
  of identity and computed reach and nothing else. Reach is derived at read
  time, by `CapabilityAuthorizer.reach`, from the grants in force at that
  instant, and is never stored: a stored reach is the one description of
  authority nothing invalidates, because revocation, purpose withdrawal, expiry
  and a spent budget all work by not matching at the next decision. Reading a
  card is itself authorized over `sharedos` / `["directory", <subject>]` /
  `read` (`agentCardCapability`, `directoryCapability`); without that gate the
  directory answers "does this agent exist", and through reach "what resources
  exist and where", in one call rather than one refusal at a time. Nothing is
  consumed, and the subject's grants are not loaded until a reader has been
  authorized to ask about that subject. A card is a view rather than a record:
  `identity` and `namespaces` are narrower resources beneath the subject's own
  path, so a less-authorized reader is served a narrower card and is told which
  views it may still ask for. The card carries no grant id, issuer, expiry or
  budget, and no display name, avatar or skill -- a host composes those around
  it. Reach is grant reach: the host ceiling is not consulted, so a card can name
  a path product policy refuses, and the refusal names the ceiling. A bounded
  grant whose usage store is missing or throws refuses the card
  `usage_store_unavailable` rather than narrowing it (`CapabilityAuthorizer.reach`
  answers a `ReachResult`, a contract type in `@aicoo/sharedos-contracts`); a
  spent budget still omits the grant. **Host note:** a `GrantSource` is now called with a context whose actor is
  not the caller, so one that reads an ambient session user instead of
  `context.actor` answers with the wrong principal's grants; SharedOS refuses
  such a card as `grant_scope_mismatch` rather than serving it, but a source
  that filters by session and returns nothing understates silently. See ADR 0021.

- **Every refusal reaches audit, and the record names the boundary that made
  it.** The execution envelope made no audit call of its own: a tool name the
  turn's catalogue never offered, a spent step or tool-call budget, a context
  mismatch, and how a turn ended existed only in `ExecutionResult.events` — a
  required field hosts pay for on the wire whose every consumer in this
  repository is the conformance package. A host with an audit sink could not see
  the clearest attempted violation the system produces (ADR 0023).

  `AuditEventType` gains one value, `turn.ended`: one event per turn, at the
  terminal, carrying the outcome and reason. Not one per transition — that would
  triple the audit volume of every successful turn to say nothing more, and a
  `turn.denied` would double-count against the `authorization.checked` admission
  already produced. A cancelled turn is `failed` with reason `turn_cancelled`;
  `AuditOutcome` is unchanged. `SharedOSKernel` gains `recordTurnEnd` and
  `recordRefusedCall`, and the envelope calls them through the same optional
  `TurnKernel` members `recordEscalation` already uses, so **hosts wire
  nothing new** — a second `AuditSink` option would be one a host can forget to
  pass twice, and the failure mode of forgetting is a turn that enforces
  correctly and records nothing.

  Two `metadata` keys carry the rest. `source` is `kernel` or `envelope` on every
  operation and terminal event; it is required by the change rather than
  incidental, because the rule "it is in audit, therefore the kernel refused it"
  held only while the envelope recorded nothing. `cause` disambiguates
  `tool_unavailable` — `not_registered`, `namespace_disabled`, the discovery
  decision's own code, or `not_offered` from the envelope — while `reason` stays
  the code the caller was given, so one refusal keeps one name. `errors.md` has
  promised that disambiguation all along and delivered it for one of the three
  situations; it now holds for all of them, including a policy refusal, which
  could otherwise only ever appear on a decision event.

  `tool.catalog.listed` gains `withheldCount`, with `failClosed: true` when what
  it withheld, it withheld by an outage. Discovery refusals had no code on
  either side before — the caller is not told and the record said nothing
  either. The listing's other new keys are under _Changed — breaking_.

  Kept out deliberately: the MCP transport's `unauthorized` refusal, which
  happens before an `AccessContext` exists and would need a fabricated principal
  to record; the thrown error behind any refusal, which stays on the diagnostic
  hooks; payloads, unchanged; and the parser detail behind
  `invalid_tool_arguments`, which quotes the value that failed.

- **The ceiling's policy can be loaded per turn, beside the grant set.**
  `SharedOSKernelOptions.policySource` installs a `PolicySource`, one
  asynchronous `load(context, signal)` the kernel calls once per turn, in flight
  beside the grant load, and holds on the turn's authority lease as
  `ResolvedAuthority.hostPolicy`. It resolves to a `LoadedPolicy`,
  `{ policy, version }`. `HostCeiling.narrow` gains a fourth argument, `policy`,
  which is the `policy` that source loaded — exactly as loaded, not cloned or
  validated, because SharedOS does not know its shape and reads nothing from it
  — and is `undefined` when no source is installed, so a ceiling that closes
  over its own state is unchanged. `HostCeiling<Policy>` and
  `PolicySource<Policy>` take the type as a parameter for the host's own
  documentation; the pairing is not checked. This is the second port ADR 0020
  defined, and the reason the synchronous signature can serve a policy that
  lives in a database: it is read once at the turn boundary, the way authority
  is, and never on the authorization path.

  `version` is the one thing about a policy SharedOS reads: the source's own
  name for what it loaded — a revision, an etag, the hash of the table it read —
  recorded as `hostPolicyVersion` on every `tool.catalog.listed` event in the
  turn, beside `authorityHash`. An opaque value has no canonical form to hash,
  and the record needs to pin a catalogue to the policy state it was decided
  against, so the source says.

  It fails closed the way the grant source does. A throw, or a result that is
  not a `LoadedPolicy`, is reported once to
  `SharedOSKernelOptions.onProviderError` as `kind: "policy"` and the turn's
  policy is held `unavailable` for its whole length: every decision the ceiling
  would have been consulted on is refused `host_policy_unavailable` without
  `narrow` being called, on both paths and before any bounded use is consumed.
  A kernel with no ceiling ignores it. A cancelled load re-throws the abort.

  **Host notes.** Nothing changes for a host that installs no source. A
  `HostCeiling` written before this release still compiles and still runs: the
  new parameter is trailing and admits `undefined`. Every `authority.resolved`
  event gains `hostPolicy: "loaded" | "unavailable" | "absent"` beside
  `hostCeiling`, where `absent` means no source is installed; a host comparing
  that event's `metadata` with `toEqual` sees the new key. The `PolicySource`
  row leaves `docs/open-items.md`.

- **`SharedOSKernelOptions.onProviderError`**, so a contained throw is
  diagnosable. A provider, tool handler, transport, or router that throws is
  answered with a fixed reason code -- `tool_execution_failed`,
  `resource_execution_failed`, `message_delivery_failed`, and the four other
  codes the seven contained call sites return --
  and the error itself was discarded, so nothing said which provider broke or
  where. It now reaches this optional hook, whole and unwrapped, with a
  `ProviderErrorContext` naming the `kind` of port (`tool`, `tool_catalog`,
  `resource`, `message`), the `reasonCode` returned in its place, the trace and
  namespace, and whichever of `operationId`, `tool`, `resource`, and `action`
  that path has. One hook rather than one per port: `kind` is what a host
  branches on to route them differently, and a port added later is covered by
  the hook every host already installed. `reasonCode` is the same code audit
  recorded and the same one the agent was told, so a log line joins to both.

  Nothing reaches the wire: every message and audit event is unchanged, and a
  kernel with no hook installed takes the same decisions. The hook is
  observational -- one that throws is ignored -- and synchronous, unlike
  `onAuditError`, which is awaited because it fires after the side effect; this
  one fires mid-flight, where awaiting a host's logger would put its latency on
  every failed call. A cancelled operation is not reported.

  The one behavioural change: a `ContextToolProvider` whose `listTools` throws is
  still wrapped into one catalogue-failure sentence, but the provider's error is
  now that wrapper's `cause` rather than being destroyed. That is visible without
  the hook -- a logger or reporting SDK that walks `cause` will print the
  provider's message where it previously printed nothing -- so it is a change to
  what a host may see, not a no-op.

  Four symbols join the public surface of `@aicoo/sharedos-core`, and through it
  `@aicoo/sharedos`: `ProviderErrorContext`, `ProviderErrorKind`,
  `ProviderErrorReporter`, and `reportContainedError`. The last is the swallow
  guard itself, exported so `@aicoo/sharedos-runtime` and any host offering a
  hook of the same shape share one implementation of the promise rather than
  each making their own.

  Not covered, and stated so it is not mistaken for done: the four authority
  ports still discard theirs, and they are not equally bad. `GrantSource`,
  `GrantUsageStore`, and `DelegationChainResolver` fail closed under their own
  `failClosed` reason codes, so the failure is classified even though the cause
  is gone. `CapabilityGrantVerifier` is the one to watch: a throw from `verify`
  is treated as `false`, so the grant becomes invisible and the denial reads
  `no_matching_grant` -- indistinguishable from an actor who was never granted
  the capability, and not marked `failClosed`.

- **`onTurnError`**, on `SharedOSExecutorOptions` and `StandardRuntimeOptions`,
  so a contained throw is diagnosable. Both layers catch one and end the turn on
  a terminal code -- the envelope's `runtime_failed`, the standard loop's
  `driver_failed` -- and both discarded the error, leaving an operator a code and
  no stack. It is now handed to this optional hook, whole and unwrapped,
  alongside the turn's `executionId` and `traceId`; `TurnExecutor` forwards it to
  both, so one sink covers both. Nothing about the wire changes: each
  `ProtocolError.message` is the same fixed string, no event carries the throw,
  and a turn with no hook installed behaves exactly as before. The hook is
  observational -- one that throws is ignored -- and a cancelled turn does not
  reach it. Note that `runtime_failed` is also what a throw from
  `openTurnAuthority`, `admitTurn`, or `listTools` ends a turn as, so read the
  stack rather than the code to tell a plugin's failure from a host port's.

- A conformance row for a runtime plugin that throws out of its turn. The
  envelope contains the throw rather than letting it reach the host: the turn
  ends `failed` with `runtime_failed`, the `turn.failed` event names the
  envelope as what ended it, and the record still carries the call the turn
  made before it. The receipts survive only because the adversary emits them as
  they happen -- a crash carries no terminal metadata to return them on -- and
  the row pins that too. Only a plugin that owns its outcome can throw on
  purpose, so the row runs on the adversary column and every driven, MCP, and
  model column declares it `not applicable`. The case-set and world-set hashes
  move.

- **A `repo` resource namespace, beside `files`.** `createRepoTools` and
  `registerStandardOsTools(kernel, { files, repo })` publish `repo.status`,
  `repo.diff`, `repo.log`, `repo.stage`, and `repo.commit` over a host-owned Git
  provider. A `files` grant over a working tree grants nothing under `repo` and
  the reverse, so committing is authority a host issues rather than a
  consequence of file-write authority. See ADR 0024.

## 0.1.0-alpha.3

### Changed — breaking

- **The conformance manifest's reference column is renamed.** `EMBEDDED_COLUMN`
  is now `ADVERSARY_COLUMN`, with id `adversary-embedded` and label `Adversary`
  in place of `sharedos-embedded` / `Standard`. The column is unchanged — the
  scripted `HostileRuntime` in the seat, owning its outcome — and the rename
  says what it is: the reference adversary, not the harness SharedOS ships.
  `Standard` now names that harness (below). Code importing the old constant
  changes the name; a reader of `kernel-conformance.json`, or of a live
  artifact, matches the column on its new id.

- **`InMemoryGrantChainResolver` and `UnavailableGrantChainResolver` in
  `@aicoo/sharedos-testkit` are renamed** `InMemoryDelegationChainResolver` and
  `UnavailableDelegationChainResolver`, after the port they implement. The port
  was renamed from `GrantChainResolver` to `DelegationChainResolver` in this
  release and the fixtures kept the old name. Rename the import; nothing else
  changes.

- **Messages now have one policy-bound reason: `purpose`.** The redundant
  `MessageEnvelope.intent` field is removed, and strict parsing rejects legacy
  envelopes that still carry it. Outbound sends execute as their sender; an
  inbound turn executes as its recipient and resolves that recipient's
  execution, file, and tool authority independently. See ADR 0015.

- **`grants` is removed from `AccessContext`.** Authority now enters SharedOS
  through one required port, `GrantSource`, which `SharedOSKernel` calls once per
  turn. A context names who is asking, on whose authority, and for what; it
  carries no authority of its own, so nothing a caller assembles can become one.
  Resolved authority is a `ResolvedAuthority` wrapper that is deliberately not
  assignable to `AccessContext`, so grants cannot reach a provider, tool handler,
  transport, or runtime by accident. A source that throws, returns unparseable
  material, or answers outside the context's scope denies with
  `authority_unavailable` before anything else runs.
- **A derived grant names one parent, not a chain.** `CapabilityGrant.delegation`
  (`{ parentGrantId, depth, chain }`) is replaced by a single optional
  `parentGrantId`, and ancestors are re-resolved from the issuing store at every
  decision through a `DelegationChainResolver`. An embedded chain is provenance
  the presenter controls; re-resolution is what makes revocation mean something.
  `CapabilityAuthorizer({ chainResolver })` is now `{ delegationResolver }`, and
  `GrantChainResolver` is now `DelegationChainResolver` with `resolve` in place
  of `get`.
- **Delegation reason codes are renamed**, from `delegation_chain_unavailable` /
  `delegation_chain_broken` to `delegation_chain_unverified` /
  `delegation_chain_invalid`. The distinction is now load-bearing: unverified
  means SharedOS could not establish the chain, and is grouped with
  `authority_unavailable` and `usage_store_unavailable` in
  `INFRASTRUCTURE_DENIAL_REASONS`, whose audit records carry `failClosed: true`.
  Exclude them before computing any denial rate.
- **A bounded (`maxUses`) parent is refused at both boundaries**, as
  `bounded_parent_not_delegable`. Usage counters are per grant, so comparing a
  child's ceiling against its parent's reads as attenuation without bounding
  total consumption. `deriveGrant` already refused; the chain check now agrees.
- **`tool_not_available` is gone.** The execution envelope and the kernel emit
  one code for one refusal, `tool_unavailable`; which boundary refused is
  `OperationRecord.source`. An owner-crossing tool requirement is now `denied`
  with `invalid_request` rather than `failed` with `invalid_tool_requirement`.
- **`ExecutionResult` gains `escalated`**, a third terminal state carrying an
  `Escalation` and no `error`. Code that switched on `succeeded` / `failed` /
  `denied` / `cancelled` and reached for `.error` no longer compiles.
- `deriveGrant` drops two refusal reasons that could never fire
  (`namespace_mismatch`, `issuer_is_not_the_holder`) and adds three that can:
  `issued_before_parent`, `id_collides_with_parent`, and — on the issuing side
  only — a refusal to pin an owner onto an unowned parent capability.

- **Repository tooling, not a published contract.** `pnpm conformance:live` is
  now `pnpm conformance:native`, over `scripts/native-conformance.mjs`, writing
  `native-conformance.json` and reading `SHAREDOS_NATIVE_CONFIG`. "Live" named
  when a run happened rather than what it measured, and both live scripts drive
  a real model over a real wire; what separates this one is that each vendor CLI
  runs on its own stdio protocol, natively, where `mcp-conformance.mjs` reaches
  the same binaries through MCP. The column ids `codex-live` and `model-live`
  deliberately do not move: they are keys in artifacts already on disk.

  The script also takes `--config` and `--harness`, as the MCP one already did.
  Declaring `credentialVariables` makes the pinned key required, so a harness
  that cannot reach it reports unavailable instead of authenticating somewhere
  else -- on the operator's own subscription, say, producing a column that
  cannot be published beside the others.

### Changed — behaviour

- The conformance judge is at version 3: a failed turn that the envelope ended
  names `envelope` as its enforcement point, read from the `turn.failed`
  event's new `source`, where version 2 named a boundary for denied turns
  only. Statuses are graded as before; a manifest or artifact produced under
  version 2 differs from one under version 3 in that field alone.
- `turn.failed` carries `source` beside `code`: `envelope` when the envelope
  refused the runtime's outcome or the runtime threw, `runtime` when the
  envelope relayed a failure the runtime reported as its own. Additive; the
  event's shape is otherwise unchanged.
- A failure an adapter ends its turn with — `harness_*`, `model_*` — now carries
  `retryable: false` on the driver path as it already did on the MCP path; the
  field was simply absent before. Nothing an adapter fails on is retryable:
  asking the harness or the model again asks the same thing.

- `codexMcpConfig` now emits `default_tools_approval_mode = "approve"` beside
  `required = true`, the setting the conformance launch has always passed as an
  override. Codex's default `auto` mode asks a human before any tool that is not
  read-only; a run with no human then refuses every write inside Codex with the
  kernel never consulted. The approval is scoped to the SharedOS server, and what
  secures a call is the kernel re-authorizing it. A host that wants Codex's own
  prompt as well can override the key.
- The four MCP harness specs derive their server name from
  `SHAREDOS_MCP_SERVER_NAME` and, for Claude Code's `--allowedTools` and Codex's
  `-c` overrides, from the connection's `name`, instead of the literal
  `sharedos`; a spec given another `serverName` is now launched under it.
- **A grant that expires while a turn is running is now refused inside that
  turn**, at the next decision, rather than at the next turn. Revocation,
  purpose withdrawal, `issuedAt`, and `notBefore` are unchanged: they are still
  decided at the instant the turn's authority was resolved, and are still
  observed by the next turn. The rule separating them is directional — the
  operation's clock may only take authority away, never hand any back — so a
  turn still carries the grant set it was admitted with and can never gain more
  while it runs. An ancestor follows the same split. See ADR 0016.

  Nothing about a turn's authority load changes: no store is re-read,
  `cost.authorityLoads` stays at 1 per turn, and a decision an expiry refused
  names the same authority snapshot hash as the decision before it. Hosts
  issuing short-lived grants should expect them to stop working part-way through
  a long turn, which is what they asked for; hosts relying on a turn outliving
  its grants' validity windows must widen those windows.

  `CapabilityAuthorizer.authorize` and `canDiscover` take the operation instant
  as a new optional `now`, and `validateDelegationChain` takes the admission
  instant as a new optional `admittedAt`. Both default to the previous
  behaviour, so a host calling either directly is unaffected until it opts in.

### Added

- **The host ceiling is a port the kernel calls, not a convention hosts apply
  upstream.** `CapabilityAuthorizer({ hostCeiling })` installs a `HostCeiling`,
  one synchronous `narrow(decision, request, context)` consulted only after a
  grant has matched, on an already-`allowed` decision, on both the `authorize`
  and the `canDiscover` path -- so a tool a ceiling refuses at invocation is
  also absent from the catalogue. Step 10 of the permission model's
  authorization algorithm is now true of the code. It cannot widen anything: a
  denial is never shown to it, its allow arm is pinned to the decision it was
  handed, and an allow that does not carry the same `matchedGrantId` is a
  malfunction that fails closed. Its refusal is `host_policy_denied`, a policy
  denial in its own bucket -- not infrastructure, and not merged with
  `no_matching_grant`, which says no such authority exists. A throw is
  `host_policy_unavailable`, which joins `INFRASTRUCTURE_DENIAL_REASONS`. The
  synchronous signature is the enforcement of "deterministic and cheap": a
  synchronous return cannot await a network or model call. It is optional, and a
  kernel constructed without one behaves exactly as it did, down to the audit
  record; when one is installed the kernel records that, so a deployment that
  denies everything through policy is legible rather than reading as one where
  nobody was granted anything. ADR 0020's `PolicySource` is not implemented and
  carries a row in `docs/open-items.md`. Hosts applying a ceiling today keep the
  same logic and move the call site; withholding a grant instead still produces
  `no_matching_grant` and still misattributes the refusal.
- **A denial for want of a grant names the authority that would have satisfied
  it.** `AuthorizationDecision` gains an optional `requiredCapability`, a
  `CapabilityRequest` populated only on `no_matching_grant`, where the
  authorizer already holds every field: the resource and action the caller
  named, and the owner, namespace, purpose and instant from its own access
  context. It is a description and not an offer -- it grants nothing, no port
  accepts one back as authority, `allowed` stays `false`, and a host that
  ignores it behaves exactly as before. It is never built from anything a
  provider knows, so the same description is produced for a path that is absent
  and for one the actor cannot reach; it is not an existence oracle. The other
  denials deliberately carry none. See ADR 0019.
- **An escalation may carry the capability it is asking for.** `Escalation`
  gains an optional `request` and `SharedOSKernel.recordEscalation` accepts one
  through `EscalationOptions.request`, typically the `requiredCapability` a
  denial just described; the `escalation.requested` audit event records it, so a
  reviewer receives a capability instead of a sentence to reconstruct one from.
  `id`, `namespaceId`, `requester`, `owner`, and `requestedAt` are minted from
  the trusted context and overwrite whatever the caller supplied -- a request
  the caller authored would be a caller-chosen correlation for a decision the
  kernel made -- and `id` is derived from those fields rather than generated, so
  one ask describes itself the same way twice. Nothing else changes: there is no
  third decision value, no consent port, no queue, and no resumption;
  `Escalation.status` is still always `pending` and nothing inside SharedOS
  advances it. `CapabilityRequest` stops being a type with no port and leaves
  `docs/open-items.md`.
- **The native harness has a committed conformance column.** `Standard`
  (`MODEL_SCRIPTED_COLUMN`, id `model-scripted`) is `ModelRuntime` —
  `StandardRuntime` with the model driver in the seat and the
  permission-filtered catalogue rendered into the model's tool-call shape —
  with a transcript where the provider would be. `movesToModelTranscript`
  writes each declared attempt as a model reply in the wire alphabet a provider
  accepts, and the driver's real codec, argument parsing, escalation
  recognition, and step accounting read it back; what is left out is the model.
  It is graded under `modelLimits`, as the live model column is, so the shipped
  loop carries a driver's limits in a committed cell rather than standing in
  for the kernel it runs on: the inspection row and the ungranted-escalation
  row read `not applicable`, and the step-ceiling row `pass (driver)`. The
  manifest goes from five columns to six; every hash is unchanged, because
  neither the case set nor the world set moved.
- `TranscriptModelClient` in `@aicoo/sharedos-adapters`: a `ModelClient` that
  replays a supplied `ModelTranscript` through the real `ModelDriver`, the
  counterpart of `TranscriptTransport` for a vendor harness. A spent transcript
  fails the turn `model_call_failed` rather than completing on the recording's
  behalf, so a script that ends too early is a visible result and not a model
  choosing to stop.
- A conformance row for an escalation the turn was not granted. A runtime that
  ends its turn with `escalate` while the catalogue does not offer the
  affordance is refused by the envelope: the turn fails `tool_unavailable`,
  and nothing is recorded or audited. Only a plugin that owns its outcome can
  make the attempt, so the row runs on the adversary column and every driven,
  MCP, and model column declares it `not applicable` -- the first use of
  `ColumnLimits.unsupported`. The case-set and world-set hashes move.
- `DriverRuntime` in `@aicoo/sharedos-adapters`: the one implementation behind
  `HarnessRuntime` and `ModelRuntime`, which are now its two named forms. A host
  installing another driver under its own identity uses it directly.
- `escalationOffered(tools)` in `@aicoo/sharedos-runtime`: the catalogue gate on
  honouring `sharedos.escalate`, shared by the three adapters and the executor
  instead of each spelling the check.

- `canonicalActor` in `@aicoo/sharedos-mcp`: the one string form of an
  `Address` an execution token carries as `actor`, `<kind>:<id>`, from the same
  pair `addressPath` derives for a recipient-scoped grant. The form was
  described in a docblock example and defined nowhere.

- `MCP_HARNESS_IDS` in `@aicoo/sharedos-mcp`, the one list `McpHarnessId` is
  derived from, and `CODEX_HARNESS_ID`, `CLAUDE_CODE_HARNESS_ID`,
  `DEEPSEEK_HARNESS_ID`, `PI_HARNESS_ID` in `@aicoo/sharedos-adapters`: each
  adapter's manifest, requirements, and MCP spec now name the harness from one
  constant, checked against that list.
- `codexMcpServerSettings` in `@aicoo/sharedos-mcp`: the settings a Codex MCP
  server entry carries, as key and TOML value. `codexMcpConfig` renders it as a
  table and the Codex conformance launch passes it as `-c` overrides, so the two
  cannot disagree.
- **A denial now explains itself to the host.** The reason codes still collapse
  for the caller — `no_matching_grant` covers nine causes and
  `authority_unavailable` covers four, so that no caller can map the permission
  topology by reading refusals — but the operator who wired the store and issued
  the grant is not the caller. `authorization.checked` now carries
  `grantsResolved` and a `rejectedGrants` array naming every resolved grant and
  the first condition it failed (`issuer`, `subject`, `namespace`, `window`,
  `purpose`, `verifier`, `capability`, `delegation`, `exhausted`), and
  `authority.resolved` carries the same key for the three conditions checked
  before the grant loop runs. `usage_store_unavailable` and
  `delegation_chain_unverified` additionally carry
  `missingDependency: "usageStore" | "delegationResolver"`, which distinguishes
  a permission problem from a wiring one: a `maxUses` grant with no usage store,
  or a derived grant with no delegation resolver, denies every call it should
  have allowed and is otherwise indistinguishable from an absent grant.

  **Host notes.** Nothing is added to `AuthorizationDecision`, so no response
  body changes. `CapabilityAuthorizer` gains an optional
  `AuthorizeOptions.onExplain` callback for hosts that call it directly;
  `SharedOSKernel` supplies its own and needs no change. The `unavailable`
  variant of `AuthorityResolution` gains an optional `detail`, so a host that
  compares a resolution with `toEqual` rather than `toMatchObject` will see the
  new field. Discovery checks do not explain: catalog filtering denies on nearly
  every tool by design, and routing that through the record would bury the
  denials somebody was looking for.

- `messages.request`, a canonical recipient-scoped request/reply tool. The model
  supplies only a recipient and JSON-safe payload; trusted context supplies the
  sender, purpose, trace, timestamp, and message id. `MessageTransport` and
  `MessageRequestRouter` remain host ports for durable delivery and reply
  lookup—SharedOS does not own a queue, receiver wake-up, or scheduler. Direct
  send and the request tool share one post-authorization delivery path, so a
  bounded send grant is consumed exactly once.

- A quickstart with two working programs, an HTTP API reference covering every
  route and status code, a tool catalog covering the twelve `files` tools and
  how to register your own, and a reason/error code reference. None of this was
  documented outside the source before.
- A conformance suite: every kernel guarantee is an attempted violation run by a
  scripted adversary, graded per runtime, with the case set and the world it runs
  against hashed separately. `pnpm conformance` regenerates it.
- A conformance row for a validity window closing mid-turn, and the clock it
  needs. Nothing can expire during a turn when time does not move, so a
  condition may now arm `expiresAfterOperations`, which advances the world's
  clock one step per mediated operation — indexed on the operations the kernel
  recorded rather than on wall time, so repeats stay byte-identical. It is
  opt-in per condition and every other condition still runs on the frozen
  instant. The row is separate from `revoked-mid-turn` rather than a second
  condition on it, because the two make the identical call at the identical
  position and require opposite answers.
- Escalation as a recorded outcome, per-turn authority resolution, and one
  refusal vocabulary across both enforcement boundaries. See ADRs 0008–0013.
- `@aicoo/sharedos-mcp`: the permission-filtered catalogue served as an MCP
  server, which is the boundary a vendor harness actually connects to, plus
  Codex, Claude Code, DeepSeek Harness, and Pi adapters in
  `@aicoo/sharedos-adapters`. See ADR 0014.
- `ModelDriver` in `@aicoo/sharedos-adapters`: a model API in the delegate seat,
  with no vendor CLI between it and the envelope. `StandardRuntime` still owns
  the loop, still stops at `maxSteps`, and still re-authorizes every call; what
  changes is only who occupies the seat. Dotted SharedOS names are mapped per
  turn, from the catalogue rather than by guess, onto the `^[a-zA-Z0-9_-]+$` a
  chat-completions provider constrains function names to — and a name the map
  does not hold is passed through anyway, so a model that invents a tool
  outside its catalogue reaches the envelope to be refused instead of being
  filtered out where nothing records it. The provider's `finish_reason` and
  `usage` are read off every completion: a reply cut off at the output-token
  ceiling fails the turn as `model_output_truncated` rather than being graded
  as a decision the model finished making, and the turn's token spend reaches
  the execution record as `cost.inputTokens` / `cost.outputTokens`. A `fail`
  decision now carries `metadata` as `complete` does, so a failed turn keeps
  the model that answered and what it cost. A call whose arguments do not
  parse is refused by the driver as `invalid_tool_arguments` and answered back
  to the model, never sent as `{}` -- an empty object is a call the model did
  not make, and a tool with every parameter optional would have run it. The
  turn's metadata counts them as `malformedToolCalls`; past `maxMalformedCalls`
  (default 8) the turn fails as `model_malformed_call_limit_exceeded`.
- A `model-live` conformance column built on that driver, which separates what
  a model does from what a vendor's scaffolding makes it do — the axis every
  other live column confounds. It is an addition to the scripted column and
  never a replacement: a model chooses, so an attempt it declines leaves no
  operation and the cell reports not exercised rather than pass.
- Escalation as something the occupant of the delegate seat can ask for, rather
  than an outcome only a host-written runtime could reach. `AgentTurnDecision`
  gains an escalate variant, and the ask itself is published as
  `sharedos.escalate`: catalogued and permission-filtered like any other tool,
  invisible to an agent holding no grant over it, and never invoked -- a driver
  whose turn's catalogue offers it recognises the name and ends the turn on it,
  and a call naming it on a turn that was never granted it is passed through to
  be refused `tool_unavailable`. The envelope holds the same gate from outside:
  `SharedOSExecutor` fails a turn `tool_unavailable` when any runtime plugin
  returns `escalate` on a turn whose catalogue does not offer the affordance,
  recording nothing, since nothing reached the kernel. The reason is recorded
  as given, cut to the outcome's 512-character bound rather than replaced when
  it runs past it.
  Asking for a human is an affordance a host grants, so a host that publishes
  no escalation grant has agents that cannot ask. See ADR 0017.
- An optional `step` on `AgentTurnDecision.tool_call`. A driver that says
  nothing is bounded exactly as before; one that names a step is refused for it
  if the envelope disagrees, because declaring a step is a claim and not a
  permission. The claim reaches forward only: `StandardRuntime` refuses a step
  behind its own position as `invalid_driver_decision`. Below the ceiling the
  record carries the step as declared; who declared it is the conformance
  report's to say. See ADR 0017.
- The same ending over MCP, where the harness rather than SharedOS owns the
  loop. A `tools/call` for the escalation affordance is recognised before it
  becomes an operation: `EscalationLatch` wraps the one invoker every MCP call
  already passes through, answers the ask, and the turn settles as `escalate`
  once the harness has wound down. Calls made after the ask are refused in band
  as `denied` with `escalation_pending`, rather than by closing the bridge --
  closing it surfaces as a JSON-RPC internal error, which carries nothing about
  authority and which harnesses retry into a frame limit. The grant is checked
  first, so an agent without it gets `tool_unavailable`. See ADR 0018.
- `createEscalationTool()` in `@aicoo/sharedos-runtime`: the handler a host
  registers so `sharedos.escalate` is catalogued. The definition was exported
  and every host wrote the same failing handler by hand; the conformance world
  and the adapter tests now register this one. It is never meant to run -- a
  driver ends the turn on the name -- and fails with
  `escalation_not_terminated` if a driver forwards the call anyway.
- What enforcement costs, measured on both paths and reported in
  `docs/conformance/systems-cost.md`. `pnpm bench` regenerates it, against a
  monotonic clock added for the purpose — wall time is not a duration.
- `pnpm release:promote-latest <version>` moves the `latest` dist-tag across the
  whole package set in one command, refusing to act unless every package has
  published that version.

### Removed

- `release:check:private`, and the `--allow-private` flag on
  `scripts/release.mjs` behind it. The flag required every package to be
  `private: true` under an `UNLICENSED` license, the preparation state the
  packages left before `0.1.0-alpha.0` was published; with all eleven public
  and Apache-2.0, the command could only throw. `release:check` is the one
  release check.
- `MCP_HARNESSES` from `@aicoo/sharedos-adapters/node`. Nothing read it: the
  conformance script names the four specs it runs, and a host picks one.
- `strictToolPolicy` and `ListToolsParamsSchema` from `@aicoo/sharedos-mcp`.
  Neither had a caller; `declareToolPolicy({ mode: "strict" })` is what the
  helper built, and the `tools/list` handler takes no parameters.
- The `config.toml` the Codex conformance spec wrote into its temporary
  workspace. Codex reads `$CODEX_HOME/config.toml`, never the working
  directory, and the launch has always passed the connection as `-c`
  overrides, so the file was written and never read. `codexMcpConfig` stays,
  for a host that configures a persistent Codex.
- The MCP harness runtime's own `turn_cancelled` outcome. Under
  `SharedOSExecutor` it was unreachable -- the executor races the plugin
  against the signal, and its own `cancelled` result wins -- and it gave the
  code a second shape, `retryable: false` against the executor's `true`. A run
  whose signal is aborted now rejects with the signal's reason, as any aborted
  operation does; `docs/errors.md` no longer lists the code under Adapters.

### Fixed

- Catalogue comparability is compared per case and per column instead of pooled
  across a whole run. The check warned whenever a run had served more than one
  catalogue, which was right while a run served exactly one and wrong as soon as
  the tool set became permission-filtered per case. Two columns are comparable
  when each saw the same catalogue for the same case, so that is what is now
  checked, and the warning names the first case where two columns actually
  diverged. `catalogHashByCase` goes into the artifact beside the pooled list,
  because a pooled list cannot show a reader that two columns saw the same tools
  for the same row.

- Five embedded build constants — the DeepSeek, Pi, and MCP adapter versions
  among them — were left at `0.1.0-alpha.0` while their packages moved. They
  name the build that produced an execution record, so a stale one misattributes
  evidence. `release:check` guarded two of the seven and now guards all of them.
  An eighth, the version the MCP server reports in `initialize.serverInfo` when
  built without `serverInfo`, was still `0.1.0-alpha.0`; it is now
  `MCP_SERVER_VERSION`, exported from `@aicoo/sharedos-mcp` and guarded too.
- The publish order listed `@aicoo/sharedos-conformance` ahead of
  `@aicoo/sharedos-mcp` and `@aicoo/sharedos-adapters`, both of which it depends
  on, so a run that stopped part-way could leave it on the registry with
  unpublished dependencies. `scripts/package-set.mjs` is now in dependency
  order, `release:check` refuses an order that is not, and `test:release`
  checks the order against the manifests.
- `SharedOSClientOptions.token` and `SharedOSCallOptions.purpose` were
  undocumented: the HTTP reference listed only `headers`, and an earlier note
  here said `token` had never existed. Both have been there since the client was
  written. `token` is a value or an async function sent as a Bearer
  `authorization` header, `headers` carries anything else, and per-call
  `purpose` sets `x-sharedos-purpose`, the header the quickstart's
  `resolveContext` reads. All three are now in the HTTP reference and the
  client README.
- Publish verification retried the same registry URL with default caching, so a
  CDN edge holding a pre-publish `404` made the whole window unwinnable and a
  successful release reported failure. It now backs off up to five minutes and
  requests an uncached response each time.

## 0.1.0-alpha.2

### Added

- `deriveGrant` and `GrantChainResolver` in `@aicoo/sharedos-core`: a grant
  holder can pass on a strictly narrower slice of what it holds without the
  resource owner writing the row. Every axis — path, actions, scope, purpose,
  time window, and chain length — is checked separately, and a request that is
  not within the parent is refused rather than clamped. The chain is bound at
  use time, so a later revocation or expiry upstream still invalidates
  everything derived from it. ([#8](https://github.com/Aicoo-Team/SharedOS/pull/8))
- `examples/fleet-delegation`, a runnable delegation walkthrough in
  workcell vocabulary. ([#8](https://github.com/Aicoo-Team/SharedOS/pull/8))
- `examples/reference-host`, a working host: a filesystem `files` provider
  covering all twelve actions with path-escape defences, durable SQLite stores
  for bounded uses, revocation, namespace settings and audit, and an
  `AgentTurnDriver` over a live model.

### Changed

- `@aicoo/sharedos-contracts` owns the context capsule that crosses an agent
  boundary. ([#9](https://github.com/Aicoo-Team/SharedOS/pull/9))

### Host notes

- `CapabilityAuthorizer` accepts `chainResolver`. A host that issues derived
  grants must supply one; without it, derived grants are denied with
  `delegation_chain_unavailable`.
- A bounded (`maxUses`) grant cannot be delegated. Sharing one use budget
  across a chain needs usage accounting that spans grants, so `deriveGrant`
  refuses with `bounded_parent_not_delegable` instead of multiplying the
  budget by the number of delegates.

## 0.1.0-alpha.1

### Added

- Pluggable runtimes inside a fixed security envelope: `RuntimePlugin`,
  `RuntimeRegistry`, `SharedOSExecutor`, and `StandardRuntime`
  ([ADR 0007](docs/adr/0007-pluggable-runtime-security-envelope.md)).
- The `@aicoo/sharedos-http` transport adapter and the `@aicoo/sharedos-client`
  typed client over the same contracts.

## 0.1.0-alpha.0

First public prerelease of the eight `@aicoo/sharedos-*` packages under
Apache-2.0.
