import {
  ASK_TO_JOIN_KEYWORDS,
  CAMERA_OFF_SELECTORS,
  JOIN_NOW_KEYWORDS,
  JOIN_NOW_WEAK_KEYWORDS,
  MIC_OFF_SELECTORS,
  NAME_INPUT_SELECTORS,
  OPEN_CALL_KEYWORDS,
} from './meet-selectors.js';
import { inspectMeetState, MEET_PHASES } from './meet-state.js';

export async function disableCameraAndMic(page) {
  const clicked = await page.evaluate(
    ({ cameraSelectors, micSelectors }) => {
      const click = (selectors) => {
        for (const selector of selectors) {
          const nodes = document.querySelectorAll(selector);
          for (const node of nodes) {
            const rect = node.getBoundingClientRect?.();
            const visible = rect ? rect.width > 0 && rect.height > 0 : true;
            if (visible && !node.disabled) {
              node.click();
              return selector;
            }
          }
        }
        return null;
      };

      return {
        camera: click(cameraSelectors),
        mic: click(micSelectors),
      };
    },
    {
      cameraSelectors: CAMERA_OFF_SELECTORS,
      micSelectors: MIC_OFF_SELECTORS,
    },
  );

  if (clicked.camera) {
    console.log('[join] Disabled camera via', clicked.camera);
  } else {
    console.log('[join] Camera already off or toggle not found.');
  }

  if (clicked.mic) {
    console.log('[join] Disabled microphone via', clicked.mic);
  } else {
    console.log('[join] Microphone already off or toggle not found.');
  }

  return clicked;
}

async function findNameInputSelector(page) {
  return page.evaluate((selectors) => {
    const visible = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2;
    };
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && visible(node)) return selector;
    }
    return null;
  }, NAME_INPUT_SELECTORS);
}

/**
 * Pick a join control. Join now / Entrar always wins over Ask to join.
 * Hidden, aria-hidden, disabled, or offscreen Ask-to-join is never clicked
 * when a visible Join now exists (and is never clicked at all if not strictly visible).
 */
export async function clickVisibleJoinControl(page, { joinNowOnly = false } = {}) {
  return page.evaluate(
    ({ joinNowKeywords, joinNowWeak, askKeywords, openCallKeywords, joinNowOnly: onlyNow }) => {
      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const haystack = (el) => normalize([
        el.getAttribute('aria-label'),
        el.getAttribute('data-tooltip'),
        el.getAttribute('title'),
        el.textContent,
      ].join(' '));
      const matches = (text, keywords) => keywords.some((keyword) => text.includes(keyword));

      const isStrictlyVisible = (el) => {
        if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return false;
        if (el.closest('[hidden], [aria-hidden="true"]')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        if (Number.parseFloat(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width < 4 || rect.height < 4) return false;
        const vw = window.innerWidth || document.documentElement.clientWidth;
        const vh = window.innerHeight || document.documentElement.clientHeight;
        const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
        if (!inViewport) return false;
        return true;
      };

      const classify = (text) => {
        if (matches(text, askKeywords)) return 'ask-to-join';
        if (matches(text, joinNowKeywords)) return 'join-now';
        if (matches(text, joinNowWeak)) return 'join-now';
        return null;
      };

      const nodes = [...document.querySelectorAll('button, [role="button"]')];
      const visible = nodes
        .map((el) => ({ el, text: haystack(el), kind: classify(haystack(el)) }))
        .filter((item) => item.kind && isStrictlyVisible(item.el));

      const openCall = matches(normalize(document.body?.innerText || ''), openCallKeywords);
      const joinNow = visible.find((item) => item.kind === 'join-now');
      const ask = visible.find((item) => item.kind === 'ask-to-join');

      let chosen = null;
      if (joinNow) {
        chosen = joinNow;
      } else if (!onlyNow && ask && !openCall) {
        chosen = ask;
      }

      if (!chosen) {
        return {
          clicked: null,
          kind: null,
          openCall,
          visibleJoinNow: visible.filter((item) => item.kind === 'join-now').length,
          visibleAsk: visible.filter((item) => item.kind === 'ask-to-join').length,
          ignoredHiddenAsk: nodes.some((el) => classify(haystack(el)) === 'ask-to-join' && !isStrictlyVisible(el)),
        };
      }

      chosen.el.click();
      return {
        clicked: chosen.text.slice(0, 80),
        kind: chosen.kind,
        openCall,
        visibleJoinNow: visible.filter((item) => item.kind === 'join-now').length,
        visibleAsk: visible.filter((item) => item.kind === 'ask-to-join').length,
        ignoredHiddenAsk: nodes.some((el) => classify(haystack(el)) === 'ask-to-join' && !isStrictlyVisible(el)),
      };
    },
    {
      joinNowKeywords: JOIN_NOW_KEYWORDS,
      joinNowWeak: JOIN_NOW_WEAK_KEYWORDS,
      askKeywords: ASK_TO_JOIN_KEYWORDS,
      openCallKeywords: OPEN_CALL_KEYWORDS,
      joinNowOnly,
    },
  );
}

export async function joinMeetAsGuest(page, {
  meetUrl,
  botName,
  joinTimeoutMs,
  outputDir,
  waitUntil = 'networkidle2',
}) {
  console.log(`[join] Navigating to ${meetUrl} (waitUntil=${waitUntil})`);
  await page.goto(meetUrl, { waitUntil, timeout: joinTimeoutMs + 15000 });

  const nameSelector = await page.waitForFunction(
    (selectors) => {
      const visible = (el) => {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 2 && rect.height > 2;
      };
      for (const selector of selectors) {
        const node = document.querySelector(selector);
        if (node && visible(node)) return selector;
      }
      return false;
    },
    { timeout: joinTimeoutMs },
    NAME_INPUT_SELECTORS,
  ).then(async () => findNameInputSelector(page)).catch(async () => null);

  if (!nameSelector) {
    const screenshotPath = `${outputDir}/debug-join-${Date.now()}.png`;
    console.error('[join] Name input not found. Meet pre-join UI may have changed.');
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.error('[join] Screenshot:', screenshotPath);
    throw new Error(
      'Could not find guest name input on Meet pre-join screen. Check MEET_URL and UI changes.',
    );
  }

  await disableCameraAndMic(page);

  await page.click(nameSelector, { clickCount: 3 }).catch(() => {});
  await page.type(nameSelector, botName, { delay: 5 });
  await new Promise((resolve) => setTimeout(resolve, 200));

  const first = await clickVisibleJoinControl(page, { joinNowOnly: false });
  if (!first?.clicked) {
    throw new Error(
      'Could not find a visible enabled "Join now" / "Entrar" (or Ask to join). '
        + 'Hidden Ask-to-join controls are ignored when the call is open.',
    );
  }

  console.log(
    `[join] Clicked ${first.kind}: "${first.clicked}" as ${botName}`
      + `${first.ignoredHiddenAsk ? ' (ignored hidden Ask to join)' : ''}`
      + `${first.openCall ? ' (open-call banner)' : ''}`,
  );

  await new Promise((resolve) => setTimeout(resolve, 500));
  const afterFirst = await inspectMeetState(page);
  if (afterFirst.phase === MEET_PHASES.PREJOIN) {
    console.log('[join] Still on prejoin after first click; retrying visible Join now once.');
    const retry = await clickVisibleJoinControl(page, { joinNowOnly: true });
    if (retry?.clicked) {
      console.log(`[join] Retry clicked ${retry.kind}: "${retry.clicked}"`);
    } else {
      console.log('[join] Retry: no visible Join now / Entrar to click.');
    }
  }

  console.log('[join] Waiting for real in-call UI (Leave call). Click+sleep is not enough.');
}
