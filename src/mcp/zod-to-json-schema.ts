import { z, ZodTypeAny } from "zod";

interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: unknown[];
  const?: unknown;
  format?: string;
  description?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  anyOf?: JsonSchema[];
}

export function zodToJsonSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema);
}

function defOf<T = Record<string, unknown>>(schema: ZodTypeAny): T {
  return schema._def as unknown as T;
}

function convert(schema: ZodTypeAny): JsonSchema {
  const typeName = (defOf<{ typeName: string }>(schema)).typeName;
  switch (typeName) {
    case "ZodObject": {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(shape)) {
        const childSchema = child as ZodTypeAny;
        properties[key] = convert(childSchema);
        if (!isOptional(childSchema)) required.push(key);
      }
      const result: JsonSchema = {
        type: "object",
        properties,
        additionalProperties: false,
      };
      if (required.length) result.required = required;
      return result;
    }
    case "ZodString": {
      const s: JsonSchema = { type: "string" };
      const d = defOf<{ checks?: Array<{ kind: string; value?: number }> }>(schema);
      for (const c of d.checks ?? []) {
        if (c.kind === "uuid") s.format = "uuid";
        if (c.kind === "min" && typeof c.value === "number") s.minLength = c.value;
      }
      return s;
    }
    case "ZodNumber": {
      const s: JsonSchema = { type: "number" };
      const d = defOf<{ checks?: Array<{ kind: string; value?: number }> }>(schema);
      for (const c of d.checks ?? []) {
        if (c.kind === "int") s.type = "integer";
        if (c.kind === "min" && typeof c.value === "number") s.minimum = c.value;
        if (c.kind === "max" && typeof c.value === "number") s.maximum = c.value;
      }
      return s;
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodLiteral":
      return { const: defOf<{ value: unknown }>(schema).value };
    case "ZodEnum":
      return { type: "string", enum: defOf<{ values: string[] }>(schema).values };
    case "ZodNativeEnum":
      return { enum: Object.values(defOf<{ values: Record<string, unknown> }>(schema).values) };
    case "ZodArray":
      return {
        type: "array",
        items: convert(defOf<{ type: ZodTypeAny }>(schema).type),
      };
    case "ZodOptional":
      return convert(defOf<{ innerType: ZodTypeAny }>(schema).innerType);
    case "ZodNullable": {
      const inner = convert(defOf<{ innerType: ZodTypeAny }>(schema).innerType);
      return { anyOf: [inner, { type: "null" } as JsonSchema] };
    }
    case "ZodDefault": {
      const inner = convert(defOf<{ innerType: ZodTypeAny }>(schema).innerType);
      const defVal = defOf<{ defaultValue: () => unknown }>(schema).defaultValue();
      return { ...inner, default: defVal };
    }
    case "ZodUnion": {
      const opts = defOf<{ options: ZodTypeAny[] }>(schema).options;
      return { anyOf: opts.map(convert) };
    }
    case "ZodEffects":
      return convert(defOf<{ schema: ZodTypeAny }>(schema).schema);
    case "ZodAny":
    case "ZodUnknown":
      return {};
    default:
      return {};
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const t = defOf<{ typeName: string }>(schema).typeName;
  return t === "ZodOptional" || t === "ZodDefault";
}
