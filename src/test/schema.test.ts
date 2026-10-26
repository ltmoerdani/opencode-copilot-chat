import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_TOOL_SCHEMA_DEPTH } from "../config.js";
import { sanitizeToolSchema } from "../request/schema.js";

describe("sanitizeToolSchema", () => {
  it("flattens a plain object schema", () => {
    const result = sanitizeToolSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 1 },
      },
      required: ["name"],
    });

    assert.deepEqual(result, {
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "integer", minimum: 1 },
      },
      required: ["name"],
    });
  });

  it("drops $ref/$defs/$schema and resolves #/ pointers", () => {
    const result = sanitizeToolSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $defs: { coord: { type: "object", properties: { x: { type: "number" } } } },
      type: "object",
      properties: {
        pos: { $ref: "#/$defs/coord" },
        label: { type: "string", description: "a label" },
      },
    });

    assert.deepEqual(result, {
      type: "object",
      properties: {
        pos: { type: "object", properties: { x: { type: "number" } } },
        label: { type: "string", description: "a label" },
      },
    });
  });

  it("does not recurse forever on a cyclic (non-$ref) schema", () => {
    // A property that references the same schema object creates a cycle that
    // used to blow the stack. It must terminate and emit an empty schema for
    // the back-edge.
    const node: Record<string, unknown> = {
      type: "object",
      properties: {},
    };
    node.properties = { self: node };

    const result = sanitizeToolSchema(node) as { properties: Record<string, unknown> };

    assert.deepEqual(result.properties.self, {});
  });

  it("preserves a shared (DAG) sub-schema used by two properties", () => {
    const shared = { type: "string", maxLength: 10 };
    const result = sanitizeToolSchema({
      type: "object",
      properties: { a: shared, b: shared },
    }) as { properties: Record<string, unknown> };

    assert.deepEqual(result.properties.a, { type: "string", maxLength: 10 });
    assert.deepEqual(result.properties.b, { type: "string", maxLength: 10 });
  });

  it("falls back to an empty object schema for non-object input", () => {
    assert.deepEqual(sanitizeToolSchema(undefined), { type: "object", properties: {} });
  });

  it("preserves a top-level enum instead of flattening it away", () => {
    const result = sanitizeToolSchema({ enum: ["fast", "balanced", "thorough"] });
    assert.deepEqual(result, { type: "object", properties: {}, enum: ["fast", "balanced", "thorough"] });
  });

  it("keeps pattern/format/default keywords on properties", () => {
    const result = sanitizeToolSchema({
      type: "object",
      properties: {
        code: { type: "string", pattern: "^[a-z]+$", description: "a code" },
        mode: { type: "string", enum: ["on", "off"], default: "off" },
      },
    }) as { properties: Record<string, unknown> };

    assert.deepEqual(result.properties.code, { type: "string", pattern: "^[a-z]+$", description: "a code" });
    assert.deepEqual(result.properties.mode, { type: "string", enum: ["on", "off"], default: "off" });
  });

  it("caps nested object schemas at MAX_TOOL_SCHEMA_DEPTH", () => {
    const result = sanitizeToolSchema(nestedObjectSchema(25));

    assert.equal(schemaDepth(result), MAX_TOOL_SCHEMA_DEPTH);

    const ceiling = deepestSchemaNode(result);
    assert.equal(ceiling.type, "object");
    assert.equal(ceiling.properties, undefined, "a node on the ceiling must not carry child schemas");
  });

  it("keeps schemas that fit within the depth limit intact", () => {
    const result = sanitizeToolSchema(nestedObjectSchema(MAX_TOOL_SCHEMA_DEPTH - 1));

    assert.equal(schemaDepth(result), MAX_TOOL_SCHEMA_DEPTH);
    assert.equal(deepestSchemaNode(result).type, "string");
  });

  it("counts array items toward the depth limit", () => {
    let nested: Record<string, unknown> = { type: "string" };
    for (let level = 0; level < 25; level++) {
      nested = { type: "array", items: nested };
    }

    const result = sanitizeToolSchema({ type: "object", properties: { nested } });

    assert.equal(schemaDepth(result), MAX_TOOL_SCHEMA_DEPTH);
  });
});

function nestedObjectSchema(levels: number): Record<string, unknown> {
  let schema: Record<string, unknown> = { type: "string" };
  for (let level = 0; level < levels; level++) {
    schema = { type: "object", properties: { child: schema }, required: ["child"] };
  }
  return schema;
}

function deepestSchemaNode(schema: unknown): Record<string, unknown> {
  let node = schema as Record<string, unknown>;
  while (node.properties && typeof node.properties === "object") {
    node = (node.properties as Record<string, unknown>).child as Record<string, unknown>;
  }
  return node;
}

function schemaDepth(value: unknown, depth = 1): number {
  if (!value || typeof value !== "object") {
    return depth;
  }

  const schema = value as Record<string, unknown>;
  let max = depth;
  if (schema.properties && typeof schema.properties === "object") {
    for (const child of Object.values(schema.properties as Record<string, unknown>)) {
      max = Math.max(max, schemaDepth(child, depth + 1));
    }
  }
  if (schema.items && typeof schema.items === "object") {
    max = Math.max(max, schemaDepth(schema.items, depth + 1));
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    max = Math.max(max, schemaDepth(schema.additionalProperties, depth + 1));
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = schema[keyword];
    if (Array.isArray(variants)) {
      for (const variant of variants) {
        max = Math.max(max, schemaDepth(variant, depth + 1));
      }
    }
  }
  return max;
}
