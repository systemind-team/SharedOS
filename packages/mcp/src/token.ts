import type { Address } from "@aicoo/sharedos-contracts";
import { addressPath, canonicalJson } from "@aicoo/sharedos-core";
import { z } from "zod";

/**
 * What a short-lived execution token asserts.
 *
 * It identifies a broker session and nothing more. There are deliberately no
 * grants, no capabilities, and no authority in these claims: a token is a way to
 * find the right turn-scoped bridge, not a bearer of permission. Whoever
 * presents it still gets exactly the catalogue that turn's `AccessContext`
 * resolved, and every call it makes is still authorized from the trusted grant
 * source at the moment of the call.
 *
 * `catalogHash` is bound in so a token cannot be replayed against a session that
 * is serving a different tool set -- the case where a stale sandbox reconnects
 * after the catalogue changed, and would otherwise call tools it was never
 * shown.
 */
export const ExecutionTokenClaimsSchema = z
  .object({
    executionId: z.string().min(1),
    namespaceId: z.string().min(1),
    /**
     * The acting principal as {@link canonicalActor} renders it: `<kind>:<id>`,
     * for example `agent:a-1`. Compared by equality, never parsed back.
     */
    actor: z.string().min(1),
    catalogHash: z.string().regex(/^[0-9a-f]{64}$/u),
    /** RFC 3339. A token with no expiry is not issued. */
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type ExecutionTokenClaims = z.infer<typeof ExecutionTokenClaimsSchema>;

/**
 * The one string form of an address a token carries as its `actor`.
 *
 * `<kind>:<id>`, from the same `[kind, id]` pair `addressPath` derives for a
 * recipient-scoped grant, so the two never spell an address differently. It is
 * a label for equality, not an encoding: nothing parses it back into an
 * `Address`, and a token is matched on the exact string it was minted with.
 */
export function canonicalActor(address: Address): string {
  return addressPath(address).join(":");
}

export type ExecutionTokenRejection =
  "malformed" | "signature_mismatch" | "expired" | "claims_mismatch";

export type ExecutionTokenVerification =
  | { readonly valid: true; readonly claims: ExecutionTokenClaims }
  | { readonly valid: false; readonly reason: ExecutionTokenRejection };

/**
 * Sign one execution token.
 *
 * HMAC-SHA256 over the canonical JSON of the claims, through Web Crypto so this
 * stays host-neutral. The secret is the host's; SharedOS neither generates nor
 * stores it, because a broker that mints its own signing key has no way to be
 * revoked by the host that deployed it.
 */
export async function mintExecutionToken(
  claims: ExecutionTokenClaims,
  secret: string,
): Promise<string> {
  const parsed = ExecutionTokenClaimsSchema.safeParse(claims);
  if (!parsed.success) {
    throw new TypeError("execution token claims do not match the SharedOS contract");
  }
  const payload = base64UrlEncode(new TextEncoder().encode(canonicalJson(parsed.data)));
  const signature = base64UrlEncode(await sign(payload, secret));
  return `${payload}.${signature}`;
}

export interface VerifyExecutionTokenOptions {
  /** The instant to judge expiry against. RFC 3339. */
  readonly now: string;
  /** Claims the session already knows, each of which must match exactly. */
  readonly expect?: Partial<ExecutionTokenClaims>;
}

/**
 * Verify a token, then check it against what the session already knows.
 *
 * Order matters: the signature is checked before the claims are trusted for
 * anything, including for deciding whether they are worth checking. The
 * comparison is constant-time, and a mismatch of any kind is reported as a
 * refusal rather than thrown, so a bad token produces a clean 401 instead of an
 * exception path that a caller might handle differently from a denial.
 */
export async function verifyExecutionToken(
  token: string,
  secret: string,
  options: VerifyExecutionTokenOptions,
): Promise<ExecutionTokenVerification> {
  const [payload, signature, ...rest] = token.split(".");
  if (payload === undefined || signature === undefined || rest.length > 0) {
    return { valid: false, reason: "malformed" };
  }

  const expected = base64UrlEncode(await sign(payload, secret));
  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder().decode(base64UrlDecode(payload)));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  const claims = ExecutionTokenClaimsSchema.safeParse(decoded);
  if (!claims.success) {
    return { valid: false, reason: "malformed" };
  }

  const expiresAt = Date.parse(claims.data.expiresAt);
  const now = Date.parse(options.now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || now >= expiresAt) {
    return { valid: false, reason: "expired" };
  }

  for (const [key, value] of Object.entries(options.expect ?? {})) {
    if (value !== undefined && claims.data[key as keyof ExecutionTokenClaims] !== value) {
      return { valid: false, reason: "claims_mismatch" };
    }
  }

  return { valid: true, claims: claims.data };
}

async function sign(payload: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

/** Comparison whose duration does not depend on where two strings first differ. */
function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}
