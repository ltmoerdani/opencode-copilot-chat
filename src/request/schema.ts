/**
 * Shared JSON-schema sanitization for tool definitions.
 *
 * Tools contributed by VS Code may carry `$ref`/`$defs`/`$id`/`$schema` keys
 * and recursive references that some upstream OpenCode endpoints reject. This
 * flattens a tool schema into a minimal, safe `{ type, properties, required }`
 * shape shared by the OpenAI, Anthropic and Google request builders.
 *
 * CONTRACT: pure functions only — no `vscode` import, no side effects.
 */
import { MAX_TOOL_SCHEMA_DEPTH } from "../config";
import { isRecord } from "../utils";

/**
 * Keywords copied verbatim into the sanitized schema. They carry no nested
 * subschemas, so they remain valid at the depth ceiling.
 */
const LEAF_SCHEMA_KEYWORDS = new Set([
  "type",
  "description",
  "enum",
  "const",
  "pattern",
  "format",
  "default",
  "required",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

export function sanitizeToolSchema(schema: unknown): object {
  const root = isRecord(schema) ? schema : { type: "object", properties: {} };
  const sanitized = sanitizeJsonSchemaNode(root, root, new Set(), new WeakSet(), 1);
  if (!isRecord(sanitized)) {
    return { type: "object", properties: {} };
  }

  return {
    type: "object",
    properties: isRecord(sanitized.properties) ? sanitized.properties : {},
    ...(Array.isArray(sanitized.required) ? { required: sanitized.required } : {}),
    // A top-level enum (e.g. a tool input that is a fixed set of values) was
    // previously flattened away — keep it so the provider still validates it.
    ...(Array.isArray(sanitized.enum) ? { enum: sanitized.enum } : {}),
  };
}

function sanitizeJsonSchemaNode(
  value: unknown,
  root: Record<string, unknown>,
  seenRefs: Set<string>,
  visiting: WeakSet<object>,
  depth: number,
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonSchemaNode(item, root, seenRefs, visiting, depth));
  }

  if (!isRecord(value)) {
    return value;
  }

  // Cycle guard: a self/recursive (non-$ref) schema reference would recurse
  // forever and crash the extension host with a stack overflow. Break the
  // cycle by returning an empty schema for the back-edge. Mark-on-entry /
  // unmark-on-exit keeps shared (DAG) sub-schemas intact while still catching
  // true cycles.
  if (visiting.has(value)) {
    return {};
  }
  visiting.add(value);
  try {
    const ref = typeof value.$ref === "string" ? value.$ref : undefined;
    if (ref?.startsWith("#/") && !seenRefs.has(ref)) {
      const target = resolveJsonPointer(root, ref);
      if (target !== undefined) {
        const nextSeenRefs = new Set(seenRefs);
        nextSeenRefs.add(ref);
        const siblings = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "$ref"));
        const resolved = sanitizeJsonSchemaNode(target, root, nextSeenRefs, visiting, depth);
        return isRecord(resolved)
          ? sanitizeJsonSchemaNode({ ...resolved, ...siblings }, root, nextSeenRefs, visiting, depth)
          : sanitizeJsonSchemaNode(siblings, root, nextSeenRefs, visiting, depth);
      }
    }

    // The gateway rejects the whole request when any nested subschema sits
    // deeper than MAX_TOOL_SCHEMA_DEPTH (HTTP 400: "JSON schema exceeds the
    // maximum nesting depth of 10 levels", observed on the Responses API with
    // Muse Spark and deeply nested MCP tools). Emit a childless node at the
    // ceiling — returning `{}` for the children alone would not help because
    // the empty child still counts as a level.
    if (depth >= MAX_TOOL_SCHEMA_DEPTH) {
      return shallowJsonSchema(value);
    }

    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (key === "$schema" || key === "$id" || key === "$ref" || key === "$defs" || key === "definitions") {
        continue;
      }

      if (key === "properties" && isRecord(child)) {
        result.properties = Object.fromEntries(
          Object.entries(child).map(([propertyName, propertySchema]) => [
            propertyName,
            sanitizeJsonSchemaNode(propertySchema, root, seenRefs, visiting, depth + 1),
          ]),
        );
        continue;
      }

      if (key === "items" || key === "additionalProperties") {
        result[key] = sanitizeJsonSchemaNode(child, root, seenRefs, visiting, depth + 1);
        continue;
      }

      if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(child)) {
        result[key] = child.map((item) => sanitizeJsonSchemaNode(item, root, seenRefs, visiting, depth + 1));
        continue;
      }

      if (LEAF_SCHEMA_KEYWORDS.has(key)) {
        result[key] = child;
      }
    }

    return result;
  } finally {
    visiting.delete(value);
  }
}

/**
 * Copy only the leaf keywords of a schema. Used at the depth ceiling so the
 * node keeps `type`/`description`/`enum` hints without carrying any child
 * schema, which would cross the gateway limit.
 */
function shallowJsonSchema(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (LEAF_SCHEMA_KEYWORDS.has(key)) {
      result[key] = child;
    }
  }
  return result;
}

function resolveJsonPointer(root: Record<string, unknown>, pointer: string): unknown {
  return pointer
    .slice(2)
    .split("/")
    .reduce<unknown>((current, segment) => {
      if (!isRecord(current)) {
        return undefined;
      }
      return current[segment.replace(/~1/g, "/").replace(/~0/g, "~")];
    }, root);
}
