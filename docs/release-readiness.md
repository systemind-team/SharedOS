# Release readiness

SharedOS is an open-source prerelease: the repository and the packages are
both public under Apache-2.0. It is not yet a production security boundary.
Prerelease packages use the `next` dist-tag.

## Distribution gates

- `0.1.0-alpha.0` was published by hand, and `alpha.1` and `alpha.2` since;
  `0.1.0-alpha.5` was the first published by the workflow alone. The root
  version is the next prerelease, `1.0.0-preview`.
- Trusted publishing: `release.yml` publishes from a `v*` tag with OIDC. Confirm
  on npm that every package's trusted publisher is configured and that a
  prerelease has been published through a tag alone; the repository cannot show
  whether that has happened.
- `latest` is promoted deliberately with `pnpm release:promote-latest`, never by
  a release.

Completed distribution gates: Apache-2.0 is present in every package archive,
the package set is fixed, dependency-ordered, and package-linted, prereleases
cannot become `latest` accidentally, and `founders@aicoo.io` is the private
vulnerability-reporting contact.

## Production security gates

- Install a production durable `ReplayStore` for the kernel replay gates covering
  execution IDs, message IDs, tool-call IDs and resource-operation IDs (ADR 0028).
  SharedOS now defines atomic claim, conflict rejection, result replay and fenced
  interruption semantics; testkit supplies an isolated in-memory adapter. Verify
  host storage against these rules across processes, retain identity tombstones,
  and configure host freshness policy. Protocol v1 without a store remains
  unprotected; mandatory activation is coordinated with protocol versioning.
- Use a trusted grant store or verifier and a durable compare-and-set usage store
  for bounded grants. The kernel intentionally fails bounded grants closed when
  no usage store is supplied.
- Persist provider side effects and audit outcomes with a transactional outbox or
  equivalent protocol; wire `onAuditError` to operational alerting.
- Prove every production provider honors `AbortSignal` before committing side
  effects and enforces namespace/owner filtering inside its query.
- Add authentication, payload/rate limits, connector egress controls, secret
  handling, and host-specific policy ceilings at deployment boundaries.
- Keep the MCP bridge on loopback, or supply its `authorize` hook and terminate
  TLS ahead of it. A bridge bound past loopback without a token is reachable by
  anything on that network.
- Run host adapter conformance suites covering allow, deny, expiry,
  revocation, bounded-use races, cross-world isolation, replay, cancellation,
  and malformed provider responses.
- Require every non-standard runtime adapter to prove broker-only tool effects,
  step/tool-call/deadline handling, concurrent-run isolation, cancellation, and
  stable manifest provenance. Run untrusted adapters outside the host process.

## Already enforced in this bootstrap

- Durable replay semantics when a host `ReplayStore` is installed, including
  concurrent duplicate refusal, conflicting-input rejection and retained results.

- Deny-by-default complete capability matching with segment-safe paths.
- Separate recipient-scoped grants for messaging and target-agent execution.
- Server-derived remote authority; request bodies cannot supply grants or tools.
- Permission-filtered tool discovery and exact per-call re-authorization.
- Default-off tool namespaces, context-scoped dynamic providers, atomic
  host-owned settings updates, and invocation-time namespace rechecks.
- Mandatory tool argument parsing and immutable checked calls.
- Sanitized model context without grants or issuing authority.
- Fixed runtime security envelope, trusted runtime selection, wrapped plugin
  events, authoritative manifest provenance, and a closed per-turn broker.
- Bounded one-turn execution with step/tool-call/deadline limits, cooperative
  cancellation, and bounded cleanup.
- Runtime-validated HTTP client responses and shared wire schemas.
- Canonical resource path segments and explicit provider-facing owners.
- Package-level READMEs, distributable source and source maps, exact packed
  dependency versions, and a fresh-consumer runtime/type smoke test.
- A dependency-ordered, `next`-tagged release script with package lint, dry-run,
  registry collision checks, canonical-content recovery, and a tag-triggered
  trusted-publishing workflow.
- Apache-2.0 public prerelease metadata, Node 20/22 CI, type checks, tests,
  build, and executable sender-to-receiver quickstart.
