export const MAX_CHAT_MESSAGE_LENGTH = 500;

export function parseChatMessagesJson(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function resolveChatMessages({ chatMessage = '', chatMessagesJson = '' } = {}) {
  const fromJson = parseChatMessagesJson(chatMessagesJson);
  const primary = String(chatMessage || '').trim();
  const messages = fromJson.length ? fromJson : (primary ? [primary] : []);
  return messages.filter((line) => line.length <= MAX_CHAT_MESSAGE_LENGTH);
}

export function pickRotatedMessage(messages, sentCount = 0) {
  const list = Array.isArray(messages) && messages.length
    ? messages
    : ['Olá — estou a acompanhar.'];
  const index = Math.abs(Number(sentCount) || 0) % list.length;
  return list[index];
}
