# Contributing to SharedOS

SharedOS is a security boundary shared by different hosts. Contributions should
keep the core host-neutral, make permission behavior explicit, and preserve the
same semantics across embedded and HTTP integrations.

## Before you begin

Read:

- the [architecture](docs/architecture.md);
- the [permission model](docs/security/permission-model.md);
- the [threat model](docs/security/threat-model.md);
- relevant decisions in [docs/adr](docs/adr/).

For a suspected vulnerability, follow [SECURITY.md](SECURITY.md) instead of
opening a public issue.

## Development setup

Requirements:

- Node.js 22.19 or newer;
- pnpm 9.15.

```bash
pnpm install
pnpm check
```

`pnpm check` runs formatting verification, TypeScript project references, the
test suite, the release-script tests, the generated API reference check, and the
conformance manifest check. CI also runs `pnpm pack:check`, which typechecks the
published surface from a fresh consumer, so run both before handing off a
change.

## Repository boundaries

| Location               | Allowed responsibility                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/contracts`   | JSON-safe types, schemas, protocol errors and identifiers                                             |
| `packages/core`        | Deterministic authorization, routing and dispatch                                                     |
| `packages/os`          | Standard `files` schemas and guarded tool adapters                                                    |
| `packages/runtime`     | One bounded agent turn over provider ports                                                            |
| `packages/client`      | Typed remote client with no separate policy semantics                                                 |
| `packages/http`        | HTTP adapter over contracts, core and runtime                                                         |
| `packages/sdk`         | Deliberate re-exports only; no independent policy semantics                                           |
| `packages/testkit`     | Deterministic fixtures, in-memory providers and conformance helpers                                   |
| `packages/conformance` | Execution records and the adversarial conformance suite; no tasks, gold labels, evaluators, or scores |
| `packages/mcp`         | The permission-filtered catalogue served over MCP; one method wide into the turn                      |
| `packages/adapters`    | Vendor harness and model-API translation; no policy of its own                                        |
| `examples`             | Small, non-production demonstrations                                                                  |
| `docs/adr`             | Durable architectural decisions and trade-offs                                                        |

Core packages must not import Next.js, Drizzle, Azure, Aicoo billing or UI, or
PACT tasks, gold labels, runners, judges, and metrics. Host integrations belong
in the host repository or a clearly separated adapter package.

Production storage belongs to the host. An in-memory implementation in
`testkit` must not be described as durable or multi-instance safe.

## Making a change

1. State the responsibility and package boundary affected.
2. Define or update JSON-safe contracts before transport-specific behavior.
3. Keep deterministic decisions in `core` and side effects behind provider
   ports.
4. Add tests, including denied and malformed cases for permission changes.
5. Update integration or security documentation when behavior changes.
6. Add an ADR for a breaking protocol or architectural decision.
7. Run `pnpm check`.

Avoid exporting an internal type merely because another package can import it.
Public exports become compatibility commitments.

## Contract rules

Public protocol values must survive a JSON round trip without custom
serialization. Do not expose `Date`, `bigint`, `undefined`, class instances,
framework requests, database handles, or vendor SDK objects.

Use runtime validation at external boundaries. Reject unknown fields where they
could become hidden authority or ambiguous behavior. Prefer discriminated unions
for results so a denied or failed operation cannot be mistaken for success.

Structured addresses and resource paths are protocol values. Do not introduce
string suffix parsing, path-prefix authorization, or unqualified cross-namespace
identifiers.

## Permission changes

Every permission change must preserve these invariants:

- no matching trusted grant means deny;
- messages, model output, and capability requests do not grant authority;
- a complete resource-action-purpose tuple matches a complete grant;
- discovery is filtered and execution is re-authorized;
- tool arguments are runtime-validated and cancellation reaches providers;
- expiry is checked at point of use; revocation, purpose withdrawal, `notBefore`,
  and `issuedAt` are decided at the turn's admission instant and observed by the
  next turn (ADR 0016);
- bounded uses are atomic in multi-instance deployments;
- namespace/world, owner, actor, authority, purpose, and trace reach audit;
- provider failures do not trigger fallback to a wider identity.

Tests should include, as relevant:

- expected allow and deny paths;
- wrong actor, issuer, owner, action, purpose, or namespace;
- exact versus descendant path scope;
- not-yet-active, expired, revoked, exhausted, and malformed grants;
- cross-world and cross-owner resource access;
- discovery versus invocation behavior;
- replay and concurrent bounded-use behavior.

## Testing style

Keep tests next to the source they exercise using `*.test.ts`. Prefer explicit
fixtures with fixed timestamps and IDs. Tests should be deterministic and must
not call live model, database, OAuth, or MCP services.

Use `@aicoo/sharedos-testkit` for portable fixtures and provider conformance where it
improves consistency. A provider-specific integration suite can live with that
provider in its host repository.

## Documentation and ADRs

Update documentation in the same change as the behavior it describes. ADRs use
the next four-digit number and include:

- status and date;
- context and constraints;
- the decision;
- positive and negative consequences;
- rejected alternatives.

Do not rewrite an accepted ADR to hide an earlier decision. Add a new ADR that
supersedes it.

## Commit messages

Use Conventional Commits:

```text
<type>(<scope>): <imperative subject>

<what changed and why>

<issue or breaking-change footer when needed>
```

Supported types include `feat`, `fix`, `refactor`, `perf`, `test`, `docs`,
`style`, and `chore`. Keep the subject under 72 characters, lowercase, imperative,
and without a final period.

Example:

```text
fix(core): reject expired grants before tool invocation

- Recheck grant time bounds immediately before side effects
- Preserve an explicit denial event for audit consumers

Relates to #123
```

## Pull requests

A pull request should explain:

- what changed and why;
- which package and trust boundary are affected;
- API or protocol compatibility impact;
- security assumptions and failure behavior;
- tests run, including denial cases;
- migration or rollback considerations;
- the ADR that covers a breaking decision.

Keep unrelated refactors separate. Never include credentials, generated secrets,
production user data, or unrelated host changes.
