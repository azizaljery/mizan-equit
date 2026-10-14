import type { AuditEvent, AuditSink, JsonValue } from "./contracts";

export class InMemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];

  append(event: AuditEvent): void {
    assertJsonSafe(event);
    this.events.push(event);
  }

  exportJson(): string {
    return JSON.stringify(this.events);
  }
}

export function assertJsonSafe(value: unknown, path = "$" ): asserts value is JsonValue {
  if (value === null) return;

  if (typeof value === "string" || typeof value === "boolean") return;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonSafe(item, `${path}[${index}]`));
    return;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      assertJsonSafe(item, `${path}.${key}`);
    }
    return;
  }

  throw new TypeError(`Unsupported JSON value at ${path}`);
}
