import { createHash, randomUUID } from "node:crypto";

export function uid(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function nextOrderKey(existing: string[]): string {
  const nums = existing.map((k) => Number(k.split(":")[1] ?? k) || 0);
  const max = nums.length ? Math.max(...nums) : 0;
  return `o:${String(max + 10).padStart(6, "0")}`;
}
