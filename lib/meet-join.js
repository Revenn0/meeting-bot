import {
  CAMERA_OFF_SELECTORS,
  MIC_OFF_SELECTORS,
  clickFirstMatch,
} from './chat-selectors.js';

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

export async function joinMeetAsGuest(page, { meetUrl, botName, joinTimeoutMs, outputDir }) {
  console.log(`[join] Navigating to ${meetUrl}`);
  await page.goto(meetUrl, { waitUntil: 'networkidle2' });

  try {
    await page.waitForSelector('input[type="text"]', { timeout: joinTimeoutMs });
  } catch (err) {
    const ts = Date.now();
    const screenshotPath = `${outputDir}/debug-join-${ts}.png`;
    console.error('[join] Name input not found. Meet pre-join UI may have changed.');
    console.error('[join] Saving screenshot to', screenshotPath);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    const html = await page.content();
    console.error('[join] Page HTML preview:', html.substring(0, 2000));
    throw new Error(
      'Could not find guest name input on Meet pre-join screen. Check MEET_URL and UI changes.',
    );
  }

  await disableCameraAndMic(page);

  await page.type('input[type="text"]', botName, { delay: 25 });
  await new Promise((resolve) => setTimeout(resolve, 500));

  const joinClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const askButton = buttons.find((button) => {
      const text = (button.textContent || '').toLowerCase();
      return text.includes('ask to join') || text.includes('join now');
    });
    if (askButton) {
      askButton.click();
      return true;
    }
    return false;
  });

  if (!joinClicked) {
    throw new Error(
      'Could not find "Ask to join" or "Join now" button. Meet pre-join UI may have changed.',
    );
  }

  console.log('[join] Requested to join as', botName);
}
