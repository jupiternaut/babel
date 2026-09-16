import type {
  ConsoleCommand,
  ConsoleQuery,
} from "../../../../../babel/src/system/types";

export async function consoleRequest<T>(
  kind: "query" | "command",
  payload: ConsoleQuery | ConsoleCommand,
  signal?: AbortSignal
): Promise<T> {
  const id = crypto.randomUUID();
  const cancel = () => {
    void window.electronAPI.invoke("system-console:cancel", id).catch(() => {});
  };
  if (signal?.aborted)
    throw new DOMException("Request cancelled", "AbortError");
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const reply = await window.electronAPI.invoke(
      `system-console:${kind}`,
      id,
      payload
    );
    if (signal?.aborted)
      throw new DOMException("Request cancelled", "AbortError");
    if (!reply.ok)
      throw new Error(`${reply.error.code}: ${reply.error.message}`);
    return reply.result as T;
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
}

export async function connectConsole(): Promise<void> {
  const reply = await window.electronAPI.invoke("system-console:connect");
  if (!reply.ok) throw new Error(`${reply.error.code}: ${reply.error.message}`);
}
