type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tryParseJsonObject(text: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isVegaLiteSpec(spec: unknown): boolean {
  if (!isRecord(spec)) {
    return false;
  }

  const schema = spec["$schema"];
  if (typeof schema === "string" && schema.includes("vega-lite")) {
    return true;
  }

  return "mark" in spec && "encoding" in spec;
}

export function isUtkSpec(spec: unknown): boolean {
  if (!isRecord(spec)) {
    return false;
  }

  const hasGrid = isRecord(spec.grid);
  const hasComponents = Array.isArray(spec.components);
  const hasKnots = Array.isArray(spec.knots);
  const hasMapStyle = Array.isArray(spec.map_style);

  return hasGrid && hasComponents && hasKnots && hasMapStyle;
}
