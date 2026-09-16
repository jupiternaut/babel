import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import type { Readable, Writable } from "node:stream";

export type PiRpcCommand =
  | { type: "get_state" | "get_messages" | "abort" }
  | { type: "prompt"; message: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "steer" | "follow_up"; message: string };

export interface PiRpcResponse {
  type: "response";
  id: string;
  command: PiRpcCommand["type"];
  success: true;
  data?: unknown;
}

export class PiRpcError extends Error {
  constructor(readonly code: "TIMEOUT" | "DISCONNECTED" | "PROTOCOL" | "REJECTED", message: string) {
    super(message);
    this.name = "PiRpcError";
  }
}

interface Pending {
  command: PiRpcCommand["type"];
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: PiRpcResponse) => void;
  reject: (error: Error) => void;
}

/** Transport only. Pi owns reasoning/tools; the caller owns process and run lifecycle.
 * A response acknowledges a command, never task completion or confirmed process exit.
 * No implicit retry: a timeout may mean the command was already accepted by Pi.
 */
export class PiRpcClient {
  private readonly pending = new Map<string, Pending>();
  private readonly decoder = new StringDecoder("utf8");
  private buffer = "";
  private failure?: PiRpcError;
  private readonly timeoutMs: number;
  private readonly maxRecordBytes: number;

  constructor(private readonly options: {
    input: Writable;
    output: Readable;
    timeoutMs?: number;
    maxRecordBytes?: number;
    onEvent?: (event: Record<string, unknown>) => void;
    onDisconnect?: (error: PiRpcError) => void;
  }) {
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.maxRecordBytes = options.maxRecordBytes ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0
      || !Number.isSafeInteger(this.maxRecordBytes) || this.maxRecordBytes <= 0) {
      throw new Error("RPC timeout and record limit must be positive integers");
    }
    options.output.on("data", this.onData);
    options.output.on("end", this.onEnd);
    options.output.on("close", this.onEnd);
    options.output.on("error", this.onError);
    options.input.on("error", this.onError);
  }

  request(command: PiRpcCommand): Promise<PiRpcResponse> {
    if (this.failure) return Promise.reject(this.failure);
    const id = randomUUID();
    const line = JSON.stringify({ ...command, id }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new PiRpcError("TIMEOUT", `Pi ${command.type} response timed out; command was not retried`));
      }, this.timeoutMs);
      this.pending.set(id, { command: command.type, timer, resolve, reject });
      try {
        // Handle write failure through the stream's error event. Its callback runs
        // before that event; disconnecting there would remove the listener too early.
        this.options.input.write(line);
      } catch (error) {
        this.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  disconnect(error = new PiRpcError("DISCONNECTED", "Pi RPC disconnected; execution state is unknown")): void {
    if (this.failure) return;
    this.failure = error;
    this.options.output.off("data", this.onData);
    this.options.output.off("end", this.onEnd);
    this.options.output.off("close", this.onEnd);
    this.options.output.off("error", this.onError);
    this.options.input.off("error", this.onError);
    this.buffer = "";
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.options.onDisconnect?.(error);
  }

  private readonly onEnd = (): void => {
    this.buffer += this.decoder.end();
    this.disconnect(this.buffer.length
      ? new PiRpcError("PROTOCOL", "Pi stdout ended with an incomplete JSONL record")
      : undefined);
  };

  private readonly onError = (error: Error): void => {
    this.disconnect(new PiRpcError("DISCONNECTED", error.message));
  };

  private readonly onData = (chunk: Buffer | string): void => {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    // LF is the only delimiter. Unicode U+2028/U+2029 are valid JSON string content.
    let newline: number;
    while (!this.failure && (newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (Buffer.byteLength(line, "utf8") > this.maxRecordBytes) {
        this.disconnect(new PiRpcError("PROTOCOL", "Pi RPC record exceeds the size limit"));
        return;
      }
      if (line.trim()) this.receive(line);
    }
    if (Buffer.byteLength(this.buffer, "utf8") > this.maxRecordBytes) {
      this.disconnect(new PiRpcError("PROTOCOL", "Pi RPC record exceeds the size limit"));
    }
  };

  private receive(line: string): void {
    let value: unknown;
    try { value = JSON.parse(line); } catch {
      this.disconnect(new PiRpcError("PROTOCOL", "Pi stdout contained invalid JSON"));
      return;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !("type" in value) || typeof value.type !== "string") {
      this.disconnect(new PiRpcError("PROTOCOL", "Pi stdout contained an invalid event"));
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type !== "response") {
      this.options.onEvent?.(record);
      return;
    }
    if (typeof record.id !== "string" || typeof record.command !== "string"
      || typeof record.success !== "boolean" || (!record.success && typeof record.error !== "string")) {
      this.disconnect(new PiRpcError("PROTOCOL", "Pi returned an invalid command response"));
      return;
    }
    const pending = this.pending.get(record.id);
    if (!pending) return; // Late/duplicate replies must not become progress events.
    if (record.command !== pending.command) {
      this.disconnect(new PiRpcError("PROTOCOL", "Pi response command does not match its request"));
      return;
    }
    this.pending.delete(record.id);
    clearTimeout(pending.timer);
    if (record.success) pending.resolve(record as unknown as PiRpcResponse);
    else pending.reject(new PiRpcError("REJECTED", record.error as string));
  }
}
