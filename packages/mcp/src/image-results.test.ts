import { describe, expect, it } from "vitest";
import { toCallToolResult } from "./server.js";
import type { ToolResult } from "@aicoo/sharedos-contracts";

const result = (content: unknown): ToolResult => ({
  callId: "call",
  tool: "screen",
  completedAt: "2026-10-31T00:00:00Z",
  status: "succeeded",
  output: { epoch: 3 },
  metadata: { "sharedos/content": content } as ToolResult["metadata"],
});
describe("image presentation through the authorized MCP result", () => {
  it("preserves structured output and exposes an image to the harness", () => {
    const image = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
    expect(toCallToolResult(result([image])).content).toEqual([
      { type: "text", text: '{"epoch":3}' },
      image,
    ]);
  });
  it("does not fetch URLs or pass unsupported metadata content", () => {
    expect(
      toCallToolResult(
        result([
          { type: "resource_link", uri: "https://example.com" },
          { type: "image", mimeType: "text/html", data: "aGVsbG8=" },
        ]),
      ).content,
    ).toHaveLength(1);
  });
  it("rejects malformed base64", () => {
    expect(
      toCallToolResult(result([{ type: "image", mimeType: "image/png", data: "!not-base64" }]))
        .content,
    ).toHaveLength(1);
  });
  it("passes images on at any count or size", () => {
    const large = { type: "image", mimeType: "image/png", data: "A".repeat(4 * 1024 * 1024 + 4) };
    const small = { type: "image", mimeType: "image/png", data: "aGVsbG8=" };
    expect(toCallToolResult(result([large])).content).toHaveLength(2);
    expect(toCallToolResult(result(Array.from({ length: 5 }, () => small))).content).toHaveLength(
      6,
    );
  });
  it("never exposes presentation hints from denied results", () => {
    const denied = {
      ...result([{ type: "image", mimeType: "image/png", data: "aGVsbG8=" }]),
      status: "denied",
      error: { code: "denied", message: "No grant" },
    } as ToolResult;
    expect(toCallToolResult(denied).content).toHaveLength(1);
    expect(toCallToolResult(denied).isError).toBe(true);
  });
});
