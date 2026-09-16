export type NodeErrorName =
  | "PERMISSION"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "REVISION"
  | "DISCONNECTED"
  | "UNAVAILABLE"
  | "VALIDATION";

export function nodeError(name: NodeErrorName, message: string, extras?: Record<string, unknown>): Error {
  const error = new Error(message) as Error & { extras?: Record<string, unknown> };
  error.name = name;
  if (extras) error.extras = extras;
  return error;
}
