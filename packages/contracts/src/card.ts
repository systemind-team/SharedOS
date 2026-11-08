import { z } from "zod";

import { AddressSchema } from "./address.js";
import { ReachListSchema, ResourceReachSchema } from "./capability.js";
import { IdentifierSchema, TimestampSchema } from "./common.js";

/**
 * The named shapes an agent card is served in.
 *
 * A card is a view rather than a record, so these are not filters applied to
 * one object on the way out: each name is a separate resource a reader is
 * authorized for, and each answers a different question.
 *
 * - `reach` — identity together with the resources the subject can be asked
 *   about. This is the card the directory exists for.
 * - `identity` — the subject and nothing else. The narrowing that drops reach
 *   entirely, for a reader allowed to learn that an agent is addressable
 *   without learning what it holds.
 * - `namespaces` — identity together with which namespaces the subject reaches
 *   and how many entries in each, with no paths. A coarser answer than `reach`
 *   and a *distinct* view for the reason ADR 0021 gives: projection is
 *   field-level, so a field that means something different depending on who
 *   reads it is the record shape a view exists to refuse.
 *
 * Every view is bounded the same way. See {@link AgentCardSchema}.
 */
export const AGENT_CARD_VIEWS = ["reach", "identity", "namespaces"] as const;

export const AgentCardViewSchema = z.enum(AGENT_CARD_VIEWS);

export type AgentCardView = z.infer<typeof AgentCardViewSchema>;

/**
 * One namespace the subject reaches, and how much of it, without paths.
 *
 * `entries` counts the reach entries collapsed into this row, not resources: a
 * single `descendants` entry over a whole tree counts once, exactly as it
 * appears in `reach`. Counting resources would require asking a provider what
 * exists, which is the lookup a card must never become.
 */
export const ReachSummarySchema = z
  .object({
    namespace: ResourceReachSchema.shape.namespace,
    actions: ResourceReachSchema.shape.actions,
    entries: z.number().int().positive(),
  })
  .strict();

export type ReachSummary = z.infer<typeof ReachSummarySchema>;

const cardIdentity = {
  subject: AddressSchema,
  /** The world this card describes. A card never describes reach in another. */
  namespaceId: IdentifierSchema,
  /**
   * The instant the reach on this card was in force at.
   *
   * Carried because reach is computed at read time and is true of nothing else:
   * a consumer holding a card past this instant holds a description, not an
   * authorization, and every operation is still decided against the grant set
   * of its own moment.
   */
  readAt: TimestampSchema,
} as const;

/**
 * The kernel's description of one agent: identity, computed reach, and nothing
 * a product would want to put beside them.
 *
 * Reach is derived when the card is read, from the grants in force at that
 * instant, and is never stored. A stored reach would be the one description of
 * authority in SharedOS that nothing invalidates: revocation, purpose
 * withdrawal, expiry and a spent budget all work by not matching at the next
 * decision, and a column is outside all of them.
 *
 * A card is bounded by one authority and one world. It shows what the subject
 * reaches under the authority the *reader* is operating under, inside the
 * reader's namespace — not the subject's whole life. It is therefore a lower
 * bound on truth and never an upper one, which is what makes it safe to serve
 * to a model: it omits authority the reader's authority did not issue, and an
 * over-wide entry permits nothing because every operation is authorized
 * independently.
 *
 * Display names, avatars, handles, skills and protocol bindings are absent on
 * purpose. The test is not whether a field is useful but whether it is
 * authority: reach is what the kernel decides against, and a display name is
 * not. A host composes those around this answer. See ADR 0021.
 */
export const AgentCardSchema = z.discriminatedUnion("view", [
  z
    .object({
      view: z.literal("reach"),
      ...cardIdentity,
      reach: ReachListSchema,
    })
    .strict(),
  z.object({ view: z.literal("identity"), ...cardIdentity }).strict(),
  z
    .object({
      view: z.literal("namespaces"),
      ...cardIdentity,
      namespaces: z.array(ReachSummarySchema),
    })
    .strict(),
]);

export type AgentCard = z.infer<typeof AgentCardSchema>;
