import puppeteer from 'puppeteer';
import { isChatOnlyMode } from './config.js';
import { buildArgsForProfile, CHROMIUM_PROFILES, documentFlags } from './chromium-flags.js';

export function buildLaunchArgs(config, mediaPaths) {
  const profile = config.chromiumProfile
    || (isChatOnlyMode(config) ? CHROMIUM_PROFILES.CHAT_SLIM : CHROMIUM_PROFILES.RECORDING);

  return buildArgsForProfile(profile, {
    windowSize: config.window?.raw || (isChatOnlyMode(config) ? '800x600' : '1280x720'),
    jsHeapMb: config.jsHeapMb || 96,
    mediaPaths: mediaPaths || { videoPath: '', audioPath: '' },
  });
}

export async function launchBrowser(config, mediaPaths) {
  const args = buildLaunchArgs(config, mediaPaths);
  console.log('[bot] Chromium profile:', config.chromiumProfile);
  if (config.debugBrowserLogs) {
    console.log('[bot] Chromium flags:');
    for (const { flag, reason } of documentFlags(args)) {
      console.log(`  ${flag}`);
      console.log(`    ${reason}`);
    }
  }

  const launch = {
    headless: config.headless,
    executablePath: config.puppeteerExecutablePath,
    args,
    defaultViewport: {
      width: config.window.width,
      height: config.window.height,
      deviceScaleFactor: 1,
    },
  };
  if (config.userDataDir) {
    launch.userDataDir = config.userDataDir;
  }
  return puppeteer.launch(launch);
}
