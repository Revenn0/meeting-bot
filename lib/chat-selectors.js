export {
  CAMERA_OFF_SELECTORS,
  CHAT_INPUT_SELECTORS,
  CHAT_SEND_SELECTORS,
  CHAT_TOGGLE_SELECTORS,
  LEAVE_CALL_SELECTORS,
  MIC_OFF_SELECTORS,
} from './meet-selectors.js';

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
