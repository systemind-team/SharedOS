# Open items for review

Declarations an audit of the repository found exported, tested, and documented
but wired to nothing, or set by nothing, and that were kept rather than removed
because each carries a design intent someone may still want. Each row names the
decision that would close it. The dead surface with no such intent was removed
instead (changelog, `0.1.0-alpha.3`, "Removed").

A reviewer picking one up should decide it one way — wire it, or remove it — and
delete its row; a row that stays for another release should say why.

| Item                                                  | Where                                                           | State                                                                                                                                                                                                                                                                                        | Decision                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HarnessMcpConnection.timeoutSec`                     | `packages/mcp/src/harness-config.ts`                            | Read by the three config emitters and, through `codexMcpServerSettings`, by the Codex launch; set by nothing, so no timeout is written and each harness's own default applies.                                                                                                               | Set it on the connection the runtime builds, or remove it from the connection.                                                                    |
| `SharedOSKernel.readAgentCard`, `AgentCardViewSchema` | `packages/core/src/kernel.ts`, `packages/contracts/src/card.ts` | ADR 0021 says a card is published to the model as `sharedos.card`, the way `sharedos.escalate` is. The kernel method is built and tested; no tool, route or bridge serves it, so nothing outside `agent-card.test.ts` calls it, and the view schema waits to be that tool's argument schema. | Build the `sharedos.card` published tool over `readAgentCard`, or revise ADR 0021 to say the card is an in-process read and drop the view schema. |

Also recorded by the audit and not yet decided, each declared and never set or
never read: `HarnessMcpConfigFile.harness`; `HarnessStep.complete.metadata`;
`EvalHarnessDriverOptions.maxIgnoredFrames` (never set, so no limit, and its two
failure paths have no unit test); `OpenAiCompatibleModelClientOptions.maxOutputTokens`
and `requestTimeoutMs` (no limit unless set, set by no script) and `temperature`
(read with a default, set by no script);
`catalogueDelivery` manifest metadata;
`ToolAliasRecord.at`. Each is a declaration with no in-repo writer or reader;
`git grep` on the name is the evidence.

Five fields of the execution record have no writer in this repository on
purpose: `ExperimentIdentity.seed` and `metadata`, `StateReference.capturedAt`,
`StateRecord.diffRef`, and `AssembleExecutionRecordInput.auditRef`. The record
gives experiment identity and state references to the experiment layer that
seeded the world, and SharedOS neither captures a snapshot nor owns audit
storage, so their writer is a host. No host in the workspace imports the package
yet. They stay until one does, or until one decides it never will.
