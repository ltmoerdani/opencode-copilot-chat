import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimatePromptTokenCount, estimateTokenCount } from "../tokenEstimate.js";

describe("token estimates", () => {
  it("returns zero for empty content", () => {
    assert.equal(estimateTokenCount(""), 0);
    assert.equal(estimateTokenCount("   \n\t"), 0);
  });

  it("charges base64 image data as a bounded per-image estimate, not as prose (#287)", () => {
    const messages: import("../request/types.js").ApiMessage[] = [
      {
        role: "user",
        content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${"A".repeat(400_000)}` } }],
      },
    ];
    const estimate = estimatePromptTokenCount(messages);
    assert.ok(estimate < 10_000, `image estimate ${String(estimate)} must not scale with base64 length`);
    assert.ok(estimate >= 1024);
  });

  it("includes tool schemas in the prompt estimate", () => {
    const messages: import("../request/types.js").ApiMessage[] = [{ role: "user", content: "inspect the workspace" }];
    const withoutTools = estimatePromptTokenCount(messages);
    const withTools = estimatePromptTokenCount(messages, [
      {
        name: "read_file",
        description: "Read a file from the workspace",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute file path" },
          },
          required: ["path"],
        },
      },
    ]);

    assert.ok(withTools > withoutTools);
  });
});
