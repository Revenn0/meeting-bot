import {
  BLOCKED_KEYWORDS,
  CHAT_INPUT_KEYWORDS,
  CHAT_TOGGLE_KEYWORDS,
  JOIN_BUTTON_KEYWORDS,
  LEAVE_CALL_KEYWORDS,
  WAITING_ROOM_KEYWORDS,
} from './meet-selectors.js';

export const MEET_PHASES = {
  PREJOIN: 'prejoin',
  WAITING: 'waiting',
  IN_CALL: 'in-call',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown',
};

export async function inspectMeetState(page) {
  return page.evaluate(
    (payload) => {
      const leaveKeywords = payload.leaveKeywords;
      const joinKeywords = payload.joinKeywords;
      const chatToggleKeywords = payload.chatToggleKeywords;
      const chatInputKeywords = payload.chatInputKeywords;
      const waitingKeywords = payload.waitingKeywords;
      const blockedKeywords = payload.blockedKeywords;
      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
        if (el.closest('[hidden], [aria-hidden="true"]')) return false;
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
        return rect.width > 2 && rect.height > 2
          && inViewport
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && style.opacity !== '0';
      };
      const haystack = (el) => normalize([
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip'),
        el.getAttribute('title'),
        el.getAttribute('aria-description'),
        el.textContent,
      ].join(' '));
      const anyKeyword = (text, keywords) => keywords.some((keyword) => text.includes(keyword));
      const clickables = [...document.querySelectorAll('button, [role="button"], textarea, [contenteditable="true"]')];
      const bodyText = normalize(document.body?.innerText || '');
      const labels = [];
      let hasLeaveCall = false;
      let hasJoinButton = false;
      let hasChatToggle = false;
      let hasChatInput = false;
      for (const el of clickables) {
        if (!visible(el)) continue;
        const text = haystack(el);
        labels.push(text.slice(0, 80));
        if (anyKeyword(text, leaveKeywords)) hasLeaveCall = true;
        if (anyKeyword(text, joinKeywords)) hasJoinButton = true;
        if (anyKeyword(text, chatToggleKeywords)) hasChatToggle = true;
        if ((el.matches?.('textarea, [contenteditable="true"]') || el.tagName === 'TEXTAREA')
          && anyKeyword(text, chatInputKeywords)) {
          hasChatInput = true;
        }
      }
      const hasNameInput = [...document.querySelectorAll('input[type="text"], input:not([type])')].some((el) => visible(el));
      const hasWaitingText = anyKeyword(bodyText, waitingKeywords);
      const hasBlockedText = anyKeyword(bodyText, blockedKeywords);
      let phase = 'unknown';
      if (hasBlockedText && !hasLeaveCall) phase = 'blocked';
      else if (hasWaitingText && !hasLeaveCall) phase = 'waiting';
      else if (hasLeaveCall && !hasJoinButton) phase = 'in-call';
      else if (hasLeaveCall && hasChatInput) phase = 'in-call';
      else if (hasNameInput && hasJoinButton && !hasLeaveCall) phase = 'prejoin';
      else if (hasJoinButton && !hasLeaveCall) phase = 'prejoin';
      return {
        phase,
        hasLeaveCall,
        hasJoinButton,
        hasChatToggle,
        hasChatInput,
        hasNameInput,
        hasWaitingText,
        hasBlockedText,
        labels: labels.slice(0, 20),
      };
    },
    {
      leaveKeywords: LEAVE_CALL_KEYWORDS,
      joinKeywords: JOIN_BUTTON_KEYWORDS,
      chatToggleKeywords: CHAT_TOGGLE_KEYWORDS,
      chatInputKeywords: CHAT_INPUT_KEYWORDS,
      waitingKeywords: WAITING_ROOM_KEYWORDS,
      blockedKeywords: BLOCKED_KEYWORDS,
    },
  );
}

export function isInCallPhase(state) {
  return state?.phase === MEET_PHASES.IN_CALL;
}

export async function waitUntilInCall(page, { timeoutMs, outputDir, pollMs = 500 }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;

  while (Date.now() < deadline) {
    last = await inspectMeetState(page);
    if (last.phase === MEET_PHASES.BLOCKED) {
      throw new Error(
        'Meet blocked this guest ("you can\'t join this video call"). Open the room from a host account and retry headful.',
      );
    }
    if (last.phase === MEET_PHASES.IN_CALL) {
      console.log('[join] In-call confirmed (Leave call visible, Join now gone).');
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  const screenshotPath = `${outputDir}/debug-incall-${Date.now()}.png`;
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  console.error('[join] Timed out waiting for in-call UI. Last state:', JSON.stringify(last));
  console.error('[join] Screenshot:', screenshotPath);
  throw new Error(
    `Not in the live Meet call after ${timeoutMs}ms (phase=${last?.phase}). `
      + 'Open-room guests should see "Join now" then a Leave call button. '
      + 'If the room requires host admit, wait on the host side. Do not treat click+sleep as joined.',
  );
}
