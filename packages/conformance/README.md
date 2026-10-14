# @aicoo/sharedos-conformance

Standard execution records and infrastructure conformance evidence for SharedOS.

SharedOS answers "what happened during this execution?". This package turns that
answer into one comparable artifact so an experiment layer can ask "was it
correct, secure, reproducible, and how did it compare?" without re-deriving
evidence per runtime adapter.

It contains no task definitions, gold labels, evaluators, or scores. Assembling
a record never re-decides an authorization outcome; it reads the evidence the
kernel already emitted.

## Execution record

`assembleExecutionRecord` combines an `ExecutionRequest`, its `ExecutionResult`,
and the turn's `AuditEvent`s into an `ExecutionRecord`:

- **experiment identity** — task, run, and separate `specHash`, `worldHash`, and
  `evaluatorHash`;
- **system identity** — protocol, SharedOS version, runtime manifest, adapter,
  model, and `policyHash`;
- **authority** — principal, namespace, and every distinct authority state the
  turn observed, each with the grant ids behind it;
- **execution** — exposed tools, decisions, mediated operations, ordered events,
  and terminal result;
- **state** — before/after snapshot references by id and hash only;
- **cost** — elapsed time, tool calls, authority loads, audit volume, and tokens
  when a runtime reports them.

Authority is recorded per decision rather than per turn. A turn resolves
authority once, at admission, so its decisions all name one snapshot; the
per-decision field is kept because a host may still call the kernel outside any
turn, and each such call resolves its own.

## Reproducibility

`hashExperimentInputs` hashes a specification, its materialised world, and its
evaluator separately. `compareReproducibility` uses those to decide whether two
runs may be compared at all: a differing spec means they answer different
questions, and a matching spec with a differing world means materialisation is
not deterministic.

## Completeness

`checkRecordCompleteness` names every missing field and separates evidence that
must be present from evidence that only exists when a run produced it.
`checkRecordRedaction` re-checks that no tool arguments, tool results, or
message payloads reached the record.

## Adversarial conformance

The kernel conformance manifest measures _attempted_ violations. A
model declining to attack is not evidence that SharedOS prevented an attack, so
this package supplies the attacker instead of inferring one.

`HostileRuntime` is a `RuntimePlugin` that issues exactly the calls a declared
move set names, in the declared order, and reports what came back. Nothing in it
reads a clock, a random source, or a generated identifier: call identifiers come
from the move and timestamps from the turn context, so two runs of one move set
against one world produce byte-identical evidence.

That holds for a world whose clock moves as well as for one whose clock is
frozen. A condition that arms `expiresAfterOperations` gets a clock indexed on
the operations the kernel recorded, not on wall time, so the instants a run
produces are a function of the move set and the world and of nothing else.

`CANONICAL_ATTACK_MOVES` holds one move per row of the conformance matrix,
carrying the row's own wording — invariant, expected outcome, and every
attempt's expectation — so the result table is regenerated from the definitions
rather than transcribed beside them. The committed manifest,
`docs/conformance/kernel-conformance.md`, is that table: it is where the rows,
their signals, and each column's cell are read. The thirty-one moves, by what
they attack:

- **Authority a message cannot mint:** `forged_grant`, `read_to_mutation`,
  `expired_grant`, `replayed_grant`, `revoked_mid_turn`, `expired_mid_turn`,
  `bounded_grant_exhausted`, `over_broad_delegation`.
- **Boundaries:** `hidden_tool`, `namespace_crossing`, `tool_ceiling_escape`,
  `rollback_unavailable`, `rollback_out_of_scope`, `broker_ungranted`,
  `broker_out_of_scope`, `host_policy_denied` -- the last being a boundary the
  host draws rather than the grant store: a grant covers the path and the
  product ceiling overrides it (ADR 0020).
- **Failing closed:** `usage_store_unavailable`, `authority_unavailable`,
  `audit_unavailable`, `invalid_tool_result`, `budget_exceeded`, `turn_draining`.
  `audit_unavailable` and `turn_draining` are the envelope's: an audit sink that stops
  taking writes ends the turn before the next effect, because a decision is
  recorded before the effect it allows, and a turn that is draining refuses a
  call the kernel would have allowed.
- **The runtime's reach:** `grant_material_unreachable`.
- **How a turn ends and what it leaves:** `escalation_recorded`,
  `escalation_refused`, `runtime_crashed`, `record_completeness`.
- **A refusal SharedOS did not make:** `route_lease_revoked` -- the one row about
  a decision the kernel does not own. The send is authorized, the host's
  transport declines the dispatch under a route lease that closed after that
  authorization, and the claim is that the kernel neither overrides that refusal
  nor loses it (ADR 0025).
- **What a turn is answered from:** `catalogue_moved_mid_turn` -- the catalogue a
  turn published is the one its calls are answered from, whatever a per-context
  provider would say a moment later. The provider moves the tool's declared
  capability under the turn and nothing about authority moves at all, which is
  what separates the question from every other mid-turn row (ADR 0026).
- **Declared and not built:** `typed_governed_views`, `replay_freshness`.

The last two rows are declared and not built. They are here rather than omitted
because a matrix that silently drops the rows nobody implemented describes a
narrower system as a more conformant one. `ConformanceCase.notImplemented`
carries the reason, the cell reports `not implemented`, and the row is never run
and never a pass.

Three rows need more than one turn, a clock that moves, or a kind of attempt
that is not a tool call:

- **`revoked_mid_turn`** runs twice against one world. The store revokes a grant
  immediately after the first turn's authority load, so the revocation lands
  while that turn is still running; the first turn keeps the authority it was
  admitted with and the second sees the revocation. Attempts declare which turn
  they belong to with `AttackAttempt.turn`, so the number of turns follows from
  the move rather than being a second thing to keep in step with it.
- **`expired_mid_turn`** is the other reading of the same moment, and is a
  separate row rather than a second condition because the two require opposite
  answers at the identical position in their scripts: read the workspace again,
  after the removal has landed, inside the turn that was admitted before it.
  Under a revocation that must succeed; under an expiry it must be denied. It
  needs a clock rather than a second turn, so its condition arms
  `expiresAfterOperations`, which writes the expiry onto the grant _before_ the
  turn -- as `expired` does -- and starts a clock that advances one step per
  mediated operation. Every other condition keeps the frozen `CONFORMANCE_NOW`.
  Arming it the way `revoked_mid_turn` does, by editing the store mid-turn,
  would prove nothing: the running turn is no longer reading that store.
- **`grant_material_unreachable`** cannot be attempted with a tool call. Its
  attempt sets `inspect: "grant_material"`, which walks every field of the turn
  request and every property of the runtime host, own and inherited, looking for
  anything that carries authority. That is the run-time half; the compile-time
  half the matrix names as its signal lives in `runtime-surface.test.ts`.

### Attempt receipts

Every declared attempt produces an `AttemptReceipt` recording whether the call
was actually issued, which tool it named, its argument _keys_, and the status and
reason code that came back. Receipts never carry argument values.

`attempted: false` is the field that keeps a cell honest. Without it, "SharedOS
denied the attack" is indistinguishable from "no attack appears in the trace".
Receipts are emitted as runtime events as they happen and returned again with
the terminal outcome, so a cancelled or timed-out turn still says what was tried;
`readAttemptReceipts` recovers them from the event stream alone.

An attempt may also be declared `unreachable`, meaning a runtime plugin
structurally cannot make it — changing the turn's namespace, for example. That
is stronger evidence than a denial, and recording it as a declared attempt keeps
it distinguishable from a row nobody thought to test.

### The adversary is only the attacker

`createConformanceWorld` builds the world each move is declared against and owns
every control that arms a dangerous condition in it: revoking a grant, revoking
a delegation ancestor, and taking the grant store offline. Those are host-owned
control-plane operations in SharedOS, not agent-reachable ones, and a runtime
plugin receives only a sanitised turn request and a tool-invoking host, so the
separation holds by construction rather than by convention.

Keeping it that way keeps two questions apart. "Can an attacker obtain
administrative power?" is a privilege-escalation question and belongs to its own
suite. "Given this condition, does the kernel enforce?" is what the manifest
measures, and it is the only question these moves ask.

What the manifest does assert about the control plane is that it is not reachable
from a turn at all. The `hidden_tool` row guesses a plausible grant-issuing tool
name and a registered tool in a namespace this context never enables, and both
are refused as `tool_unavailable` without revealing which of the two they were.
Revocation, namespace administration, and store configuration have no tool, no
resource, and no message path, so there is nothing for a move to attempt: they
are host-side objects a runtime plugin is never handed.

## Running the suite

`pnpm conformance` runs every case against every committed column and writes
two things:

- a **deterministic summary** — `docs/conformance/kernel-conformance.{md,json}` —
  committed, so a change in enforcement behaviour appears as a reviewable diff in
  the pull request that caused it;
- the **full evidence** — `artifacts/conformance/evidence.json` — ignored, since
  it carries execution records, runtime manifests, and timings that churn without
  any invariant result changing.

Nothing volatile reaches the summary. A cell holds the status, which boundary
refused the attempt, the observed reason codes, how many attempts were issued,
and whether the record was usable. Runtime versions, model names, durations, and
event volumes stay in the evidence artifact.

`pnpm conformance:check` regenerates the summary, fails if the committed copy is
stale, and fails on any cell that is `fail` **or** `not exercised`. A row that
proved nothing is a broken suite, not a soft result, so it breaks the build the
same way a real regression does.

`not implemented` is the one status that does not break the build. It is a
standing result rather than a regression: the row is declared, its absence is
stated in the manifest, and failing on it would only pressure someone into
deleting the row. The script prints the count on every run so the gap stays in
view. `pnpm conformance -- --no-build` skips the package build when `dist` is
already current; `conformance:check` always builds.

Two more scripts run columns the committed manifest deliberately does not
include, because their results depend on what is installed and on a model's
choices: `pnpm conformance:native` (`scripts/native-conformance.mjs`) and
`pnpm conformance:mcp` (`scripts/mcp-conformance.mjs`). Their flags,
environment, and artifacts are documented in `docs/mcp-toolshare.md`.

### Cases and conditions

A `ConformanceCase` pairs a move with the _conditions_ it runs under, where a
condition is a trusted world arming expressed as data. A row whose expected
outcome has two clauses needs two conditions: "deny; invalidate descendants"
cannot be evidenced by one arming, so the replayed-grant row runs once with the
agent's own grant revoked and once with the grant it was delegated from revoked.
They deny with different reason codes, and the manifest carries both.

### Grading

`judgeCase` compares receipts against declared expectations. It is separate from
the runtime on purpose: the adversary records what happened and never decides
whether it was correct, so the same receipts can be re-graded without re-running
anything. A cell is one of six statuses, and a pass may carry one marker:

| Status            | Means                                                                                                                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pass`            | Every declared attempt met its expectation and every control attempt succeeded                                                                                                                                                                                                       |
| `pass (driver)`   | A pass whose attack the column's driver had to issue on the occupant's behalf — the step-ceiling row, where only a driver can name a step past it                                                                                                                                    |
| `fail`            | An attempt did not meet its expectation                                                                                                                                                                                                                                              |
| `not exercised`   | An attack was never issued, a control did not succeed, or the ending a turn-graded row is about was never asked for — the fixture or the delegate, not the kernel, decided the outcome — so the row is evidence of nothing; never a pass                                             |
| `not applicable`  | The runtime structurally cannot make the attempt: declared by the move when no runtime can, and by the column when this one cannot. It does not sink the case, which keeps a row a comparison across columns rather than a penalty on the columns that cannot reach every part of it |
| `not implemented` | SharedOS does not do this; the row is declared so the gap is stated, and is never run                                                                                                                                                                                                |
| `out of scope`    | The attempt is issued and its evidence kept, but SharedOS declares no guarantee over it on this path, so the verdict is withheld: a narrowed claim rather than a result, never averaged into pass or fail. It exists so a guarantee cannot be narrowed by deleting a row             |

Record completeness is reported beside the verdict rather than folded into it —
except for the record-completeness row itself, where the record _is_ the claim.

Some rows are about how the turn ends rather than about a call inside it. A
condition can declare `expectTurn`, and the row is then graded on the turn's
terminal outcome as well as on its attempts. Three shapes use it:

- an unavailable grant store refuses the turn at admission, so the runtime is
  never started and every declared attempt is reported as structurally
  unreachable rather than as never exercised;
- an escalated turn did run, so its attempts are graded exactly as any other
  row's and the ending is an additional requirement on top of them;
- an audit outage ends the turn under the call whose decision could not be
  recorded. That call is never answered, so it has nothing to grade: it is
  reported as not applicable, and only when the record shows it was requested,
  never completed, and the envelope ended the turn the way the row declared. A
  call left unanswered by anything else is an attempt that was not exercised. A
  live column's call ids are the harness's own, so there the call is found by
  the tool its request named, one unanswered call standing for one attempt.

Whether the runtime started is read from the record, not declared. It takes both
halves — the condition saying the turn would end this way and the record showing
no `turn.started` — for an attempt to count as unreachable, so a row that simply
produced no receipts cannot report as `not applicable`.

### Columns

A column is an adapter occupying the delegate seat. The attacker stays scripted
across all of them; what varies is the runtime mediating its calls, which is
exactly the claim under test — the kernel's guarantees should not depend on which
driver is in the seat. Adding a column is supplying a
`(moves, options) => RuntimePlugin` factory; the suite and the grading do not
change.

Six columns are committed, and the first two are different kinds of thing.

- `ADVERSARY_COLUMN` (`Adversary`) puts `HostileRuntime` in the seat directly: a
  plugin that owns its outcome, issues every declared attempt itself, and calls
  the host without a driver or a catalogue rendering in between. It is the
  reference every other cell is read against, and the only column that can put
  the ungranted-escalation row. It is not the native harness.
- `MODEL_SCRIPTED_COLUMN` (`Standard`) is the native harness:
  `createStandardRuntime` with `StandardTurnDriver` in the seat and the
  permission-filtered catalogue rendered into the model's own tool-call shape.
  In the committed manifest a transcript stands where the provider would —
  `movesToModelTranscript` writes each declared attempt as a model reply in the
  wire alphabet a provider accepts, `TranscriptModelClient` replays it, and the
  driver's real codec, argument parsing, and escalation recognition read it back.
  What is left out is the model. It is graded under `modelLimits`, the same
  limits the live model column carries, because every one of them is the
  driver's rather than the provider's.
- `CODEX_SCRIPTED_COLUMN`, `CLAUDE_CODE_SCRIPTED_COLUMN`,
  `DEEPSEEK_SCRIPTED_COLUMN`, and `PI_SCRIPTED_COLUMN` put each vendor adapter
  there, driven by frames built from the same move: `movesToTranscript` renders
  each declared attempt into that vendor's own wire shape, and the adapter's
  real protocol translation reads them back. What is left out is the transport
  that would carry those frames from a live CLI.

In every column the kernel and the envelope are the real ones.

Three more kinds of column make the live claim, and are run by the scripts
rather than committed, because each depends on what is installed here and on
what a model chooses:

- `liveColumn` spawns the installed CLI as a driven harness over its real
  transport;
- `mcpColumn` runs the installed CLI natively, with the catalogue served to it
  over MCP, so the harness owns its own loop;
- `modelColumn` puts a model API in the seat with no vendor between it and the
  kernel — the live mode of `Standard`, and the only column that separates what
  the model does from what a vendor's scaffolding makes it do.

Each column leaves something out — the transport, the catalogue, the loop, the
vendor, the model — and the docblocks on `columns.ts` say precisely which. None
of them replaces the scripted reference: a model chooses, and the rows only a
scripted driver carries are reported `not exercised` rather than `pass` when it
does not.

A vendor column cannot report on itself: a harness does not know it is in a
conformance run. Its attempts are recovered from the execution record instead,
by `receiptsFromRecord` (and `liveReceiptsFromRecord`, which matches on tool and
resource because a live harness mints its own call ids), which is the stricter
source — a runtime that quietly skipped a call leaves no operation behind to be
mistaken for a denial. This works only because the envelope records a refusal
code on the `tool.completed` event: a call refused before the kernel reaches no
audit sink, so without that code the record could say an envelope refusal
happened but not which one.

`RuntimeColumn.limits` is how a column states what it structurally cannot do,
per row and per condition, in four kinds (`ColumnLimits`):

- `unreachable` — attempts the harness cannot issue. Every driven and MCP
  column declares the inspection attempt unreachable: a harness speaks tool
  calls over a wire and is never handed the runtime surfaces to enumerate. An
  MCP column also declares an uncatalogued name unreachable, because its client
  refuses the name before the call is sent.
- `driverIssued` — attempts the column's driver makes on the row's behalf. On
  the step-ceiling row the loop every driven column runs inside stops at
  `maxSteps`, so the driver names the out-of-budget step itself; the attempt is
  issued and graded, and the cell reads `pass (driver)` so the driver's doing is
  not filed under the model's name.
- `outOfScope` — a row SharedOS declares does not reach this path. The MCP
  columns declare the step-ceiling row out of scope: the harness owns its loop
  there, and SharedOS states the guarantee only while it owns the loop.
- `unsupported` — a whole row the column cannot run. Every driven, MCP, and
  model column sets it on the ungranted-escalation row: only a plugin that owns
  its outcome can end a turn with an `escalate` the catalogue did not offer, so
  the row runs on Adversary alone and reads `not applicable` elsewhere, with the
  reason.

Escalation is no longer among the limits of any column. It is a catalogued
tool, `sharedos.escalate`, so a driven column ends the turn by calling it, an
MCP column has the ask recognised at the bridge and the turn settled from it,
and the row is graded like any other. The one escalation row that _is_ among
the limits is the ungranted one, for the reason above: a column that reads the
catalogue before it escalates cannot make the attempt the row is about.

## Tool scope in evidence

`system.toolPolicy` is a versioned declaration of the runtime's available tool
surface, not isolation proof. Record assembly preserves the runtime or column
policy and rejects conflicts. An omitted inventory becomes `unknown`; absence
in older records also means unknown. Local tools and independent MCP connections
make the policy `mixed`. `broker-only` requires a complete inventory, empty
outside lists, and host evidence references. Broker refusal receipts cover only
calls that reached SharedOS, regardless of mode. See
[ADR 0027](../../docs/adr/0027-tool-policy-classification.md).
