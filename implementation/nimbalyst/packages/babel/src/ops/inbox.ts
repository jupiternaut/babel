import { createHash } from "node:crypto";
import { excerptOf } from "./chat-adapter.ts";
import { CHAT_ADAPTER_ID, CHAT_VENDOR, type ChatDraft, type ChatMessage, type ChatProvenance, type TodoInput } from "./types.ts";

export function chatFingerprint(messageId: string): string {
  return createHash("sha256").update(`chat|${CHAT_ADAPTER_ID}|${messageId}`).digest("hex").slice(0, 24);
}

export function buildChatDraft(message: ChatMessage): ChatDraft {
  const provenance: ChatProvenance = {
    sourceKind: "chat",
    adapterId: CHAT_ADAPTER_ID,
    vendor: CHAT_VENDOR,
    messageId: message.messageId,
    roomId: message.roomId,
    authorId: message.authorId,
    excerpt: excerptOf(message.text),
    sentAt: message.sentAt,
    fingerprint: chatFingerprint(message.messageId),
  };
  return {
    draftId: `draft-chat-${provenance.fingerprint}`,
    kind: "chat.todo",
    todo: chatTodoInput(provenance, message.text),
    provenance,
    confirmed: false,
    rejected: false,
    trackerId: null,
  };
}

export function chatTodoInput(provenance: ChatProvenance, text: string): TodoInput {
  const title = provenance.excerpt || "聊天消息待办";
  return {
    title: title.startsWith("待办：") ? title : `待办：${title}`,
    primaryType: "task",
    id: `trk-chat-${provenance.fingerprint}`,
    description: [
      text.trim(),
      "",
      "## 出处",
      "",
      `- 来源：chat`,
      `- 适配器：${provenance.adapterId}`,
      `- 厂商：${provenance.vendor}（未选定 Element/Fluxer）`,
      `- 消息：${provenance.messageId}`,
      `- 房间：${provenance.roomId}`,
      `- 作者：${provenance.authorId}`,
      `- 发送时间：${provenance.sentAt}`,
      "",
      "收到聊天消息不会自动保存待办，也不会启动执行。",
    ].join("\n"),
  };
}
