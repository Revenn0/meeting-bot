import puppeteer from 'puppeteer';
import { isChatOnlyMode } from './config.js';

export function buildLaunchArgs(config, mediaPaths) {
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--lang=en-US',
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--window-size=1280,720',
  ];

  if (!isChatOnlyMode(config)) {
    args.push(
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${mediaPaths.videoPath}`,
      `--use-file-for-fake-audio-capture=${mediaPaths.audioPath}`,
      '--allow-file-access-from-files',
    );
  }

  return args;
}

export async function launchBrowser(config, mediaPaths) {
  return puppeteer.launch({
    headless: config.headless,
    executablePath: config.puppeteerExecutablePath,
    args: buildLaunchArgs(config, mediaPaths),
  });
}
