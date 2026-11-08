import { JsonObjectSchema, type JsonObject, type ToolDefinition } from "@aicoo/sharedos-contracts";
import type { ToolHandler } from "@aicoo/sharedos-core";

export const ESCALATION_TOOL_NAMESPACE = "sharedos";
export const ESCALATION_TOOL_NAME = "sharedos.escalate";
/** The resource an escalation grant is written over. */
export const ESCALATION_RESOURCE_PATH: readonly string[] = Object.freeze(["escalation"]);
export const ESCALATION_ACTION = "request";
/**
 * The key a delegate states the ask under, through `RuntimeHost.annotate`.
 *
 * Every path that honours the affordance ends the turn without forwarding the
 * call -- a driver in the standard loop returns an `escalate` decision, the MCP
 * latch settles the harness's outcome -- so a working ask leaves no operation
 * in the record. Neither would an ask the envelope then failed to honour, and
 * the two would be indistinguishable from a delegate that never asked: a
 * conformance row graded on the ending could not tell "SharedOS was never
 * asked" from "SharedOS was asked and did the wrong thing". So the ask is
 * stated the moment it is recognised, before anything acts on it, and the
 * envelope writes it on the turn's result whatever the turn then does.
 *
 * It is the delegate's own claim, which is the safe direction of trust. A
 * reader can only grade a turn *harder* on it -- an ask stated and not
 * honoured is a failure -- and never credit one, because a pass still needs
 * the turn to have ended `escalated`. Distinct from the `escalation.requested`
 * audit event, which the kernel writes when the envelope records an escalation
 * it honoured.
 */
export const ESCALATION_ASKED_ANNOTATION = "escalationAsked";

/** The ask, in the one shape every delegate states it. */
export function escalationAskedAnnotation(reason: string): JsonObject {
  return { tool: ESCALATION_TOOL_NAME, reason };
}

/**
 * The affordance a driver offers so escalation can be chosen rather than inferred.
 *
 * A turn that ends by asking a human to decide is a claim about SharedOS -- the
 * request is recorded, audited, and grants nothing while it is pending -- and
 * until now no driver inside the standard loop could make it. Adding the
 * decision variant alone would not have been enough: the model still needs a way
 * to *say* it, and reading intent out of prose ("I should ask a human") would
 * make the row measure a phrase rather than a choice.
 *
 * So it is published as a tool. It is permission-filtered like every other tool,
 * which is the point -- escalation is an affordance a host grants, and an agent
 * with no grant over it does not see it in the catalogue at all.
 *
 * It is nonetheless never invoked. A driver whose turn was offered the tool
 * recognises the name and returns an escalate decision instead of a tool call,
 * so nothing reaches the kernel; see {@link escalationRequest}. The kernel-side
 * handler a host registers exists to put the tool in the catalogue and to fail
 * loudly if some driver forwards it anyway, because a call that quietly
 * succeeded would record an escalation the envelope never terminated on.
 *
 * The filtering is what gates the affordance, and a driver has to honour it
 * itself: ending a turn on the name skips the envelope, and with it the
 * envelope's check that the tool was published to this agent. So every driver
 * that recognises the name reads its turn's catalogue first, and a name the
 * catalogue does not hold is passed through to be refused `tool_unavailable`
 * like any other unpublished tool.
 */
export const ESCALATION_TOOL_DEFINITION: ToolDefinition = Object.freeze({
  name: ESCALATION_TOOL_NAME,
  description:
    "End this turn by asking a human to decide. Use it when the task needs authority you do not hold. " +
    "The turn stops, the request is recorded for a reviewer, and nothing is granted in the meantime.",
  namespace: ESCALATION_TOOL_NAMESPACE,
  source: "sharedos",
  readWrite: "read",
  inputSchema: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        minLength: 1,
        description: "What needs deciding, and why this turn cannot decide it.",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
  requiredCapability: {
    resource: { namespace: ESCALATION_TOOL_NAMESPACE, path: [...ESCALATION_RESOURCE_PATH] },
    action: ESCALATION_ACTION,
  },
  annotations: { readOnly: true },
});

/**
 * The handler a host registers so the affordance is catalogued.
 *
 * It exists to put {@link ESCALATION_TOOL_DEFINITION} in the permission-filtered
 * catalogue, where an agent sees it only when its context enables the
 * `sharedos` tool namespace and it holds a grant over `sharedos` /
 * `["escalation"]` / `request`. It is never meant to run: a driver whose turn's
 * catalogue offers it recognises the name (see {@link escalationRequest}) and
 * ends the turn `escalated` instead of forwarding a call. If a driver forwards it anyway, the handler
 * fails with `escalation_not_terminated` rather than succeeding, because a call
 * that quietly succeeded would leave a record of an escalation tool that ran
 * and a turn that completed normally -- the confusion the affordance exists to
 * remove.
 *
 * Arguments pass through unparsed on purpose. A malformed forwarded call is
 * still a forwarded call, and reporting it as `invalid_tool_arguments` would
 * record the wrong defect.
 */
export function createEscalationTool(): ToolHandler {
  return {
    definition: ESCALATION_TOOL_DEFINITION,
    parseArguments: (arguments_) => arguments_,
    invoke: (context, call) =>
      Promise.resolve({
        callId: call.id,
        tool: call.tool,
        status: "failed",
        error: {
          code: "escalation_not_terminated",
          message:
            "The escalation affordance ends a turn and is never executed; this driver forwarded it as a tool call.",
        },
        completedAt: context.now,
      }),
  };
}

/**
 * Read an escalation out of a call a driver is about to make, if that is what it is.
 *
 * Returns the reason when the call names the affordance and carries a usable
 * one, and `undefined` for anything else -- which a driver passes on unchanged,
 * so a tool that merely resembles this one is still re-authorized by the kernel
 * like any other.
 *
 * This recognises the name and nothing else. Whether the turn was offered the
 * tool is the caller's check to make, from its own `RuntimeTurnRequest.tools`,
 * before asking; a caller that honours the name unconditionally has given
 * every agent the affordance regardless of grant.
 *
 * A call that names the affordance with unreadable arguments still escalates,
 * under a reason saying so. The alternative is to forward it to a kernel that
 * will refuse it, which turns "the driver asked for a human" into "the agent
 * made a malformed call" -- the wrong record of what happened.
 *
 * The reason is the occupant's own words and is kept whole, at any length.
 */
export function escalationRequest(tool: string, arguments_: unknown): string | undefined {
  if (tool !== ESCALATION_TOOL_NAME) {
    return undefined;
  }
  const object = JsonObjectSchema.safeParse(arguments_);
  const reason = object.success ? escalationReason(object.data["reason"]) : undefined;
  return reason ?? "the turn asked for a human decision without saying what needs deciding";
}

/** The arguments an escalation is requested with, for a driver writing the call. */
export function escalationArguments(reason: string): JsonObject {
  return { reason };
}

/**
 * A reason string as `RuntimeTurnOutcome` accepts one: text that is not empty
 * once trimmed, at any length.
 *
 * Checked here rather than with a schema because this package carries no
 * validator of its own; the rule is the contract's, restated, so a decision
 * that parses here still parses as an outcome.
 */
export function escalationReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Whether a turn's catalogue offers the affordance.
 *
 * The gate on honouring the name (ADR 0017, "The catalogue gates the name"):
 * a driver reads it from the same `tools` it offered the seat's occupant, and
 * the executor from the catalogue the turn was actually served.
 */
export function escalationOffered(tools: ReadonlyArray<{ readonly name: string }>): boolean {
  return tools.some((tool) => tool.name === ESCALATION_TOOL_NAME);
}
