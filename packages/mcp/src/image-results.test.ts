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
  it("bounds image size and rejects malformed base64", () => {
    for (const data of ["!not-base64", "A".repeat(4 * 1024 * 1024 + 4)])
      expect(
        toCallToolResult(result([{ type: "image", mimeType: "image/png", data }])).content,
      ).toHaveLength(1);
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
