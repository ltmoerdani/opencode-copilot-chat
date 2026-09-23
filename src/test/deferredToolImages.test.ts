import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFERRED_TOOL_IMAGES_NOTE, withDeferredToolImageMessages } from "../request/shared.js";
import type { ApiMessage, OpenAiContentPart } from "../request/types.js";

const imagePart: OpenAiContentPart = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } };

describe("withDeferredToolImageMessages (issue #233)", () => {
  it("returns messages unchanged when nothing is deferred", () => {
    const messages: ApiMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: null, tool_calls: [] },
    ];
    const result = withDeferredToolImageMessages(messages, []);
    assert.deepEqual(result, messages);
    assert.equal(result.length, 2);
  });

  it("appends one user message carrying the deferred tool images", () => {
    const messages: ApiMessage[] = [
      { role: "user", content: "hi" },
      { role: "tool", tool_call_id: "call_1", content: "[Tool returned an image attachment; it is included in the following message.]" },
    ];
    const result = withDeferredToolImageMessages(messages, [imagePart]);
    assert.equal(result.length, 3);
    const deferred = result[2];
    assert.equal(deferred.role, "user");
    assert.ok(Array.isArray(deferred.content));
    const textPart = deferred.content[0] as { type: string; text: string };
    assert.equal(textPart.type, "text");
    assert.equal(textPart.text, DEFERRED_TOOL_IMAGES_NOTE);
    assert.deepEqual(deferred.content[1], imagePart);
  });

  it("does not mutate the input array", () => {
    const messages: ApiMessage[] = [{ role: "tool", tool_call_id: "call_1", content: "text only" }];
    const snapshot = structuredClone(messages);
    withDeferredToolImageMessages(messages, [imagePart]);
    assert.deepEqual(messages, snapshot);
  });
});
