[**SharedOS API v1.0.0-preview**](README.md)

---

[SharedOS API](README.md) / @aicoo/sharedos-contracts

# @aicoo/sharedos-contracts

Strict, JSON-safe SharedOS protocol schemas and TypeScript types.

```bash
npm install @aicoo/sharedos-contracts
```

Use this package for addresses, capabilities, messages, resources, tools,
runtime manifests/events/outcomes, execution results, audit events, and HTTP
wire contracts.
External boundaries should parse untrusted values with the exported schemas
rather than relying on type casts.

Tool definitions include a logical namespace, source, read/write catalog class,
and exact capability requirement. Access contexts carry the trusted effective
namespace selection; `ToolNamespaceUpdateSchema` defines portable, idempotent
enable/disable patches.

`AuditEventSchema` is the durable shape a host persists. What SharedOS itself
states about an event is a field it names; `metadata` holds what a host port
supplied and the details particular to one event type. It is strict, so a
persisted trail that parses is one the kernel could have written.

SharedOS is currently a `1.0.0` preview.

## Interfaces

### JsonObject

Defined in: [json.ts:4](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L4)

#### Indexable

> \[`key`: `string`\]: [`JsonValue`](#jsonvalue)

---

### SharedOSRoute

Defined in: [http.ts:85](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L85)

One HTTP operation: where it lives, its verb, and what crosses the wire each way.

#### Type Parameters

| Type Parameter | Default type |
| -------------- | ------------ |
| `Request`      | `unknown`    |
| `Response`     | `unknown`    |

#### Properties

| Property                                  | Modifier   | Type                                        | Description                            | Defined in                                                                                            |
| ----------------------------------------- | ---------- | ------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| <a id="property-method"></a> `method`     | `readonly` | [`SharedOSHttpMethod`](#sharedoshttpmethod) | -                                      | [http.ts:87](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L87) |
| <a id="property-path"></a> `path`         | `readonly` | `` `/${string}` ``                          | -                                      | [http.ts:86](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L86) |
| <a id="property-request"></a> `request?`  | `readonly` | [`WireSchema`](#wireschema)\<`Request`\>    | Absent for a route that takes no body. | [http.ts:89](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L89) |
| <a id="property-response"></a> `response` | `readonly` | [`WireSchema`](#wireschema)\<`Response`\>   | -                                      | [http.ts:90](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L90) |

---

### WireSchema

Defined in: [http.ts:76](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L76)

What either side of the HTTP boundary needs from a schema: a verdict and a
typed value. Structural, so the handler and the client can name a route's
schemas without depending on the validation library themselves.

#### Type Parameters

| Type Parameter |
| -------------- |
| `T`            |

#### Methods

##### safeParse()

> **safeParse**(`value`): \{ `data`: `T`; `success`: `true`; \} \| \{ `success`: `false`; \}

Defined in: [http.ts:77](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L77)

###### Parameters

| Parameter | Type      |
| --------- | --------- |
| `value`   | `unknown` |

###### Returns

\{ `data`: `T`; `success`: `true`; \} \| \{ `success`: `false`; \}

## Type Aliases

### AccessContext

> **AccessContext** = `z.infer`\<_typeof_ [`AccessContextSchema`](#accesscontextschema)>\>

Defined in: [access.ts:37](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/access.ts#L37)

---

### Address

> **Address** = `z.infer`\<_typeof_ [`AddressSchema`](#addressschema)>\>

Defined in: [address.ts:33](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L33)

---

### AgentAddress

> **AgentAddress** = `z.infer`\<_typeof_ [`AgentAddressSchema`](#agentaddressschema)>\>

Defined in: [address.ts:13](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L13)

---

### AgentCard

> **AgentCard** = `z.infer`\<_typeof_ [`AgentCardSchema`](#agentcardschema)>\>

Defined in: [card.ts:107](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L107)

---

### AgentCardView

> **AgentCardView** = `z.infer`\<_typeof_ [`AgentCardViewSchema`](#agentcardviewschema)>\>

Defined in: [card.ts:31](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L31)

---

### AuditEvent

> **AuditEvent** = `z.infer`\<_typeof_ [`AuditEventSchema`](#auditeventschema)>\>

Defined in: [audit.ts:175](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L175)

---

### AuditEventType

> **AuditEventType** = `z.infer`\<_typeof_ [`AuditEventTypeSchema`](#auditeventtypeschema)>\>

Defined in: [audit.ts:30](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L30)

---

### AuditOutcome

> **AuditOutcome** = `z.infer`\<_typeof_ [`AuditOutcomeSchema`](#auditoutcomeschema)>\>

Defined in: [audit.ts:54](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L54)

---

### AuditSource

> **AuditSource** = `z.infer`\<_typeof_ [`AuditSourceSchema`](#auditsourceschema)>\>

Defined in: [audit.ts:66](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L66)

---

### AuthorizationDecision

> **AuthorizationDecision** = `z.infer`\<_typeof_ [`AuthorizationDecisionSchema`](#authorizationdecisionschema)>\>

Defined in: [access.ts:79](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/access.ts#L79)

---

### Capability

> **Capability** = `z.infer`\<_typeof_ [`CapabilitySchema`](#capabilityschema)>\>

Defined in: [capability.ts:46](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L46)

---

### CapabilityConstraints

> **CapabilityConstraints** = `z.infer`\<_typeof_ [`CapabilityConstraintsSchema`](#capabilityconstraintsschema)>\>

Defined in: [capability.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L71)

---

### CapabilityGrant

> **CapabilityGrant** = `z.infer`\<_typeof_ [`CapabilityGrantSchema`](#capabilitygrantschema)>\>

Defined in: [capability.ts:142](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L142)

---

### CapabilityRequest

> **CapabilityRequest** = `z.infer`\<_typeof_ [`CapabilityRequestSchema`](#capabilityrequestschema)>\>

Defined in: [capability.ts:104](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L104)

---

### CapabilityRequirement

> **CapabilityRequirement** = `z.infer`\<_typeof_ [`CapabilityRequirementSchema`](#capabilityrequirementschema)>\>

Defined in: [capability.ts:152](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L152)

---

### EnabledToolNamespaces

> **EnabledToolNamespaces** = `z.infer`\<_typeof_ [`EnabledToolNamespacesSchema`](#enabledtoolnamespacesschema)>\>

Defined in: [tool.ts:63](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L63)

---

### Escalation

> **Escalation** = `z.infer`\<_typeof_ [`EscalationSchema`](#escalationschema)>\>

Defined in: [execution.ts:93](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L93)

---

### ExecutionEvent

> **ExecutionEvent** = `z.infer`\<_typeof_ [`ExecutionEventSchema`](#executioneventschema)>\>

Defined in: [execution.ts:56](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L56)

---

### ExecutionOptions

> **ExecutionOptions** = `z.infer`\<_typeof_ [`ExecutionOptionsSchema`](#executionoptionsschema)>\>

Defined in: [execution.ts:23](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L23)

---

### ExecutionRequest

> **ExecutionRequest** = `z.infer`\<_typeof_ [`ExecutionRequestSchema`](#executionrequestschema)>\>

Defined in: [execution.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L40)

---

### ExecutionResult

> **ExecutionResult** = `z.infer`\<_typeof_ [`ExecutionResultSchema`](#executionresultschema)>\>

Defined in: [execution.ts:128](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L128)

---

### GroupAddress

> **GroupAddress** = `z.infer`\<_typeof_ [`GroupAddressSchema`](#groupaddressschema)>\>

Defined in: [address.ts:18](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L18)

---

### HumanAddress

> **HumanAddress** = `z.infer`\<_typeof_ [`HumanAddressSchema`](#humanaddressschema)>\>

Defined in: [address.ts:8](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L8)

---

### Identifier

> **Identifier** = `z.infer`\<_typeof_ [`IdentifierSchema`](#identifierschema)>\>

Defined in: [common.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L29)

---

### JsonArray

> **JsonArray** = [`JsonValue`](#jsonvalue)[]

Defined in: [json.ts:7](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L7)

---

### JsonPrimitive

> **JsonPrimitive** = `string` \| `number` \| `boolean` \| `null`

Defined in: [json.ts:3](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L3)

---

### JsonValue

> **JsonValue** = [`JsonPrimitive`](#jsonprimitive) \| [`JsonObject`](#jsonobject) \| [`JsonArray`](#jsonarray)

Defined in: [json.ts:8](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L8)

---

### MessageDeliveryResult

> **MessageDeliveryResult** = `z.infer`\<_typeof_ [`MessageDeliveryResultSchema`](#messagedeliveryresultschema)>\>

Defined in: [message.ts:95](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L95)

---

### MessageEnvelope

> **MessageEnvelope** = `z.infer`\<_typeof_ [`MessageEnvelopeSchema`](#messageenvelopeschema)>\>

Defined in: [message.ts:42](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L42)

---

### MessageProvenance

> **MessageProvenance** = `z.infer`\<_typeof_ [`MessageProvenanceSchema`](#messageprovenanceschema)>\>

Defined in: [message.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L21)

---

### MessageRequestArguments

> **MessageRequestArguments** = `z.infer`\<_typeof_ [`MessageRequestArgumentsSchema`](#messagerequestargumentsschema)>\>

Defined in: [message.ts:73](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L73)

---

### ProtocolError

> **ProtocolError** = `z.infer`\<_typeof_ [`ProtocolErrorSchema`](#protocolerrorschema)>\>

Defined in: [protocol-error.ts:16](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/protocol-error.ts#L16)

---

### ProtocolVersion

> **ProtocolVersion** = `z.infer`\<_typeof_ [`ProtocolVersionSchema`](#protocolversionschema)>\>

Defined in: [common.ts:14](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L14)

---

### PublishedToolAnnotations

> **PublishedToolAnnotations** = `z.infer`\<_typeof_ [`PublishedToolAnnotationsSchema`](#publishedtoolannotationsschema)>\>

Defined in: [tool.ts:164](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L164)

---

### PublishedToolDefinition

> **PublishedToolDefinition** = `z.infer`\<_typeof_ [`PublishedToolDefinitionSchema`](#publishedtooldefinitionschema)>\>

Defined in: [tool.ts:200](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L200)

---

### PublishedToolMetadata

> **PublishedToolMetadata** = `z.infer`\<_typeof_ [`PublishedToolMetadataSchema`](#publishedtoolmetadataschema)>\>

Defined in: [tool.ts:173](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L173)

---

### ReachResult

> **ReachResult** = `z.infer`\<_typeof_ [`ReachResultSchema`](#reachresultschema)>\>

Defined in: [capability.ts:211](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L211)

---

### ReachSummary

> **ReachSummary** = `z.infer`\<_typeof_ [`ReachSummarySchema`](#reachsummaryschema)>\>

Defined in: [card.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L49)

---

### ReachUnavailableReason

> **ReachUnavailableReason** = `z.infer`\<_typeof_ [`ReachUnavailableReasonSchema`](#reachunavailablereasonschema)>\>

Defined in: [capability.ts:196](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L196)

---

### RemoteExecutionRequest

> **RemoteExecutionRequest** = `z.infer`\<_typeof_ [`RemoteExecutionRequestSchema`](#remoteexecutionrequestschema)>\>

Defined in: [http.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L28)

---

### RemoteResourceOperation

> **RemoteResourceOperation** = `z.infer`\<_typeof_ [`RemoteResourceOperationSchema`](#remoteresourceoperationschema)>\>

Defined in: [http.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L21)

---

### ReplayKey

> **ReplayKey** = `z.infer`\<_typeof_ [`ReplayKeySchema`](#replaykeyschema)>\>

Defined in: [replay.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/replay.ts#L15)

---

### ReplayRecord

> **ReplayRecord** = `z.infer`\<_typeof_ [`ReplayRecordSchema`](#replayrecordschema)>\>

Defined in: [replay.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/replay.ts#L36)

---

### ResourceOperation

> **ResourceOperation** = `z.infer`\<_typeof_ [`ResourceOperationSchema`](#resourceoperationschema)>\>

Defined in: [resource.ts:21](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/resource.ts#L21)

---

### ResourceReach

> **ResourceReach** = `z.infer`\<_typeof_ [`ResourceReachSchema`](#resourcereachschema)>\>

Defined in: [capability.ts:177](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L177)

---

### ResourceRef

> **ResourceRef** = `z.infer`\<_typeof_ [`ResourceRefSchema`](#resourcerefschema)>\>

Defined in: [capability.ts:35](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L35)

---

### ResourceResult

> **ResourceResult** = `z.infer`\<_typeof_ [`ResourceResultSchema`](#resourceresultschema)>\>

Defined in: [resource.ts:44](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/resource.ts#L44)

---

### RuntimeEvent

> **RuntimeEvent** = `z.infer`\<_typeof_ [`RuntimeEventSchema`](#runtimeeventschema)>\>

Defined in: [runtime.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/runtime.ts#L27)

---

### RuntimeManifest

> **RuntimeManifest** = `z.infer`\<_typeof_ [`RuntimeManifestSchema`](#runtimemanifestschema)>\>

Defined in: [runtime.ts:17](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/runtime.ts#L17)

---

### RuntimeTurnOutcome

> **RuntimeTurnOutcome** = `z.infer`\<_typeof_ [`RuntimeTurnOutcomeSchema`](#runtimeturnoutcomeschema)>\>

Defined in: [runtime.ts:59](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/runtime.ts#L59)

---

### ServiceAddress

> **ServiceAddress** = `z.infer`\<_typeof_ [`ServiceAddressSchema`](#serviceaddressschema)>\>

Defined in: [address.ts:23](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L23)

---

### SharedOSApiErrorCode

> **SharedOSApiErrorCode** = _typeof_ [`SHAREDOS_API_ERROR_CODES`](#sharedos_api_error_codes)\[`number`\]

Defined in: [http.ts:56](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L56)

---

### SharedOSApiErrorResponse

> **SharedOSApiErrorResponse** = `z.infer`\<_typeof_ [`SharedOSApiErrorResponseSchema`](#sharedosapierrorresponseschema)>\>

Defined in: [http.ts:69](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L69)

---

### SharedOSHealth

> **SharedOSHealth** = `z.infer`\<_typeof_ [`SharedOSHealthSchema`](#sharedoshealthschema)>\>

Defined in: [http.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L36)

---

### SharedOSHttpMethod

> **SharedOSHttpMethod** = `"GET"` \| `"POST"` \| `"PUT"`

Defined in: [http.ts:82](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L82)

---

### SharedOSRouteName

> **SharedOSRouteName** = keyof _typeof_ [`SHAREDOS_ROUTES`](#sharedos_routes)

Defined in: [http.ts:145](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L145)

---

### SharedOSToolCatalog

> **SharedOSToolCatalog** = `z.infer`\<_typeof_ [`SharedOSToolCatalogSchema`](#sharedostoolcatalogschema)>\>

Defined in: [tool.ts:237](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L237)

---

### Timestamp

> **Timestamp** = `z.infer`\<_typeof_ [`TimestampSchema`](#timestampschema)>\>

Defined in: [common.ts:33](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L33)

---

### ToolAnnotations

> **ToolAnnotations** = `z.infer`\<_typeof_ [`ToolAnnotationsSchema`](#toolannotationsschema)>\>

Defined in: [tool.ts:108](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L108)

---

### ToolCall

> **ToolCall** = `z.infer`\<_typeof_ [`ToolCallSchema`](#toolcallschema)>\>

Defined in: [tool.ts:344](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L344)

---

### ToolDefinition

> **ToolDefinition** = `z.infer`\<_typeof_ [`ToolDefinitionSchema`](#tooldefinitionschema)>\>

Defined in: [tool.ts:142](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L142)

---

### ToolName

> **ToolName** = `z.infer`\<_typeof_ [`ToolNameSchema`](#toolnameschema)>\>

Defined in: [tool.ts:35](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L35)

---

### ToolNamespace

> **ToolNamespace** = `z.infer`\<_typeof_ [`ToolNamespaceSchema`](#toolnamespaceschema)>\>

Defined in: [tool.ts:39](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L39)

---

### ToolNamespaceCatalog

> **ToolNamespaceCatalog** = `z.infer`\<_typeof_ [`ToolNamespaceCatalogSchema`](#toolnamespacecatalogschema)>\>

Defined in: [tool.ts:332](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L332)

---

### ToolNamespaceDescriptor

> **ToolNamespaceDescriptor** = `z.infer`\<_typeof_ [`ToolNamespaceDescriptorSchema`](#toolnamespacedescriptorschema)>\>

Defined in: [tool.ts:294](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L294)

---

### ToolNamespaceUpdate

> **ToolNamespaceUpdate** = `z.infer`\<_typeof_ [`ToolNamespaceUpdateSchema`](#toolnamespaceupdateschema)>\>

Defined in: [tool.ts:98](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L98)

---

### ToolPolicy

> **ToolPolicy** = `z.infer`\<_typeof_ [`ToolPolicySchema`](#toolpolicyschema)>\>

Defined in: [tool.ts:275](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L275)

---

### ToolReadWrite

> **ToolReadWrite** = `z.infer`\<_typeof_ [`ToolReadWriteSchema`](#toolreadwriteschema)>\>

Defined in: [tool.ts:50](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L50)

---

### ToolResult

> **ToolResult** = `z.infer`\<_typeof_ [`ToolResultSchema`](#toolresultschema)>\>

Defined in: [tool.ts:368](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L368)

---

### ToolSource

> **ToolSource** = `z.infer`\<_typeof_ [`ToolSourceSchema`](#toolsourceschema)>\>

Defined in: [tool.ts:46](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L46)

## Variables

### AccessContextSchema

> `const` **AccessContextSchema**: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>

Defined in: [access.ts:17](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/access.ts#L17)

The identity, purpose, time, and tool-namespace inputs to a permission
decision.

An access context deliberately carries no authority. Grants are loaded by the
kernel from a trusted `GrantSource` at the moment of the decision, so a
caller cannot present, extend, or replay authority by constructing a context.

---

### AddressSchema

> `const` **AddressSchema**: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>

Defined in: [address.ts:26](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L26)

A structured protocol address; no string suffix or prefix parsing is needed.

---

### AGENT\_CARD\_VIEWS

> `const` **AGENT\_CARD\_VIEWS**: readonly \[`"reach"`, `"identity"`, `"namespaces"`\]

Defined in: [card.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L27)

The named shapes an agent card is served in.

A card is a view rather than a record, so these are not filters applied to
one object on the way out: each name is a separate resource a reader is
authorized for, and each answers a different question.

- `reach` — identity together with the resources the subject can be asked
  about. This is the card the directory exists for.
- `identity` — the subject and nothing else. The narrowing that drops reach
  entirely, for a reader allowed to learn that an agent is addressable
  without learning what it holds.
- `namespaces` — identity together with which namespaces the subject reaches
  and how many entries in each, with no paths. A coarser answer than `reach`
  and a _distinct_ view for the reason ADR 0021 gives: projection is
  field-level, so a field that means something different depending on who
  reads it is the record shape a view exists to refuse.

Every view is bounded the same way. See [AgentCardSchema](#agentcardschema).

---

### AgentAddressSchema

> `const` **AgentAddressSchema**: `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>

Defined in: [address.ts:10](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L10)

---

### AgentCardSchema

> `const` **AgentCardSchema**: `ZodDiscriminatedUnion`\<`"view"`, \[`ZodObject`\<\{ `namespaceId`: `ZodString`; `reach`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `namespace`: `ZodString`; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `readAt`: `ZodString`; `subject`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `view`: `ZodLiteral`\<`"reach"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespaceId`: `string`; `reach`: `object`[]; `readAt`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `view`: `"reach"`; \}, \{ `namespaceId`: `string`; `reach`: `object`[]; `readAt`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `view`: `"reach"`; \}\>, `ZodObject`\<\{ `namespaceId`: `ZodString`; `readAt`: `ZodString`; `subject`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `view`: `ZodLiteral`\<`"identity"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespaceId`: `string`; `readAt`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `view`: `"identity"`; \}, \{ `namespaceId`: `string`; `readAt`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `view`: `"identity"`; \}\>, `ZodObject`\<\{ `namespaceId`: `ZodString`; `namespaces`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `entries`: `ZodNumber`; `namespace`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `entries`: `number`; `namespace`: `string`; \}, \{ `actions`: `string`[]; `entries`: `number`; `namespace`: `string`; \}\>, `"many"`>\>; `readAt`: `ZodString`; `subject`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `view`: `ZodLiteral`\<`"namespaces"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespaceId`: `string`; `namespaces`: `object`[]; `readAt`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `view`: `"namespaces"`; \}, \{ `namespaceId`: `string`; `namespaces`: `object`[]; `readAt`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `view`: `"namespaces"`; \}\>\]\>

Defined in: [card.ts:89](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L89)

The kernel's description of one agent: identity, computed reach, and nothing
a product would want to put beside them.

Reach is derived when the card is read, from the grants in force at that
instant, and is never stored. A stored reach would be the one description of
authority in SharedOS that nothing invalidates: revocation, purpose
withdrawal, expiry and a spent budget all work by not matching at the next
decision, and a column is outside all of them.

A card is bounded by one authority and one world. It shows what the subject
reaches under the authority the _reader_ is operating under, inside the
reader's namespace — not the subject's whole life. It is therefore a lower
bound on truth and never an upper one, which is what makes it safe to serve
to a model: it omits authority the reader's authority did not issue, and an
over-wide entry permits nothing because every operation is authorized
independently.

Display names, avatars, handles, skills and protocol bindings are absent on
purpose. The test is not whether a field is useful but whether it is
authority: reach is what the kernel decides against, and a display name is
not. A host composes those around this answer. See ADR 0021.

---

### AgentCardViewSchema

> `const` **AgentCardViewSchema**: `ZodEnum`\<\[`"reach"`, `"identity"`, `"namespaces"`\]\>

Defined in: [card.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L29)

---

### AuditEventSchema

> `const` **AuditEventSchema**: `ZodObject`\<\{ `action`: `ZodOptional`\<`ZodString`>\>; `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `at`: `ZodString`; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `authorityHash`: `ZodOptional`\<`ZodString`>\>; `cause`: `ZodOptional`\<`ZodString`>\>; `consumed`: `ZodOptional`\<`ZodBoolean`>\>; `endedBy`: `ZodOptional`\<`ZodEnum`\<\[`"envelope"`, `"runtime"`\]\>\>; `failClosed`: `ZodOptional`\<`ZodBoolean`>\>; `grantId`: `ZodOptional`\<`ZodString`>\>; `id`: `ZodString`; `messageId`: `ZodOptional`\<`ZodString`>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `operationId`: `ZodOptional`\<`ZodString`>\>; `outcome`: `ZodEnum`\<\[`"allowed"`, `"denied"`, `"succeeded"`, `"failed"`, `"escalated"`, `"interrupted"`\]\>; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `reason`: `ZodOptional`\<`ZodString`>\>; `receiver`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `requestedAuthority`: `ZodOptional`\<`ZodObject`\<\{ `capabilities`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<...\>; `path`: `ZodArray`\<..., ...\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `constraints`: `ZodOptional`\<`ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: `ZodOptional`\<`ZodNumber`>\>; `expiresAt`: `ZodOptional`\<`ZodString`>\>; `maxUses`: `ZodOptional`\<`ZodNumber`>\>; `notBefore`: `ZodOptional`\<`ZodString`>\>; `purposes`: `ZodOptional`\<`ZodArray`\<..., ...\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}\>, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>\>; `id`: `ZodString`; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `requestedAt`: `ZodString`; `requester`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>\>; `resource`: `ZodOptional`\<`ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<...\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<...\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<...\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<...\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>\>; `source`: `ZodOptional`\<`ZodEnum`\<\[`"kernel"`, `"envelope"`\]\>\>; `tool`: `ZodOptional`\<`ZodString`>\>; `traceId`: `ZodString`; `type`: `ZodEnum`\<\[`"authority.resolved"`, `"authorization.checked"`, `"escalation.requested"`, `"escalation.auto_decided"`, `"resource.invoked"`, `"tool.catalog.listed"`, `"tool.namespace.catalog.listed"`, `"tool.namespace.selection.updated"`, `"tool.invoked"`, `"message.sent"`, `"turn.ended"`\]\>; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `action?`: `string`; `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `at`: `string`; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authorityHash?`: `string`; `cause?`: `string`; `consumed?`: `boolean`; `endedBy?`: `"envelope"` \| `"runtime"`; `failClosed?`: `boolean`; `grantId?`: `string`; `id`: `string`; `messageId?`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `operationId?`: `string`; `outcome`: `"succeeded"` \| `"denied"` \| `"failed"` \| `"allowed"` \| `"escalated"` \| `"interrupted"`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `reason?`: `string`; `receiver?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `resource?`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `source?`: `"kernel"` \| `"envelope"`; `tool?`: `string`; `traceId`: `string`; `type`: `"authority.resolved"` \| `"authorization.checked"` \| `"escalation.requested"` \| `"escalation.auto_decided"` \| `"resource.invoked"` \| `"tool.catalog.listed"` \| `"tool.namespace.catalog.listed"` \| `"tool.namespace.selection.updated"` \| `"tool.invoked"` \| `"message.sent"` \| `"turn.ended"`; `version`: `"1"`; \}, \{ `action?`: `string`; `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `at`: `string`; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authorityHash?`: `string`; `cause?`: `string`; `consumed?`: `boolean`; `endedBy?`: `"envelope"` \| `"runtime"`; `failClosed?`: `boolean`; `grantId?`: `string`; `id`: `string`; `messageId?`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `operationId?`: `string`; `outcome`: `"succeeded"` \| `"denied"` \| `"failed"` \| `"allowed"` \| `"escalated"` \| `"interrupted"`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `reason?`: `string`; `receiver?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `resource?`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `source?`: `"kernel"` \| `"envelope"`; `tool?`: `string`; `traceId`: `string`; `type`: `"authority.resolved"` \| `"authorization.checked"` \| `"escalation.requested"` \| `"escalation.auto_decided"` \| `"resource.invoked"` \| `"tool.catalog.listed"` \| `"tool.namespace.catalog.listed"` \| `"tool.namespace.selection.updated"` \| `"tool.invoked"` \| `"message.sent"` \| `"turn.ended"`; `version`: `"1"`; \}\>

Defined in: [audit.ts:89](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L89)

One audit record, the durable shape a host persists.

The rule for where a fact lives (ADR 0023): what SharedOS itself states about
every event of a kind is a field, typed here; `metadata` holds what a host
port supplied and the details particular to one event type. The two were one
untyped bag until a port's metadata began to be recorded beside the kernel's
own flags, at which point a port could overwrite a flag the kernel had not
set. Fields cannot be collided with.

The kernel-stated fields, since an inferred type renders here without them:
`source` (`kernel` or `envelope`, who performed or refused the operation;
never on `turn.ended`), `cause` (which situation a coarse `reason` stood in
for, on `tool.invoked`), `failClosed` (present and `true` when SharedOS could
not establish a fact and refused rather than guess), `consumed` (whether a
bounded use was spent, on `authorization.checked`), `endedBy` (`envelope` or
`runtime`, who ended a failed turn), `requestedAuthority` (what an escalation
asks for), and `id`, the record's identity and the only safe idempotency key.
`docs/errors.md`, "Audit events", has the table and the `metadata` keys a host
may rely on per event type.

---

### AuditEventTypeSchema

> `const` **AuditEventTypeSchema**: `ZodEnum`\<\[`"authority.resolved"`, `"authorization.checked"`, `"escalation.requested"`, `"escalation.auto_decided"`, `"resource.invoked"`, `"tool.catalog.listed"`, `"tool.namespace.catalog.listed"`, `"tool.namespace.selection.updated"`, `"tool.invoked"`, `"message.sent"`, `"turn.ended"`\]\>

Defined in: [audit.ts:8](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L8)

---

### AuditOutcomeSchema

> `const` **AuditOutcomeSchema**: `ZodEnum`\<\[`"allowed"`, `"denied"`, `"succeeded"`, `"failed"`, `"escalated"`, `"interrupted"`\]\>

Defined in: [audit.ts:46](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L46)

`escalated` is its own outcome, not a denial.

A denial is a decision SharedOS made. An escalation is a decision it declined
to make and handed to a human, and counting the two together would inflate
every denial rate by the cases where the system correctly asked for help.

`interrupted` is its own outcome, not a failure. It is written for an
operation whose port was entered and stopped before it answered -- a turn that
timed out or was cancelled mid-call, or an audit outage under a decision the
port itself asked for -- so any part of its effect may have committed.
`failed` also covers refusals where nothing ran, and a reader that took an
interrupted call for one of those would retry something already done.

---

### AuditSourceSchema

> `const` **AuditSourceSchema**: `ZodEnum`\<\[`"kernel"`, `"envelope"`\]\>

Defined in: [audit.ts:65](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/audit.ts#L65)

Which enforcement boundary performed or refused what an event records.

It was free to infer until the execution envelope began recording as well --
anything in audit was the kernel's, because the envelope wrote nothing -- and
the moment that stopped being true it became a fact with nowhere to live.
ADR 0012 keeps one refusal vocabulary across both boundaries on purpose: a
code says what was refused, and this says who refused it (ADR 0023).

---

### AuthorizationDecisionSchema

> `const` **AuthorizationDecisionSchema**: `ZodObject`\<\{ `allowed`: `ZodBoolean`; `matchedGrantId`: `ZodOptional`\<`ZodString`>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `reasonCode`: `ZodString`; `requiredAuthority`: `ZodOptional`\<`ZodObject`\<\{ `capabilities`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<...\>; `path`: `ZodArray`\<..., ...\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `constraints`: `ZodOptional`\<`ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: `ZodOptional`\<`ZodNumber`>\>; `expiresAt`: `ZodOptional`\<`ZodString`>\>; `maxUses`: `ZodOptional`\<`ZodNumber`>\>; `notBefore`: `ZodOptional`\<`ZodString`>\>; `purposes`: `ZodOptional`\<`ZodArray`\<..., ...\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}\>, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>\>; `id`: `ZodString`; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `requestedAt`: `ZodString`; `requester`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `allowed`: `boolean`; `matchedGrantId?`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `reasonCode`: `string`; `requiredAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; \}, \{ `allowed`: `boolean`; `matchedGrantId?`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `reasonCode`: `string`; `requiredAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; \}\>

Defined in: [access.ts:40](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/access.ts#L40)

A portable explanation of one authorization check.

---

### CapabilityConstraintsSchema

> `const` **CapabilityConstraintsSchema**: `ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: `ZodOptional`\<`ZodNumber`>\>; `expiresAt`: `ZodOptional`\<`ZodString`>\>; `maxUses`: `ZodOptional`\<`ZodNumber`>\>; `notBefore`: `ZodOptional`\<`ZodString`>\>; `purposes`: `ZodOptional`\<`ZodArray`\<`ZodString`, `"many"`>>\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>

Defined in: [capability.ts:48](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L48)

---

### CapabilityGrantSchema

> `const` **CapabilityGrantSchema**: `ZodEffects`\<`ZodObject`\<\{ `capabilities`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[..., ..., ..., ...\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `constraints`: `ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: `ZodOptional`\<`ZodNumber`>\>; `expiresAt`: `ZodOptional`\<`ZodString`>\>; `maxUses`: `ZodOptional`\<`ZodNumber`>\>; `notBefore`: `ZodOptional`\<`ZodString`>\>; `purposes`: `ZodOptional`\<`ZodArray`\<`ZodString`, `"many"`>>\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>; `id`: `ZodString`; `issuedAt`: `ZodString`; `issuer`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `parentGrantId`: `ZodOptional`\<`ZodString`>\>; `revokedAt`: `ZodOptional`\<`ZodString`>\>; `subject`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `capabilities`: `object`[]; `constraints`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `issuedAt`: `string`; `issuer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `parentGrantId?`: `string`; `revokedAt?`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `issuedAt`: `string`; `issuer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `parentGrantId?`: `string`; `revokedAt?`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>, \{ `capabilities`: `object`[]; `constraints`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `issuedAt`: `string`; `issuer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `parentGrantId?`: `string`; `revokedAt?`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `issuedAt`: `string`; `issuer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `parentGrantId?`: `string`; `revokedAt?`: `string`; `subject`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>

Defined in: [capability.ts:118](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L118)

Authority issued to one subject and bounded by explicit constraints.

A grant that was derived from another grant names its immediate ancestor in
`parentGrantId`. The link is a claim, not proof: SharedOS resolves and
validates the complete chain before the grant may authorize anything.

`deriveGrant` in `@aicoo/sharedos-core` is the supported way to produce one.
It only ever emits this single link: a chain embedded in the grant would be
provenance the presenter controls, and the ancestors are re-resolved from the
issuing store at every decision instead.

---

### CapabilityRequestSchema

> `const` **CapabilityRequestSchema**: `ZodObject`\<\{ `capabilities`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `constraints`: `ZodOptional`\<`ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: `ZodOptional`\<`ZodNumber`>\>; `expiresAt`: `ZodOptional`\<`ZodString`>\>; `maxUses`: `ZodOptional`\<`ZodNumber`>\>; `notBefore`: `ZodOptional`\<`ZodString`>\>; `purposes`: `ZodOptional`\<`ZodArray`\<`ZodString`, `"many"`>>\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>\>; `id`: `ZodString`; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `requestedAt`: `ZodString`; `requester`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>

Defined in: [capability.ts:90](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L90)

A request for authority. A request is not itself proof of authority.

Two places produce one and none accepts one as input. A denial that matched no
grant describes what would have satisfied it, and an escalation may carry that
description on to whoever resolves it. Both are descriptions: turning one into
usable authority is the host's issuing workflow, which ends in a grant the
next turn loads (ADR 0019).

`id`, `namespaceId`, `requester`, `owner`, and `requestedAt` are minted by the
kernel from the trusted access context, whatever a caller wrote: a request
the caller authored would be a caller-chosen correlation for a decision the
kernel made. `id` is derived from the ask -- namespace, requester, owner,
purpose, constraints, capabilities -- rather than generated, so the same ask
describes itself the same way twice, and `requestedAt` is left out of it so
the identifier survives across turns.

---

### CapabilityRequirementSchema

> `const` **CapabilityRequirementSchema**: `ZodObject`\<\{ `action`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}\>

Defined in: [capability.ts:145](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L145)

The exact capability a tool invocation requires.

---

### CapabilitySchema

> `const` **CapabilitySchema**: `ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}\>

Defined in: [capability.ts:38](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L38)

A positive capability. SharedOS is deny-by-default when no grant matches.

---

### EnabledToolNamespacesSchema

> `const` **EnabledToolNamespacesSchema**: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>

Defined in: [tool.ts:52](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L52)

---

### EscalationSchema

> `const` **EscalationSchema**: `ZodObject`\<\{ `reason`: `ZodString`; `requestedAt`: `ZodString`; `requestedAuthority`: `ZodOptional`\<`ZodObject`\<\{ `capabilities`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<...\>; `path`: `ZodArray`\<..., ...\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `constraints`: `ZodOptional`\<`ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: `ZodOptional`\<`ZodNumber`>\>; `expiresAt`: `ZodOptional`\<`ZodString`>\>; `maxUses`: `ZodOptional`\<`ZodNumber`>\>; `notBefore`: `ZodOptional`\<`ZodString`>\>; `purposes`: `ZodOptional`\<`ZodArray`\<..., ...\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}\>, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}, \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}\>\>; `id`: `ZodString`; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `requestedAt`: `ZodString`; `requester`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>\>; `reviewer`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `status`: `ZodLiteral`\<`"pending"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}, \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}\>

Defined in: [execution.ts:70](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L70)

A stopped turn awaiting a human decision.

This is a stub by design. SharedOS records that authority was asked for, who
would decide it, and when -- and nothing else. It does not model review
queues, approval tokens, or resumption, because granting authority is
host-owned control-plane work and an escalation that could be resolved from
inside a turn would be an escalation an agent could grant itself.

`reviewer` is assumed rather than resolved: it is the owner the turn already
runs on behalf of. A host with a real review roster substitutes its own.

---

### ExecutionEventSchema

> `const` **ExecutionEventSchema**: `ZodObject`\<\{ `data`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `eventId`: `ZodString`; `executionId`: `ZodString`; `occurredAt`: `ZodString`; `sequence`: `ZodNumber`; `traceId`: `ZodString`; `type`: `ZodString`; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `data`: [`JsonValue`](#jsonvalue); `eventId`: `string`; `executionId`: `string`; `occurredAt`: `string`; `sequence`: `number`; `traceId`: `string`; `type`: `string`; `version`: `"1"`; \}, \{ `data`: [`JsonValue`](#jsonvalue); `eventId`: `string`; `executionId`: `string`; `occurredAt`: `string`; `sequence`: `number`; `traceId`: `string`; `type`: `string`; `version`: `"1"`; \}\>

Defined in: [execution.ts:43](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L43)

An append-only event emitted while executing a request.

---

### ExecutionOptionsSchema

> `const` **ExecutionOptionsSchema**: `ZodObject`\<\{ `maxSteps`: `ZodOptional`\<`ZodNumber`>\>; `maxToolCalls`: `ZodOptional`\<`ZodNumber`>\>; `timeoutMs`: `ZodOptional`\<`ZodNumber`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}\>

Defined in: [execution.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L15)

---

### ExecutionRequestSchema

> `const` **ExecutionRequestSchema**: `ZodObject`\<\{ `agent`: `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>; `context`: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>; `executionId`: `ZodString`; `message`: `ZodObject`\<\{ `createdAt`: `ZodString`; `id`: `ZodString`; `payload`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `provenance`: `ZodOptional`\<`ZodObject`\<\{ `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `parentIds`: `ZodArray`\<`ZodString`, `"many"`>\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}\>\>; `purpose`: `ZodString`; `receiver`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `replyTo`: `ZodOptional`\<`ZodString`>\>; `sender`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `traceId`: `ZodString`; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `options`: `ZodOptional`\<`ZodObject`\<\{ `maxSteps`: `ZodOptional`\<`ZodNumber`>\>; `maxToolCalls`: `ZodOptional`\<`ZodNumber`>\>; `timeoutMs`: `ZodOptional`\<`ZodNumber`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}\>\>; `state`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `tools`: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<\{ `destructive`: `ZodOptional`\<`ZodBoolean`>\>; `idempotent`: `ZodOptional`\<`ZodBoolean`>\>; `readOnly`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `name`: `ZodString`; `namespace`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `readWrite`: `ZodEnum`\<\[`"read"`, `"write"`\]\>; `requiredCapability`: `ZodObject`\<\{ `action`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<...\>; `path`: `ZodArray`\<..., ...\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; \}\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, `"many"`>\>; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `context`: \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](#jsonobject); `tools`: `object`[]; `version`: `"1"`; \}, \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `context`: \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](#jsonobject); `tools`: `object`[]; `version`: `"1"`; \}\>

Defined in: [execution.ts:26](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L26)

One permission-controlled agent turn. Tick scheduling stays with the host.

---

### ExecutionResultSchema

> `const` **ExecutionResultSchema**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}\>\]\>

Defined in: [execution.ts:105](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L105)

---

### GroupAddressSchema

> `const` **GroupAddressSchema**: `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>

Defined in: [address.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L15)

---

### HumanAddressSchema

> `const` **HumanAddressSchema**: `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>

Defined in: [address.ts:5](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L5)

---

### IdentifierSchema

> `const` **IdentifierSchema**: `ZodString`

Defined in: [common.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L28)

An opaque identifier. Callers choose its format; SharedOS only requires stability.

---

### JsonObjectSchema

> `const` **JsonObjectSchema**: `z.ZodType`\<[`JsonObject`](#jsonobject)>\>

Defined in: [json.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L27)

---

### JsonValueSchema

> `const` **JsonValueSchema**: `z.ZodType`\<[`JsonValue`](#jsonvalue)>\>

Defined in: [json.ts:16](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L16)

Any value that can round-trip through JSON without custom serialization.
In particular, this rejects undefined, bigint, Date, NaN, and Infinity.

---

### MAX\_EXECUTION\_TIMEOUT\_MS

> `const` **MAX\_EXECUTION\_TIMEOUT\_MS**: `600000` = `600_000`

Defined in: [execution.ts:12](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L12)

---

### MAX\_EXECUTION\_TOOL\_CALLS

> `const` **MAX\_EXECUTION\_TOOL\_CALLS**: `10000` = `10_000`

Defined in: [execution.ts:13](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/execution.ts#L13)

---

### MessageDeliveryResultSchema

> `const` **MessageDeliveryResultSchema**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"accepted"`; `timestamp`: `string`; \}, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"accepted"`; `timestamp`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"delivered"`; `timestamp`: `string`; \}, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"delivered"`; `timestamp`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `timestamp`: `string`; \}, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `timestamp`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `timestamp`: `string`; \}, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `timestamp`: `string`; \}\>\]\>

Defined in: [message.ts:82](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L82)

The transport-neutral outcome of submitting a message for delivery.

---

### MessageEnvelopeSchema

> `const` **MessageEnvelopeSchema**: `ZodObject`\<\{ `createdAt`: `ZodString`; `id`: `ZodString`; `payload`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `provenance`: `ZodOptional`\<`ZodObject`\<\{ `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `parentIds`: `ZodArray`\<`ZodString`, `"many"`>\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}\>\>; `purpose`: `ZodString`; `receiver`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `replyTo`: `ZodOptional`\<`ZodString`>\>; `sender`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `traceId`: `ZodString`; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}\>

Defined in: [message.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L27)

A message carries data and one host-bound purpose, never authority. Authority
is supplied separately through AccessContext and evaluated at the point of use.

---

### MessageProvenanceSchema

> `const` **MessageProvenanceSchema**: `ZodObject`\<\{ `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `parentIds`: `ZodArray`\<`ZodString`, `"many"`>\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}\>

Defined in: [message.ts:13](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L13)

Hop provenance a host may attach to an envelope. It is host-owned metadata:
the kernel checks its shape with the rest of the envelope, neither sets nor
reads it, and hands it to the transport as the host sent it.

---

### MessageRequestArgumentsSchema

> `const` **MessageRequestArgumentsSchema**: `ZodObject`\<\{ `payload`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `recipient`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>\>; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>\>; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodEffects`\<`ZodEffects`\<`ZodString`, `string`, `string`>\>, `string`, `string`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `payload`: [`JsonValue`](#jsonvalue); `recipient`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `payload`: [`JsonValue`](#jsonvalue); `recipient`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>

Defined in: [message.ts:66](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/message.ts#L66)

The complete and intentionally narrow message input a model may author.

---

### PathSegmentSchema

> `const` **PathSegmentSchema**: `ZodString`

Defined in: [capability.ts:15](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L15)

One opaque resource-path segment.

Separators, traversal markers, and control characters are rejected here so
every host receives the same canonical path vocabulary. Filesystem-backed
providers must still resolve beneath their configured root and reject
symlink escapes.

---

### PROTOCOL\_VERSION

> `const` **PROTOCOL\_VERSION**: `"1"`

Defined in: [common.ts:10](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L10)

The wire protocol version implemented by this package, as the one value
every request, event, result, envelope and manifest stamps on itself.

`"1"` is the shape `1.0.0-preview` shipped and is frozen there: a change a
`1.0.0-preview` reader would reject moves this value (ADR 0019).

---

### ProtocolErrorSchema

> `const` **ProtocolErrorSchema**: `ZodObject`\<\{ `code`: `ZodString`; `details`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `message`: `ZodString`; `retryable`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}, \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}\>

Defined in: [protocol-error.ts:7](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/protocol-error.ts#L7)

A machine-readable error that is safe to return over npm and HTTP APIs.

---

### ProtocolVersionSchema

> `const` **ProtocolVersionSchema**: `ZodLiteral`\<`"1"`>\>

Defined in: [common.ts:13](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L13)

The wire protocol version implemented by this package.

---

### PublishedToolAnnotationsSchema

> `const` **PublishedToolAnnotationsSchema**: `ZodObject`\<\{ `destructiveHint`: `ZodOptional`\<`ZodBoolean`>\>; `idempotentHint`: `ZodOptional`\<`ZodBoolean`>\>; `openWorldHint`: `ZodOptional`\<`ZodBoolean`>\>; `readOnlyHint`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}, \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}\>

Defined in: [tool.ts:156](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L156)

MCP tool annotation hints, in the vocabulary a harness receives them in.

These are the same three facts [ToolAnnotationsSchema](#toolannotationsschema) carries, renamed
to the MCP wire spelling. They stay a separate type rather than a rename at
the edge because they are a _hint_ surface: advisory metadata a model may use
to decide how to call a tool, and never an authorization input on either side
of the boundary.

`openWorldHint` has no SharedOS equivalent and is therefore never emitted.
Inventing a value for it would put an unfixed field into `catalogHash`.

---

### PublishedToolDefinitionSchema

> `const` **PublishedToolDefinitionSchema**: `ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<\{ `destructiveHint`: `ZodOptional`\<`ZodBoolean`>\>; `idempotentHint`: `ZodOptional`\<`ZodBoolean`>\>; `openWorldHint`: `ZodOptional`\<`ZodBoolean`>\>; `readOnlyHint`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}, \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodObject`\<\{ `namespace`: `ZodOptional`\<`ZodString`>\>; `source`: `ZodOptional`\<`ZodString`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace?`: `string`; `source?`: `string`; \}, \{ `namespace?`: `string`; `source?`: `string`; \}\>\>; `name`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: \{ `namespace?`: `string`; `source?`: `string`; \}; `name`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); \}, \{ `annotations?`: \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: \{ `namespace?`: `string`; `source?`: `string`; \}; `name`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); \}\>

Defined in: [tool.ts:190](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L190)

Everything a model or harness is allowed to see about one tool.

This is the projection SharedOS publishes across the MCP boundary, and it is
defined by what it omits. `requiredCapability`, `resolveRequirement`, grants,
issuing authority, namespace settings, credentials, and handler references do
not appear here and never cross the boundary: a harness receives the operation
surface, and SharedOS keeps the authority.

`name` is the canonical SharedOS tool ID and is simultaneously the raw MCP
`Tool.name`. There is deliberately no second identity field. A published
catalogue with two names for one tool is a catalogue where authorization and
discovery can disagree, and [ToolNameSchema](#toolnameschema) exists precisely so the
canonical name is always carriable as-is.

---

### PublishedToolMetadataSchema

> `const` **PublishedToolMetadataSchema**: `ZodObject`\<\{ `namespace`: `ZodOptional`\<`ZodString`>\>; `source`: `ZodOptional`\<`ZodString`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace?`: `string`; `source?`: `string`; \}, \{ `namespace?`: `string`; `source?`: `string`; \}\>

Defined in: [tool.ts:167](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L167)

Catalogue provenance a harness may see. Metadata, never proof of authority.

---

### ReachListSchema

> `const` **ReachListSchema**: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `namespace`: `ZodString`; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>

Defined in: [capability.ts:180](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L180)

As many entries as one reach may carry, on a card or on the wire.

---

### ReachResultSchema

> `const` **ReachResultSchema**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<\{ `reach`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `namespace`: `ZodString`; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `status`: `ZodLiteral`\<`"computed"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `reach`: `object`[]; `status`: `"computed"`; \}, \{ `reach`: `object`[]; `status`: `"computed"`; \}\>, `ZodObject`\<\{ `reasonCode`: `ZodEnum`\<\[`"authority_unavailable"`, `"usage_store_unavailable"`\]\>; `status`: `ZodLiteral`\<`"unavailable"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `reasonCode`: `"authority_unavailable"` \| `"usage_store_unavailable"`; `status`: `"unavailable"`; \}, \{ `reasonCode`: `"authority_unavailable"` \| `"usage_store_unavailable"`; `status`: `"unavailable"`; \}\>\]\>

Defined in: [capability.ts:207](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L207)

What asking for a reach answers.

`computed` carries the reachable surface, possibly empty: a context that can
authorize nothing reaches nothing, and that is a true answer. `unavailable`
means no answer could be established, and says why in the vocabulary a denial
uses. The shape crosses the HTTP boundary unchanged, so a remote caller reads
the same result an embedded host does.

---

### ReachSummarySchema

> `const` **ReachSummarySchema**: `ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `entries`: `ZodNumber`; `namespace`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `entries`: `number`; `namespace`: `string`; \}, \{ `actions`: `string`[]; `entries`: `number`; `namespace`: `string`; \}\>

Defined in: [card.ts:41](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/card.ts#L41)

One namespace the subject reaches, and how much of it, without paths.

`entries` counts the reach entries collapsed into this row, not resources: a
single `descendants` entry over a whole tree counts once, exactly as it
appears in `reach`. Counting resources would require asking a provider what
exists, which is the lookup a card must never become.

---

### ReachUnavailableReasonSchema

> `const` **ReachUnavailableReasonSchema**: `ZodEnum`\<\[`"authority_unavailable"`, `"usage_store_unavailable"`\]\>

Defined in: [capability.ts:192](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L192)

Why a reach could not be established.

Both are infrastructure codes the decide path already fails closed with: the
authority behind the reach could not be loaded, or a bounded grant's budget
could not be read. Neither narrows the answer. A reach that silently omitted
a live grant because a dependency is down would look exactly like one that is
true, so the whole answer is withheld under a code the reader can act on
(ADR 0021).

---

### RemoteExecutionRequestSchema

> `const` **RemoteExecutionRequestSchema**: `ZodObject`\<`Omit`\<\{ `agent`: `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>; `context`: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>; `executionId`: `ZodString`; `message`: `ZodObject`\<\{ `createdAt`: `ZodString`; `id`: `ZodString`; `payload`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `provenance`: `ZodOptional`\<`ZodObject`\<\{ `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `parentIds`: `ZodArray`\<`ZodString`, `"many"`>\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}\>\>; `purpose`: `ZodString`; `receiver`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `replyTo`: `ZodOptional`\<`ZodString`>\>; `sender`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `traceId`: `ZodString`; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `options`: `ZodOptional`\<`ZodObject`\<\{ `maxSteps`: `ZodOptional`\<`ZodNumber`>\>; `maxToolCalls`: `ZodOptional`\<`ZodNumber`>\>; `timeoutMs`: `ZodOptional`\<`ZodNumber`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}\>\>; `state`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `tools`: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<\{ `destructive`: `ZodOptional`\<...\>; `idempotent`: `ZodOptional`\<...\>; `readOnly`: `ZodOptional`\<...\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructive?`: ... \| ... \| ...; `idempotent?`: ... \| ... \| ...; `readOnly?`: ... \| ... \| ...; \}, \{ `destructive?`: ... \| ... \| ...; `idempotent?`: ... \| ... \| ...; `readOnly?`: ... \| ... \| ...; \}\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `name`: `ZodString`; `namespace`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `readWrite`: `ZodEnum`\<\[`"read"`, `"write"`\]\>; `requiredCapability`: `ZodObject`\<\{ `action`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: ...; `owner`: ...; `path`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: ...; `owner?`: ...; `path`: ...; \}, \{ `namespace`: ...; `owner?`: ...; `path`: ...; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}; \}, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}; \}\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, `"many"`>\>; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"tools"` \| `"context"`>\>, `"strict"`, `ZodTypeAny`, \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](#jsonobject); `version`: `"1"`; \}, \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](#jsonobject); `version`: `"1"`; \}\>

Defined in: [http.ts:24](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L24)

Turn request accepted over HTTP; authority and visible tools are host-derived.

---

### RemoteResourceOperationSchema

> `const` **RemoteResourceOperationSchema**: `ZodObject`\<`Omit`\<\{ `action`: `ZodString`; `context`: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>; `input`: `ZodOptional`\<`ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>>\>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `operationId`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<...\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<...\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<...\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<...\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; \}, `"context"`>\>, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `input?`: [`JsonValue`](#jsonvalue); `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `input?`: [`JsonValue`](#jsonvalue); `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}\>

Defined in: [http.ts:18](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L18)

Resource operation accepted over HTTP; authority is injected by the host.

---

### ReplayKeySchema

> `const` **ReplayKeySchema**: `ZodObject`\<\{ `id`: `ZodString`; `kind`: `ZodEnum`\<\[`"execution"`, `"tool"`, `"resource"`, `"message"`\]\>; `namespaceId`: `ZodString`; `scope`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}, \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}\>

Defined in: [replay.ts:7](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/replay.ts#L7)

A structural tenant-scoped identity; scope is an execution ID for tool calls.

---

### ReplayRecordSchema

> `const` **ReplayRecordSchema**: `ZodEffects`\<`ZodObject`\<\{ `fingerprint`: `ZodString`; `key`: `ZodObject`\<\{ `id`: `ZodString`; `kind`: `ZodEnum`\<\[`"execution"`, `"tool"`, `"resource"`, `"message"`\]\>; `namespaceId`: `ZodString`; `scope`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}, \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}\>; `result`: `ZodOptional`\<`ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>>\>\>; `state`: `ZodEnum`\<\[`"pending"`, `"completed"`, `"failed"`, `"interrupted"`, `"expired"`\]\>; `token`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `fingerprint`: `string`; `key`: \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}; `result?`: [`JsonValue`](#jsonvalue); `state`: `"failed"` \| `"interrupted"` \| `"pending"` \| `"completed"` \| `"expired"`; `token`: `string`; \}, \{ `fingerprint`: `string`; `key`: \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}; `result?`: [`JsonValue`](#jsonvalue); `state`: `"failed"` \| `"interrupted"` \| `"pending"` \| `"completed"` \| `"expired"`; `token`: `string`; \}\>, \{ `fingerprint`: `string`; `key`: \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}; `result?`: [`JsonValue`](#jsonvalue); `state`: `"failed"` \| `"interrupted"` \| `"pending"` \| `"completed"` \| `"expired"`; `token`: `string`; \}, \{ `fingerprint`: `string`; `key`: \{ `id`: `string`; `kind`: `"message"` \| `"resource"` \| `"tool"` \| `"execution"`; `namespaceId`: `string`; `scope`: `string`; \}; `result?`: [`JsonValue`](#jsonvalue); `state`: `"failed"` \| `"interrupted"` \| `"pending"` \| `"completed"` \| `"expired"`; `token`: `string`; \}\>

Defined in: [replay.ts:18](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/replay.ts#L18)

Durable identity survives result-body expiry and never becomes claimable again.

---

### ResourceOperationSchema

> `const` **ResourceOperationSchema**: `ZodObject`\<\{ `action`: `ZodString`; `context`: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>; `input`: `ZodOptional`\<`ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>>\>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `operationId`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `context`: \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}; `input?`: [`JsonValue`](#jsonvalue); `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `context`: \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}; `input?`: [`JsonValue`](#jsonvalue); `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}\>

Defined in: [resource.ts:10](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/resource.ts#L10)

A self-contained request to perform one permission-controlled operation.

---

### ResourceReachSchema

> `const` **ResourceReachSchema**: `ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `namespace`: `ZodString`; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `scope`: `ZodEnum`\<\[`"exact"`, `"descendants"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}\>

Defined in: [capability.ts:168](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L168)

Where an actor may operate, with the authority stripped out.

A reader needs to know which paths are worth naming — otherwise it guesses
and collects denials — but it must not learn who granted the access, for how
long, or how many uses remain. This carries the shape of the reachable
surface and nothing else. It is descriptive: every call is still authorized
independently, so a stale or over-wide `ResourceReach` cannot permit
anything.

The owner is deliberately absent as well. Reach is always derived under one
access context and describes that context's world; carrying an owner would
invite a reader to treat an entry as portable to another.

---

### ResourceRefSchema

> `const` **ResourceRefSchema**: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>

Defined in: [capability.ts:27](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/capability.ts#L27)

A host-independent reference to a resource exposed through SharedOS.

---

### ResourceResultSchema

> `const` **ResourceResultSchema**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; \}, \{ `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"denied"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"denied"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"failed"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"failed"`; \}\>\]\>

Defined in: [resource.ts:29](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/resource.ts#L29)

---

### RuntimeEventSchema

> `const` **RuntimeEventSchema**: `ZodObject`\<\{ `data`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `type`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `data`: [`JsonValue`](#jsonvalue); `type`: `string`; \}, \{ `data`: [`JsonValue`](#jsonvalue); `type`: `string`; \}\>

Defined in: [runtime.ts:20](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/runtime.ts#L20)

A runtime-originated observation. The SharedOS envelope assigns its audit identity.

---

### RuntimeManifestSchema

> `const` **RuntimeManifestSchema**: `ZodObject`\<\{ `id`: `ZodString`; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `protocolVersion`: `ZodLiteral`\<`"1"`>\>; `version`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `protocolVersion`: `"1"`; `version`: `string`; \}, \{ `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `protocolVersion`: `"1"`; `version`: `string`; \}\>

Defined in: [runtime.ts:8](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/runtime.ts#L8)

Stable, JSON-safe provenance for one installed runtime implementation.

---

### RuntimeTurnOutcomeSchema

> `const` **RuntimeTurnOutcomeSchema**: `ZodDiscriminatedUnion`\<`"type"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `type`: `"complete"`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `type`: `"complete"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `type`: `"fail"`; \}, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `type`: `"fail"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `reason`: `string`; `type`: `"escalate"`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `reason`: `string`; `type`: `"escalate"`; \}\>\]\>

Defined in: [runtime.ts:43](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/runtime.ts#L43)

The only terminal outcomes a runtime plugin may return for one bounded turn.

`escalate` is a third terminal state rather than a flavour of `fail`. A turn
that stopped because it needed authority it does not hold is a different
event from one that was refused and from one that erred, and collapsing it
into either would make "the agent asked for help" unrecoverable from the
record. It grants nothing: SharedOS records the request, names the reviewer
the host would route it to, and stops.

---

### ServiceAddressSchema

> `const` **ServiceAddressSchema**: `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>

Defined in: [address.ts:20](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/address.ts#L20)

---

### SHAREDOS\_API\_ERROR\_CODES

> `const` **SHAREDOS\_API\_ERROR\_CODES**: readonly \[`"invalid_access_context"`, `"invalid_json"`, `"invalid_request"`, `"permission_denied"`, `"not_found"`, `"method_not_allowed"`, `"internal_error"`\]

Defined in: [http.ts:47](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L47)

The codes the SharedOS HTTP handler itself answers with. A kernel refusal
travels inside a `200` result under its own vocabulary (`docs/errors.md`);
these are the failures of the request as a request.

The wire schema below keeps `code` a string so that an older client still
reads a code a newer server added; the union is for the producing side and
for a reader that wants to switch on the known ones.

---

### SHAREDOS\_ROUTES

> `const` **SHAREDOS\_ROUTES**: `object`

Defined in: [http.ts:99](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L99)

The HTTP surface, as one table the handler routes from and the client calls
through. A path with two verbs is two entries; the handler derives the
allowed verbs for a path from the table, so there is no second list to keep
in step. `docs/http-api.md` describes the same table for a reader.

#### Type Declaration

##### authorize

> `readonly` **authorize**: `object`

###### authorize.method

> `readonly` **method**: `"POST"` = `"POST"`

###### authorize.path

> `readonly` **path**: `"/v1/authorize"` = `"/v1/authorize"`

###### authorize.request

> `readonly` **request**: `ZodObject`\<\{ `action`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}\> = `CapabilityRequirementSchema`

###### authorize.response

> `readonly` **response**: `ZodObject`\<\{ `allowed`: `ZodBoolean`; `matchedGrantId`: `ZodOptional`\<`ZodString`>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `reasonCode`: `ZodString`; `requiredAuthority`: `ZodOptional`\<`ZodObject`\<\{ `capabilities`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<..., ...\>; `resource`: `ZodObject`\<..., ..., ..., ..., ...\>; `scope`: `ZodEnum`\<...\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: ...[]; `resource`: \{ `namespace`: ...; `owner?`: ...; `path`: ...; \}; `scope`: ... \| ...; \}, \{ `actions`: ...[]; `resource`: \{ `namespace`: ...; `owner?`: ...; `path`: ...; \}; `scope`: ... \| ...; \}\>, `"many"`>\>; `constraints`: `ZodOptional`\<`ZodEffects`\<`ZodObject`\<\{ `delegationDepth`: ...; `expiresAt`: ...; `maxUses`: ...; `notBefore`: ...; `purposes`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `delegationDepth?`: ...; `expiresAt?`: ...; `maxUses?`: ...; `notBefore?`: ...; `purposes?`: ...; \}, \{ `delegationDepth?`: ...; `expiresAt?`: ...; `maxUses?`: ...; `notBefore?`: ...; `purposes?`: ...; \}\>, \{ `delegationDepth?`: ... \| ...; `expiresAt?`: ... \| ...; `maxUses?`: ... \| ...; `notBefore?`: ... \| ...; `purposes?`: ... \| ...; \}, \{ `delegationDepth?`: ... \| ...; `expiresAt?`: ... \| ...; `maxUses?`: ... \| ...; `notBefore?`: ... \| ...; `purposes?`: ... \| ...; \}\>\>; `id`: `ZodString`; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `namespaceId`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `purpose`: `ZodString`; `requestedAt`: `ZodString`; `requester`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}, \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: ...[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `allowed`: `boolean`; `matchedGrantId?`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `reasonCode`: `string`; `requiredAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; \}, \{ `allowed`: `boolean`; `matchedGrantId?`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `reasonCode`: `string`; `requiredAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: `number`; `expiresAt?`: `string`; `maxUses?`: `number`; `notBefore?`: `string`; `purposes?`: `string`[]; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; \}; \}\> = `AuthorizationDecisionSchema`

##### executeTurn

> `readonly` **executeTurn**: `object`

###### executeTurn.method

> `readonly` **method**: `"POST"` = `"POST"`

###### executeTurn.path

> `readonly` **path**: `"/v1/turns"` = `"/v1/turns"`

###### executeTurn.request

> `readonly` **request**: `ZodObject`\<`Omit`\<\{ `agent`: `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>; `context`: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>; `executionId`: `ZodString`; `message`: `ZodObject`\<\{ `createdAt`: `ZodString`; `id`: `ZodString`; `payload`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `provenance`: `ZodOptional`\<`ZodObject`\<\{ `metadata`: `ZodOptional`\<...\>; `parentIds`: `ZodArray`\<..., ...\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `metadata?`: ... \| ...; `parentIds`: ...[]; `source`: `string`; \}, \{ `metadata?`: ... \| ...; `parentIds`: ...[]; `source`: `string`; \}\>\>; `purpose`: `ZodString`; `receiver`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `replyTo`: `ZodOptional`\<`ZodString`>\>; `sender`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `traceId`: `ZodString`; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `options`: `ZodOptional`\<`ZodObject`\<\{ `maxSteps`: `ZodOptional`\<`ZodNumber`>\>; `maxToolCalls`: `ZodOptional`\<`ZodNumber`>\>; `timeoutMs`: `ZodOptional`\<`ZodNumber`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}, \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}\>\>; `state`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `tools`: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<..., ..., ..., ..., ...\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodType`\<..., ..., ...\>\>; `name`: `ZodString`; `namespace`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<..., ..., ...\>\>; `readWrite`: `ZodEnum`\<\[..., ...\]\>; `requiredCapability`: `ZodObject`\<\{ `action`: ...; `resource`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `action`: ...; `resource`: ...; \}, \{ `action`: ...; `resource`: ...; \}\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructive?`: ...; `idempotent?`: ...; `readOnly?`: ...; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: ...; `owner?`: ...; `path`: ...; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: ...; `idempotent?`: ...; `readOnly?`: ...; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: ...; `owner?`: ...; `path`: ...; \}; \}; `source`: `string`; \}\>, \{ `annotations?`: \{ `destructive?`: ... \| ... \| ...; `idempotent?`: ... \| ... \| ...; `readOnly?`: ... \| ... \| ...; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: ... \| ... \| ...; `idempotent?`: ... \| ... \| ...; `readOnly?`: ... \| ... \| ...; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}; \}; `source`: `string`; \}\>, `"many"`>\>; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"tools"` \| `"context"`>\>, `"strict"`, `ZodTypeAny`, \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](#jsonobject); `version`: `"1"`; \}, \{ `agent`: \{ `agentId`: `string`; `kind`: `"agent"`; \}; `executionId`: `string`; `message`: \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}; `metadata?`: [`JsonObject`](#jsonobject); `options?`: \{ `maxSteps?`: `number`; `maxToolCalls?`: `number`; `timeoutMs?`: `number`; \}; `state?`: [`JsonObject`](#jsonobject); `version`: `"1"`; \}\> = `RemoteExecutionRequestSchema`

###### executeTurn.response

> `readonly` **response**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `startedAt`: `string`; `status`: `"succeeded"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"denied"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"failed"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `error?`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"cancelled"`; `traceId`: `string`; `version`: `"1"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: ...; `expiresAt?`: ...; `maxUses?`: ...; `notBefore?`: ...; `purposes?`: ...; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}, \{ `completedAt`: `string`; `escalation`: \{ `reason`: `string`; `requestedAt`: `string`; `requestedAuthority?`: \{ `capabilities`: `object`[]; `constraints?`: \{ `delegationDepth?`: ...; `expiresAt?`: ...; `maxUses?`: ...; `notBefore?`: ...; `purposes?`: ...; \}; `id`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `namespaceId`: `string`; `owner`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `purpose`: `string`; `requestedAt`: `string`; `requester`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; \}; `reviewer`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `status`: `"pending"`; \}; `events`: `object`[]; `executionId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `startedAt`: `string`; `status`: `"escalated"`; `traceId`: `string`; `version`: `"1"`; \}\>\]\> = `ExecutionResultSchema`

##### health

> `readonly` **health**: `object`

###### health.method

> `readonly` **method**: `"GET"` = `"GET"`

###### health.path

> `readonly` **path**: `"/health"` = `"/health"`

###### health.response

> `readonly` **response**: `ZodObject`\<\{ `protocolVersion`: `ZodLiteral`\<`"1"`>\>; `status`: `ZodLiteral`\<`"ok"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `protocolVersion`: `"1"`; `status`: `"ok"`; \}, \{ `protocolVersion`: `"1"`; `status`: `"ok"`; \}\> = `SharedOSHealthSchema`

##### invokeResource

> `readonly` **invokeResource**: `object`

###### invokeResource.method

> `readonly` **method**: `"POST"` = `"POST"`

###### invokeResource.path

> `readonly` **path**: `"/v1/resources/invoke"` = `"/v1/resources/invoke"`

###### invokeResource.request

> `readonly` **request**: `ZodObject`\<`Omit`\<\{ `action`: `ZodString`; `context`: `ZodObject`\<\{ `actor`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `authority`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `enabledToolNamespaces`: `ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>; `executionId`: `ZodOptional`\<`ZodString`>\>; `namespaceId`: `ZodString`; `now`: `ZodString`; `owner`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: ...; `userId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `userId`: ...; \}, \{ `kind`: ...; `userId`: ...; \}\>, `ZodObject`\<\{ `agentId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: ...; `kind`: ...; \}, \{ `agentId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `conversationId`: ...; `kind`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: ...; `kind`: ...; \}, \{ `conversationId`: ...; `kind`: ...; \}\>, `ZodObject`\<\{ `kind`: ...; `serviceId`: ...; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: ...; `serviceId`: ...; \}, \{ `kind`: ...; `serviceId`: ...; \}\>\]\>; `purpose`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}, \{ `actor`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `authority`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `enabledToolNamespaces`: `string`[]; `executionId?`: `string`; `namespaceId`: `string`; `now`: `string`; `owner`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `purpose`: `string`; `traceId`: `string`; \}\>; `input`: `ZodOptional`\<`ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>>\>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `operationId`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; \}, `"context"`>\>, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `input?`: [`JsonValue`](#jsonvalue); `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `input?`: [`JsonValue`](#jsonvalue); `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}\> = `RemoteResourceOperationSchema`

###### invokeResource.response

> `readonly` **response**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; \}, \{ `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"denied"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"denied"`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"failed"`; \}, \{ `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `operationId`: `string`; `status`: `"failed"`; \}\>\]\> = `ResourceResultSchema`

##### invokeTool

> `readonly` **invokeTool**: `object`

###### invokeTool.method

> `readonly` **method**: `"POST"` = `"POST"`

###### invokeTool.path

> `readonly` **path**: `"/v1/tools/invoke"` = `"/v1/tools/invoke"`

###### invokeTool.request

> `readonly` **request**: `ZodObject`\<\{ `arguments`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `id`: `ZodString`; `requestedAt`: `ZodString`; `tool`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `arguments`: [`JsonObject`](#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \}, \{ `arguments`: [`JsonObject`](#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \}\> = `ToolCallSchema`

###### invokeTool.response

> `readonly` **response**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \}, \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `tool`: `string`; \}, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `tool`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `tool`: `string`; \}, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>\]\> = `ToolResultSchema`

##### listToolNamespaces

> `readonly` **listToolNamespaces**: `object`

###### listToolNamespaces.method

> `readonly` **method**: `"GET"` = `"GET"`

###### listToolNamespaces.path

> `readonly` **path**: `"/v1/tools/namespaces"` = `"/v1/tools/namespaces"`

###### listToolNamespaces.response

> `readonly` **response**: `ZodEffects`\<`ZodObject`\<\{ `namespaces`: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `enabled`: `ZodBoolean`; `namespace`: `ZodString`; `sources`: `ZodArray`\<`ZodString`, `"many"`>\>; `toolCount`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, `"many"`>\>; `summary`: `ZodObject`\<\{ `disabled`: `ZodNumber`; `enabled`: `ZodNumber`; `total`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}, \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}\>, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}\> = `ToolNamespaceCatalogSchema`

##### listTools

> `readonly` **listTools**: `object`

###### listTools.method

> `readonly` **method**: `"GET"` = `"GET"`

###### listTools.path

> `readonly` **path**: `"/v1/tools"` = `"/v1/tools"`

###### listTools.response

> `readonly` **response**: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<\{ `destructive`: `ZodOptional`\<`ZodBoolean`>\>; `idempotent`: `ZodOptional`\<`ZodBoolean`>\>; `readOnly`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `name`: `ZodString`; `namespace`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `readWrite`: `ZodEnum`\<\[`"read"`, `"write"`\]\>; `requiredCapability`: `ZodObject`\<\{ `action`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<...\>; `path`: `ZodArray`\<..., ...\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}, \{ `namespace`: `string`; `owner?`: ... \| ... \| ... \| ... \| ...; `path`: ...[]; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: ...; `userId`: ...; \} \| \{ `agentId`: ...; `kind`: ...; \} \| \{ `conversationId`: ...; `kind`: ...; \} \| \{ `kind`: ...; `serviceId`: ...; \}; `path`: `string`[]; \}; \}\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, `"many"`>\>

##### reach

> `readonly` **reach**: `object`

###### reach.method

> `readonly` **method**: `"GET"` = `"GET"`

###### reach.path

> `readonly` **path**: `"/v1/reach"` = `"/v1/reach"`

###### reach.response

> `readonly` **response**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<\{ `reach`: `ZodArray`\<`ZodObject`\<\{ `actions`: `ZodArray`\<`ZodString`, `"many"`>\>; `namespace`: `ZodString`; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; `scope`: `ZodEnum`\<\[..., ...\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}, \{ `actions`: `string`[]; `namespace`: `string`; `path`: `string`[]; `scope`: `"exact"` \| `"descendants"`; \}\>, `"many"`>\>; `status`: `ZodLiteral`\<`"computed"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `reach`: `object`[]; `status`: `"computed"`; \}, \{ `reach`: `object`[]; `status`: `"computed"`; \}\>, `ZodObject`\<\{ `reasonCode`: `ZodEnum`\<\[`"authority_unavailable"`, `"usage_store_unavailable"`\]\>; `status`: `ZodLiteral`\<`"unavailable"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `reasonCode`: `"authority_unavailable"` \| `"usage_store_unavailable"`; `status`: `"unavailable"`; \}, \{ `reasonCode`: `"authority_unavailable"` \| `"usage_store_unavailable"`; `status`: `"unavailable"`; \}\>\]\> = `ReachResultSchema`

##### sendMessage

> `readonly` **sendMessage**: `object`

###### sendMessage.method

> `readonly` **method**: `"POST"` = `"POST"`

###### sendMessage.path

> `readonly` **path**: `"/v1/messages"` = `"/v1/messages"`

###### sendMessage.request

> `readonly` **request**: `ZodObject`\<\{ `createdAt`: `ZodString`; `id`: `ZodString`; `payload`: `ZodType`\<[`JsonValue`](#jsonvalue), `ZodTypeDef`, [`JsonValue`](#jsonvalue)>\>; `provenance`: `ZodOptional`\<`ZodObject`\<\{ `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `parentIds`: `ZodArray`\<`ZodString`, `"many"`>\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}, \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}\>\>; `purpose`: `ZodString`; `receiver`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `replyTo`: `ZodOptional`\<`ZodString`>\>; `sender`: `ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<\{ `kind`: `ZodLiteral`\<`"human"`>\>; `userId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"human"`; `userId`: `string`; \}, \{ `kind`: `"human"`; `userId`: `string`; \}\>, `ZodObject`\<\{ `agentId`: `ZodString`; `kind`: `ZodLiteral`\<`"agent"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `agentId`: `string`; `kind`: `"agent"`; \}, \{ `agentId`: `string`; `kind`: `"agent"`; \}\>, `ZodObject`\<\{ `conversationId`: `ZodString`; `kind`: `ZodLiteral`\<`"group"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `conversationId`: `string`; `kind`: `"group"`; \}, \{ `conversationId`: `string`; `kind`: `"group"`; \}\>, `ZodObject`\<\{ `kind`: `ZodLiteral`\<`"service"`>\>; `serviceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `kind`: `"service"`; `serviceId`: `string`; \}, \{ `kind`: `"service"`; `serviceId`: `string`; \}\>\]\>; `traceId`: `ZodString`; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}, \{ `createdAt`: `string`; `id`: `string`; `payload`: [`JsonValue`](#jsonvalue); `provenance?`: \{ `metadata?`: [`JsonObject`](#jsonobject); `parentIds`: `string`[]; `source`: `string`; \}; `purpose`: `string`; `receiver`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `replyTo?`: `string`; `sender`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `traceId`: `string`; `version`: `"1"`; \}\> = `MessageEnvelopeSchema`

###### sendMessage.response

> `readonly` **response**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"accepted"`; `timestamp`: `string`; \}, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"accepted"`; `timestamp`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"delivered"`; `timestamp`: `string`; \}, \{ `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"delivered"`; `timestamp`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `timestamp`: `string`; \}, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `timestamp`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `timestamp`: `string`; \}, \{ `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `messageId`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `timestamp`: `string`; \}\>\]\> = `MessageDeliveryResultSchema`

##### updateToolNamespaces

> `readonly` **updateToolNamespaces**: `object`

###### updateToolNamespaces.method

> `readonly` **method**: `"PUT"` = `"PUT"`

###### updateToolNamespaces.path

> `readonly` **path**: `"/v1/tools/namespaces"` = `"/v1/tools/namespaces"`

###### updateToolNamespaces.request

> `readonly` **request**: `ZodEffects`\<`ZodObject`\<\{ `disable`: `ZodOptional`\<`ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>\>; `enable`: `ZodOptional`\<`ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}\>, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}\> = `ToolNamespaceUpdateSchema`

###### updateToolNamespaces.response

> `readonly` **response**: `ZodEffects`\<`ZodObject`\<\{ `namespaces`: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `enabled`: `ZodBoolean`; `namespace`: `ZodString`; `sources`: `ZodArray`\<`ZodString`, `"many"`>\>; `toolCount`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, `"many"`>\>; `summary`: `ZodObject`\<\{ `disabled`: `ZodNumber`; `enabled`: `ZodNumber`; `total`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}, \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}\>, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}\> = `ToolNamespaceCatalogSchema`

---

### SHAREDOS\_VERSION

> `const` **SHAREDOS\_VERSION**: `"1.0.0-preview"` = `"1.0.0-preview"`

Defined in: [common.ts:25](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L25)

The SharedOS build, as every manifest, MCP server and conformance record
names it.

The packages share one version and are published together, so there is one
constant. The release gate holds it equal to the synchronized package
version, because a record that names the wrong build is evidence attributed
to code that never ran.

---

### SharedOSApiErrorResponseSchema

> `const` **SharedOSApiErrorResponseSchema**: `ZodObject`\<\{ `error`: `ZodObject`\<\{ `code`: `ZodString`; `message`: `ZodString`; `requestId`: `ZodOptional`\<`ZodString`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `code`: `string`; `message`: `string`; `requestId?`: `string`; \}, \{ `code`: `string`; `message`: `string`; `requestId?`: `string`; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `error`: \{ `code`: `string`; `message`: `string`; `requestId?`: `string`; \}; \}, \{ `error`: \{ `code`: `string`; `message`: `string`; `requestId?`: `string`; \}; \}\>

Defined in: [http.ts:58](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L58)

---

### SharedOSHealthSchema

> `const` **SharedOSHealthSchema**: `ZodObject`\<\{ `protocolVersion`: `ZodLiteral`\<`"1"`>\>; `status`: `ZodLiteral`\<`"ok"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `protocolVersion`: `"1"`; `status`: `"ok"`; \}, \{ `protocolVersion`: `"1"`; `status`: `"ok"`; \}\>

Defined in: [http.ts:30](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/http.ts#L30)

---

### SharedOSToolCatalogSchema

> `const` **SharedOSToolCatalogSchema**: `ZodEffects`\<`ZodObject`\<\{ `catalogHash`: `ZodString`; `executionId`: `ZodString`; `tools`: `ZodArray`\<`ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<\{ `destructiveHint`: `ZodOptional`\<`ZodBoolean`>\>; `idempotentHint`: `ZodOptional`\<`ZodBoolean`>\>; `openWorldHint`: `ZodOptional`\<`ZodBoolean`>\>; `readOnlyHint`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}, \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodObject`\<\{ `namespace`: `ZodOptional`\<`ZodString`>\>; `source`: `ZodOptional`\<`ZodString`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace?`: `string`; `source?`: `string`; \}, \{ `namespace?`: `string`; `source?`: `string`; \}\>\>; `name`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: \{ `namespace?`: `string`; `source?`: `string`; \}; `name`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); \}, \{ `annotations?`: \{ `destructiveHint?`: `boolean`; `idempotentHint?`: `boolean`; `openWorldHint?`: `boolean`; `readOnlyHint?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: \{ `namespace?`: `string`; `source?`: `string`; \}; `name`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); \}\>, `"many"`>\>; `version`: `ZodLiteral`\<`"1"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}, \{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>, \{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}, \{ `catalogHash`: `string`; `executionId`: `string`; `tools`: `object`[]; `version`: `"1"`; \}\>

Defined in: [tool.ts:211](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L211)

The effective, permission-filtered catalogue for exactly one turn.

`catalogHash` covers the tools and nothing else, so two harnesses that were
handed the same semantic tool set produce the same hash even though their
`executionId`s, transports, and harness-side aliases differ. That is the whole
point of carrying it: an experiment can then prove the harnesses were compared
on equal terms rather than assuming it.

---

### TimestampSchema

> `const` **TimestampSchema**: `ZodString`

Defined in: [common.ts:32](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/common.ts#L32)

An RFC 3339 timestamp, represented as a string to remain JSON-safe.

---

### ToolAnnotationsSchema

> `const` **ToolAnnotationsSchema**: `ZodObject`\<\{ `destructive`: `ZodOptional`\<`ZodBoolean`>\>; `idempotent`: `ZodOptional`\<`ZodBoolean`>\>; `readOnly`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}\>

Defined in: [tool.ts:100](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L100)

---

### ToolCallSchema

> `const` **ToolCallSchema**: `ZodObject`\<\{ `arguments`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `id`: `ZodString`; `requestedAt`: `ZodString`; `tool`: `ZodString`; `traceId`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `arguments`: [`JsonObject`](#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \}, \{ `arguments`: [`JsonObject`](#jsonobject); `id`: `string`; `requestedAt`: `string`; `tool`: `string`; `traceId`: `string`; \}\>

Defined in: [tool.ts:334](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L334)

---

### ToolDefinitionSchema

> `const` **ToolDefinitionSchema**: `ZodEffects`\<`ZodObject`\<\{ `annotations`: `ZodOptional`\<`ZodObject`\<\{ `destructive`: `ZodOptional`\<`ZodBoolean`>\>; `idempotent`: `ZodOptional`\<`ZodBoolean`>\>; `readOnly`: `ZodOptional`\<`ZodBoolean`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}, \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}\>\>; `description`: `ZodString`; `inputSchema`: `ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>\>; `metadata`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `name`: `ZodString`; `namespace`: `ZodString`; `outputSchema`: `ZodOptional`\<`ZodType`\<[`JsonObject`](#jsonobject), `ZodTypeDef`, [`JsonObject`](#jsonobject)>>\>\>; `readWrite`: `ZodEnum`\<\[`"read"`, `"write"`\]\>; `requiredCapability`: `ZodObject`\<\{ `action`: `ZodString`; `resource`: `ZodObject`\<\{ `namespace`: `ZodString`; `owner`: `ZodOptional`\<`ZodDiscriminatedUnion`\<`"kind"`, \[`ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>, `ZodObject`\<..., ..., ..., ..., ...\>\]\>\>; `path`: `ZodArray`\<`ZodString`, `"many"`>\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}, \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}, \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}\>; `source`: `ZodString`; \}, `"strict"`, `ZodTypeAny`, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}, \{ `annotations?`: \{ `destructive?`: `boolean`; `idempotent?`: `boolean`; `readOnly?`: `boolean`; \}; `description`: `string`; `inputSchema`: [`JsonObject`](#jsonobject); `metadata?`: [`JsonObject`](#jsonobject); `name`: `string`; `namespace`: `string`; `outputSchema?`: [`JsonObject`](#jsonobject); `readWrite`: `"read"` \| `"write"`; `requiredCapability`: \{ `action`: `string`; `resource`: \{ `namespace`: `string`; `owner?`: \{ `kind`: `"human"`; `userId`: `string`; \} \| \{ `agentId`: `string`; `kind`: `"agent"`; \} \| \{ `conversationId`: `string`; `kind`: `"group"`; \} \| \{ `kind`: `"service"`; `serviceId`: `string`; \}; `path`: `string`[]; \}; \}; `source`: `string`; \}\>

Defined in: [tool.ts:111](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L111)

A JSON-Schema-described tool bound to one permission requirement.

---

### ToolNameSchema

> `const` **ToolNameSchema**: `ZodString`

Defined in: [tool.ts:28](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L28)

A canonical SharedOS tool identity.

Deliberately narrower than [IdentifierSchema](#identifierschema). A tool name is not an
opaque host identifier: it is published to external harnesses as the raw MCP
`Tool.name`, so the character set has to be one every harness and transport
carries unchanged. Keeping the two schemas distinct makes the invariant

    ToolDefinition.name = SharedOS canonical tool ID = raw MCP Tool.name

enforceable at registration rather than merely documented.

Names are globally unique across namespaces, so a catalogue that brokers two
providers exposing the same underlying operation still publishes two distinct
names -- `github.search` and `notion.search`, never `search` twice.

A harness is free to rewrite this into an alias of its own
(`mcp__sharedos__files_search`). That alias is presentation, never identity,
and never participates in authorization.

---

### ToolNamespaceCatalogSchema

> `const` **ToolNamespaceCatalogSchema**: `ZodEffects`\<`ZodObject`\<\{ `namespaces`: `ZodArray`\<`ZodEffects`\<`ZodObject`\<\{ `enabled`: `ZodBoolean`; `namespace`: `ZodString`; `sources`: `ZodArray`\<`ZodString`, `"many"`>\>; `toolCount`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, `"many"`>\>; `summary`: `ZodObject`\<\{ `disabled`: `ZodNumber`; `enabled`: `ZodNumber`; `total`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}, \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}\>; \}, `"strict"`, `ZodTypeAny`, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}\>, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}, \{ `namespaces`: `object`[]; `summary`: \{ `disabled`: `number`; `enabled`: `number`; `total`: `number`; \}; \}\>

Defined in: [tool.ts:296](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L296)

---

### ToolNamespaceDescriptorSchema

> `const` **ToolNamespaceDescriptorSchema**: `ZodEffects`\<`ZodObject`\<\{ `enabled`: `ZodBoolean`; `namespace`: `ZodString`; `sources`: `ZodArray`\<`ZodString`, `"many"`>\>; `toolCount`: `ZodNumber`; \}, `"strict"`, `ZodTypeAny`, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}, \{ `enabled`: `boolean`; `namespace`: `string`; `sources`: `string`[]; `toolCount`: `number`; \}\>

Defined in: [tool.ts:277](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L277)

---

### ToolNamespaceSchema

> `const` **ToolNamespaceSchema**: `ZodString` = `IdentifierSchema`

Defined in: [tool.ts:38](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L38)

A logical group of tools that a trusted host may enable for one access context.

---

### ToolNamespaceUpdateSchema

> `const` **ToolNamespaceUpdateSchema**: `ZodEffects`\<`ZodObject`\<\{ `disable`: `ZodOptional`\<`ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>\>; `enable`: `ZodOptional`\<`ZodEffects`\<`ZodArray`\<`ZodString`, `"many"`>\>, `string`[], `string`[]\>\>; \}, `"strict"`, `ZodTypeAny`, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}\>, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}, \{ `disable?`: `string`[]; `enable?`: `string`[]; \}\>

Defined in: [tool.ts:71](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L71)

An idempotent patch to a host-owned tool namespace selection.

The host applies this atomically and returns the authoritative effective
selection after product policy ceilings have been enforced.

---

### ToolPolicySchema

> `const` **ToolPolicySchema**: `ZodEffects`\<`ZodObject`\<\{ `externalDirect`: `ZodArray`\<`ZodString`, `"many"`>\>; `harnessLocal`: `ZodArray`\<`ZodString`, `"many"`>\>; `managedMcp`: `ZodArray`\<`ZodString`, `"many"`>\>; `mode`: `ZodEnum`\<\[`"strict"`, `"hybrid"`\]\>; \}, `"strict"`, `ZodTypeAny`, \{ `externalDirect`: `string`[]; `harnessLocal`: `string`[]; `managedMcp`: `string`[]; `mode`: `"strict"` \| `"hybrid"`; \}, \{ `externalDirect`: `string`[]; `harnessLocal`: `string`[]; `managedMcp`: `string`[]; `mode`: `"strict"` \| `"hybrid"`; \}\>, \{ `externalDirect`: `string`[]; `harnessLocal`: `string`[]; `managedMcp`: `string`[]; `mode`: `"strict"` \| `"hybrid"`; \}, \{ `externalDirect`: `string`[]; `harnessLocal`: `string`[]; `managedMcp`: `string`[]; `mode`: `"strict"` \| `"hybrid"`; \}\>

Defined in: [tool.ts:251](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L251)

The declared tool surface of one experiment or runtime configuration.

`strict` asserts that every effect available to the harness went through
SharedOS. It is checked, not just declared: a strict policy that also lists
`externalDirect` entries is rejected here rather than producing a run whose
headline claim its own manifest contradicts.

`harnessLocal` is still permitted under `strict`, because a harness with no
local tools at all cannot always be produced -- but the entries have to be
named, so a reader can see exactly which effects were outside the kernel.

---

### ToolReadWriteSchema

> `const` **ToolReadWriteSchema**: `ZodEnum`\<\[`"read"`, `"write"`\]\>

Defined in: [tool.ts:49](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L49)

A conservative catalog classification. Capabilities remain the authorization source.

---

### ToolResultSchema

> `const` **ToolResultSchema**: `ZodDiscriminatedUnion`\<`"status"`, \[`ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \}, \{ `callId`: `string`; `completedAt`: `string`; `metadata?`: [`JsonObject`](#jsonobject); `output`: [`JsonValue`](#jsonvalue); `status`: `"succeeded"`; `tool`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `tool`: `string`; \}, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"denied"`; `tool`: `string`; \}\>, `ZodObject`\<`object` & `object`, `"strict"`, `ZodTypeAny`, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `tool`: `string`; \}, \{ `callId`: `string`; `completedAt`: `string`; `error`: \{ `code`: `string`; `details?`: [`JsonObject`](#jsonobject); `message`: `string`; `retryable?`: `boolean`; \}; `metadata?`: [`JsonObject`](#jsonobject); `status`: `"failed"`; `tool`: `string`; \}\>\]\>

Defined in: [tool.ts:353](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L353)

---

### ToolSourceSchema

> `const` **ToolSourceSchema**: `ZodString` = `IdentifierSchema`

Defined in: [tool.ts:45](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/tool.ts#L45)

The host-defined origin of a tool, for example `sharedos`, `native`, `mcp`,
or `composio`. This is catalog metadata, never proof of authority.

## Functions

### isJsonObject()

> **isJsonObject**(`value`): `value is JsonObject`

Defined in: [json.ts:36](https://github.com/systemind-team/SharedOS/blob/main/packages/contracts/src/json.ts#L36)

Whether a value is shaped like a JSON object: a non-null object that is not
an array. It checks the shape of the top level only, which is what a reader
needs before indexing into a value it was handed as `unknown` or as a
`JsonValue`; it does not walk the children, so it is not a substitute for
[JsonObjectSchema](#jsonobjectschema) at a trust boundary.

#### Parameters

| Parameter | Type      |
| --------- | --------- |
| `value`   | `unknown` |

#### Returns

`value is JsonObject`
