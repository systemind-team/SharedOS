# @aicoo/sharedos-mcp

The SharedOS permission-filtered tool catalogue, served to external harnesses as
a Model Context Protocol server.

```bash
npm install @aicoo/sharedos-mcp
```

```
Harness configuration declares a CONNECTION.
SharedOS declares the TOOLS.
SharedOS capabilities declare the AUTHORITY.
RuntimeHost is the only EXECUTION path.
```

This is the other half of the harness story. `@aicoo/sharedos-adapters` puts
SharedOS in the model provider's seat and owns the turn loop; this package lets a
vendor CLI keep its own loop and whatever model it is configured with, and
connect to SharedOS as a tool server. Both converge on `RuntimeHost.invokeTool`, so neither adds a second
permission path.

```ts
import { McpToolServer, openToolBridge } from "@aicoo/sharedos-mcp";
import { createStreamableHttpMcpServer } from "@aicoo/sharedos-mcp/node";

// Inside RuntimePlugin.run(request, host, signal):
const bridge = openToolBridge({
  executionId: request.executionId,
  context: { traceId: request.context.traceId, now: request.context.now },
  tools: request.tools, // already permission-filtered by the envelope
  host, // RuntimeHost: every call is re-authorized
});
const http = await createStreamableHttpMcpServer({
  server: new McpToolServer({ invoker: bridge }),
});
try {
  // ... point the harness at http.url ...
} finally {
  bridge.close();
  await http.close();
}
```

A harness declares no step, so a turn served this way is bounded by the
envelope's `maxToolCalls` and `timeoutMs`, not by `maxSteps`.

## One name

```
ToolDefinition.name  =  SharedOS canonical tool ID  =  raw MCP Tool.name
```

There is no second identity in the published catalogue. A harness alias
(`mcp__sharedos__files_read`) is presentation: it is recorded on the bridge for
diagnosis, never on the `ToolCall`, so it cannot reach an authorization decision.

## What crosses the boundary

`PublishedToolDefinition` carries `name`, `description`, `inputSchema`,
`outputSchema`, MCP annotation hints, and catalogue provenance. It carries no
`requiredCapability`, no `resolveRequirement`, no grants, no issuing authority,
no namespace settings, no credentials, and no handler references.

The omission is load-bearing. Authorization is `resource + action + context`
resolved from the **arguments** at call time, so two calls to one published tool
routinely need different authority.

## Refusals are results

A SharedOS denial comes back as an MCP tool error (`isError: true`), never as a
transport error. A JSON-RPC error means the request could not be processed; a
denial is a processed request whose answer is "no", and a harness needs to be
able to report it and carry on. `denied` and `failed` stay distinguishable in the
payload and in `_meta["sharedos/status"]`.

## Per turn, never global

The bridge is opened for one `AccessContext`, exposed for one turn, and torn down
with it. A harness process that outlives its turn finds a shut door rather than a
catalogue resolved for a turn that has ended.

## Catalogue hashes

```
catalogHash = SHA-256(canonical JSON(tools sorted by canonical name))
```

Field participation is fixed by `CATALOG_HASH_FIELDS`, so two implementations
cannot both claim to compute it and disagree. Two harnesses whose hashes match
were served the same semantic tool set; two whose hashes differ cannot be
compared until that is explained.

Full design: [MCP toolshare](https://github.com/systemind-team/SharedOS/blob/main/docs/mcp-toolshare.md)
and [ADR 0014](https://github.com/systemind-team/SharedOS/blob/main/docs/adr/0014-mcp-toolshare.md).

SharedOS is currently a `1.0.0` preview.

## Image results

A successful tool may include `metadata["sharedos/content"]` with inline MCP
image blocks (`type: "image"`, `mimeType`, base64 `data`). The MCP adapter retains
the ordinary JSON/text summary and appends valid JPEG, PNG or WebP images, bounded
to four images and 4 MiB of encoded data per result. Other metadata, remote URLs,
and images on failed or denied results are not forwarded as content. This is a
presentation hint; it grants no authority and does not change tool discovery.
