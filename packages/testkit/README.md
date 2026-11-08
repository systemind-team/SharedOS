# @aicoo/sharedos-testkit

Deterministic in-memory fixtures and recording providers for SharedOS tests.

```bash
npm install --save-dev @aicoo/sharedos-testkit
```

This package is for tests, examples, and isolated experimental worlds. Its
in-memory stores are not durable or multi-instance-safe production storage.
`InMemoryToolNamespaceSettingsStore` can exercise the namespace control plane
without becoming a production settings backend.

A store that is down is a stand-in too: `UnavailableGrantSource`,
`UnavailableDelegationChainResolver` and `UnavailableGrantUsageStore` fail every
call, so a test can show a decision failing closed.
`revoke` and `expire` on the two grant stores edit a grant in place, the way a
host store would, and throw on an id the store does not hold.

SharedOS is currently a `1.0.0` preview.

## Replay storage

`SharedOSKernelOptions.replayStore` enables the kernel-owned replay state machine
for execution, tool, resource and message IDs. Hosts implement `ReplayStore` with
atomic durable claims and fenced settlement. Keep identity tombstones after
result expiry; never reclaim pending operations solely because a timeout passed.
See [ADR 0028](https://github.com/systemind-team/SharedOS/blob/main/docs/adr/0028-durable-operation-replay.md).

`InMemoryReplayStore` is exported by `@aicoo/sharedos-testkit` for isolated tests.
It is not durable or suitable for production. Protocol v1 without a configured
store preserves legacy unprotected behavior. External effects still require
provider idempotency or reconciliation for crash ambiguity.
