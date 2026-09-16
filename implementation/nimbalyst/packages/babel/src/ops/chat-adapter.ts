import { CHAT_ADAPTER_ID, CHAT_VENDOR, type ChatMessage } from "./types.ts";

/**
 * Neutral chat source contract.
 * Element / Fluxer are not selected and must not be deployed from this module.
 */
export interface ChatMessageSource {
  readonly adapterId: typeof CHAT_ADAPTER_ID;
  readonly vendor: typeof CHAT_VENDOR;
  listMessages(roomId?: string): ChatMessage[];
}

export class SyntheticChatSource implements ChatMessageSource {
  readonly adapterId = CHAT_ADAPTER_ID;
  readonly vendor = CHAT_VENDOR;
  private readonly messages: ChatMessage[];

  constructor(messages: ChatMessage[] = []) {
    this.messages = messages.map((row) => ({ ...row }));
  }

  seed(message: ChatMessage): void {
    this.messages.push({ ...message });
  }

  listMessages(roomId?: string): ChatMessage[] {
    return this.messages
      .filter((row) => !roomId || row.roomId === roomId)
      .map((row) => ({ ...row }));
  }
}

export function excerptOf(text: string, max = 80): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}
