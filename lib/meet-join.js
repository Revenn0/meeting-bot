import {
  CAMERA_OFF_SELECTORS,
  JOIN_BUTTON_KEYWORDS,
  MIC_OFF_SELECTORS,
  NAME_INPUT_SELECTORS,
  PREFER_JOIN_NOW_KEYWORDS,
} from './meet-selectors.js';

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

  const joinClicked = await page.evaluate(
    ({ prefer, all }) => {
      const normalize = (value) => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const visible = (el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return rect.width > 2 && rect.height > 2 && style.visibility !== 'hidden';
      };
      const haystack = (el) => normalize([
        el.getAttribute('aria-label'),
        el.textContent,
      ].join(' '));
      const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(visible);
      const match = (keywords) => buttons.find((button) => keywords.some((keyword) => haystack(button).includes(keyword)));
      const preferred = match(prefer);
      const fallback = match(all);
      const target = preferred || fallback;
      if (!target) return null;
      target.click();
      return haystack(target);
    },
    { prefer: PREFER_JOIN_NOW_KEYWORDS, all: JOIN_BUTTON_KEYWORDS },
  );

  if (!joinClicked) {
    throw new Error(
      'Could not find "Join now" or "Ask to join". Open the Meet room in a browser and confirm the guest join button.',
    );
  }

  console.log('[join] Clicked join control:', joinClicked, 'as', botName);
  console.log('[join] Waiting for real in-call UI (Leave call). Click+sleep is not enough.');
}
