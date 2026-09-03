/** Official Meet in-call / chat UI. Keywords cover EN, PT-BR, and ES. */

export const NAME_INPUT_SELECTORS = [
  'input[aria-label*="Your name" i]',
  'input[aria-label*="your name" i]',
  'input[placeholder*="Your name" i]',
  'input[placeholder*="name" i]',
  'input[aria-label*="Seu nome" i]',
  'input[aria-label*="Tu nombre" i]',
  'input[type="text"]',
];

export const JOIN_NOW_KEYWORDS = [
  'join now',
  'entrar agora',
  'entrar na reunião',
  'entrar na chamada',
  'unirse ahora',
  'unirse a la llamada',
];

/** Standalone "Entrar" / "Unirse" — never bare "join" (that matches "Ask to join"). */
export const JOIN_NOW_WEAK_KEYWORDS = [
  'entrar',
  'unirse',
];

export const ASK_TO_JOIN_KEYWORDS = [
  'ask to join',
  'pedir para participar',
  'solicitar acesso',
  'pedir unirse',
  'solicitar unirse',
];

export const OPEN_CALL_KEYWORDS = [
  'this call is open to anyone',
  'esta chamada está aberta',
  'esta llamada está abierta',
];

export const JOIN_BUTTON_KEYWORDS = [
  ...JOIN_NOW_KEYWORDS,
  ...JOIN_NOW_WEAK_KEYWORDS,
  ...ASK_TO_JOIN_KEYWORDS,
];

export const PREFER_JOIN_NOW_KEYWORDS = [...JOIN_NOW_KEYWORDS, ...JOIN_NOW_WEAK_KEYWORDS];

export function classifyJoinLabel(text) {
  const normalized = normalizeHaystack(text);
  if (matchesAnyKeyword(normalized, ASK_TO_JOIN_KEYWORDS)) {
    return 'ask-to-join';
  }
  if (matchesAnyKeyword(normalized, JOIN_NOW_KEYWORDS)) {
    return 'join-now';
  }
  if (matchesAnyKeyword(normalized, JOIN_NOW_WEAK_KEYWORDS)) {
    return 'join-now';
  }
  return null;
}

export const LEAVE_CALL_KEYWORDS = [
  'leave call',
  'leave the call',
  'end call',
  'sair da chamada',
  'encerrar chamada',
  'salir de la llamada',
];

export const WAITING_ROOM_KEYWORDS = [
  "you'll join when someone lets you in",
  'asking to join',
  'waiting for the host',
  'someone will let you in',
  'aguardando',
  'pedindo para participar',
  'esperando o anfitrião',
  'pidiendo unirse',
];

export const BLOCKED_KEYWORDS = [
  "you can't join this video call",
  'cannot join',
  'não é possível participar',
  'no puedes unirte',
];

export const CHAT_TOGGLE_KEYWORDS = [
  'chat with everyone',
  'in-call messages',
  'show in-call messages',
  'open chat',
  'show chat',
  'use the chat',
  'conversar com todos',
  'mensagens da chamada',
  'abrir chat',
  'mostrar chat',
  'chatear con todos',
  'mensajes de la llamada',
];

export const CHAT_TOGGLE_WEAK_KEYWORDS = ['chat', 'mensagens', 'mensajes'];

export const CHAT_INPUT_KEYWORDS = [
  'send a message to everyone',
  'send a message',
  'enviar uma mensagem para todos',
  'enviar uma mensagem',
  'enviar un mensaje a todos',
  'enviar un mensaje',
];

export const CHAT_SEND_KEYWORDS = [
  'send a message',
  'send message',
  'enviar mensagem',
  'enviar una mensaje',
  'enviar un mensaje',
  'enviar',
];

export const MORE_OPTIONS_KEYWORDS = [
  'more options',
  'more actions',
  'mais opções',
  'más opciones',
];

export const IN_CALL_TOOLBAR_KEYWORDS = [
  ...LEAVE_CALL_KEYWORDS,
  'turn on camera',
  'turn off camera',
  'ligar câmera',
  'desligar câmera',
  'activar cámara',
];

export function normalizeHaystack(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchesAnyKeyword(haystack, keywords) {
  const text = normalizeHaystack(haystack);
  return keywords.some((keyword) => text.includes(keyword));
}

export function elementHaystackFromAttrs(attrs) {
  return normalizeHaystack([
    attrs.ariaLabel,
    attrs.dataTooltip,
    attrs.title,
    attrs.ariaDescription,
    attrs.text,
  ].join(' '));
}

export const CHAT_TOGGLE_SELECTORS = [
  'button[aria-label*="Chat with everyone" i]',
  'button[aria-label*="in-call messages" i]',
  'button[aria-label*="Open chat" i]',
  'button[aria-label*="Show chat" i]',
  'button[aria-label*="Conversar com todos" i]',
  'button[aria-label*="Chatear con todos" i]',
  '[role="button"][aria-label*="Chat with everyone" i]',
  '[role="button"][aria-label*="in-call messages" i]',
  '[data-panel-id="chat"] button',
  'button[aria-label*="Chat" i]',
];

export const CHAT_INPUT_SELECTORS = [
  'textarea[aria-label*="Send a message to everyone" i]',
  'textarea[aria-label*="Send a message" i]',
  'textarea[aria-label*="Enviar uma mensagem" i]',
  'textarea[aria-label*="Enviar un mensaje" i]',
  '[contenteditable="true"][aria-label*="message" i]',
  '[contenteditable="true"][aria-label*="mensagem" i]',
  'textarea[aria-label*="message" i]',
];

export const CHAT_SEND_SELECTORS = [
  'button[aria-label*="Send a message" i]',
  'button[aria-label*="Send message" i]',
  'button[aria-label*="Enviar mensagem" i]',
  'button[aria-label*="Enviar un mensaje" i]',
];

export const LEAVE_CALL_SELECTORS = [
  'button[aria-label*="Leave call" i]',
  'button[aria-label*="Sair da chamada" i]',
  'button[aria-label*="Salir de la llamada" i]',
  '[role="button"][aria-label*="Leave call" i]',
];

export const CAMERA_OFF_SELECTORS = [
  'button[aria-label*="Turn off camera" i]',
  'button[aria-label*="Desligar câmera" i]',
  'button[aria-label*="Desactivar cámara" i]',
  'div[aria-label*="Turn off camera" i]',
];

export const MIC_OFF_SELECTORS = [
  'button[aria-label*="Turn off microphone" i]',
  'button[aria-label*="Desligar microfone" i]',
  'button[aria-label*="Desactivar micrófono" i]',
  'div[aria-label*="Turn off microphone" i]',
];
