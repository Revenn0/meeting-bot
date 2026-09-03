export const CHAT_TOGGLE_SELECTORS = [
  'button[aria-label*="Chat with everyone"]',
  'button[aria-label*="chat with everyone"]',
  'button[aria-label*="Chat"]',
  'button[aria-label*="chat"]',
  '[data-panel-id="chat"] button',
];

export const CHAT_INPUT_SELECTORS = [
  'textarea[aria-label*="Send a message"]',
  'textarea[aria-label*="send a message"]',
  'textarea[aria-label*="message"]',
  '[contenteditable="true"][aria-label*="message"]',
  '[contenteditable="true"][data-placeholder*="message"]',
];

export const CHAT_SEND_SELECTORS = [
  'button[aria-label*="Send a message"]',
  'button[aria-label*="send a message"]',
  'button[aria-label*="Send message"]',
];

export const LEAVE_CALL_SELECTORS = [
  'button[aria-label*="Leave call"]',
  'button[aria-label*="leave call"]',
];

export const CAMERA_OFF_SELECTORS = [
  'button[aria-label*="Turn off camera"]',
  'button[aria-label*="turn off camera"]',
  'div[aria-label*="Turn off camera"]',
];

export const MIC_OFF_SELECTORS = [
  'button[aria-label*="Turn off microphone"]',
  'button[aria-label*="turn off microphone"]',
  'div[aria-label*="Turn off microphone"]',
];

export function findFirstVisible(root, selectors) {
  for (const selector of selectors) {
    const nodes = root.querySelectorAll(selector);
    for (const node of nodes) {
      const rect = node.getBoundingClientRect?.();
      const visible = rect ? rect.width > 0 && rect.height > 0 : true;
      const disabled = node.disabled === true || node.getAttribute?.('aria-disabled') === 'true';
      if (visible && !disabled) {
        return { selector, element: node };
      }
    }
  }
  return null;
}

export function clickFirstMatch(root, selectors) {
  const match = findFirstVisible(root, selectors);
  if (!match) {
    return null;
  }
  match.element.click();
  return match.selector;
}
