export function camel<T>(row: Record<string, unknown>): T {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) =>
      letter.toUpperCase(),
    );
    output[camelKey] = normalizeValue(camelKey, value);
  }
  return output as T;
}

export function camelRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => camel<T>(row));
}

function normalizeValue(key: string, value: unknown) {
  if (value === null || value === undefined) return value;
  if (
    [
      "isHost",
      "ready",
      "connected",
      "alive",
      "locked",
      "survived",
    ].includes(key)
  ) {
    return Boolean(value);
  }
  if (["antiCheatFlags", "payload"].includes(key) && typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return key === "antiCheatFlags" ? [] : {};
    }
  }
  return value;
}
