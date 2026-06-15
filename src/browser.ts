/**
 * Browser detection and management for PDF generation.
 *
 * Resolution order:
 *   1. An explicit executable path from the `md-to-pdf.browserPath` setting.
 *   2. An auto-detected system Chrome / Chromium / Edge.
 *   3. A Chrome build auto-downloaded via @puppeteer/browsers into the
 *      extension's global storage.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import type { Browser } from 'puppeteer-core';

let puppeteer: typeof import('puppeteer-core') | null = null;
let browserInstance: Browser | null = null;

// Configured by the extension at activation.
let configuredBrowserPath = '';
let downloadDir = '';
let downloadedExecutable: string | null = null;

export interface BrowserConfig {
  browserPath?: string;
  downloadDir?: string;
}

/** Provide the configured browser path and the directory to cache downloads in. */
export function configureBrowser(cfg: BrowserConfig): void {
  configuredBrowserPath = (cfg.browserPath || '').trim();
  downloadDir = cfg.downloadDir || '';
}

/** Chrome/Chromium executable paths by platform */
const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
  ],
};

/**
 * Find a usable Chrome/Chromium executable: configured path first, then known
 * system locations.
 */
export function findChrome(): string | undefined {
  if (configuredBrowserPath && fs.existsSync(configuredBrowserPath)) {
    return configuredBrowserPath;
  }

  const platform = process.platform;
  const paths = CHROME_PATHS[platform] || CHROME_PATHS.linux;

  for (const chromePath of paths) {
    if (chromePath && fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  if (platform !== 'win32') {
    try {
      const result = execSync('which google-chrome chromium chrome 2>/dev/null | head -1', {
        encoding: 'utf-8',
      }).trim();
      if (result && fs.existsSync(result)) {
        return result;
      }
    } catch {
      // Ignore errors
    }
  }

  return undefined;
}

/**
 * Download a Chrome build via @puppeteer/browsers into the cache directory and
 * return the executable path. Reuses an existing download when present.
 */
async function downloadChrome(
  onProgress?: (downloaded: number, total: number) => void
): Promise<string> {
  if (downloadedExecutable && fs.existsSync(downloadedExecutable)) {
    return downloadedExecutable;
  }

  const browsers = await import('@puppeteer/browsers');
  const cacheDir = downloadDir || path.join(process.cwd(), '.md-to-pdf-chrome');
  fs.mkdirSync(cacheDir, { recursive: true });

  const platform = browsers.detectBrowserPlatform();
  if (!platform) {
    throw new Error('Unable to determine the browser platform for download.');
  }

  const buildId = await browsers.resolveBuildId(browsers.Browser.CHROME, platform, 'stable');

  const executablePath = browsers.computeExecutablePath({
    browser: browsers.Browser.CHROME,
    buildId,
    cacheDir,
  });

  if (!fs.existsSync(executablePath)) {
    await browsers.install({
      browser: browsers.Browser.CHROME,
      buildId,
      cacheDir,
      downloadProgressCallback: onProgress,
    });
  }

  downloadedExecutable = executablePath;
  return executablePath;
}

/**
 * Get or create a browser instance, reusing the existing connection.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }

  if (!puppeteer) {
    puppeteer = await import('puppeteer-core');
  }

  let executablePath = findChrome();

  if (!executablePath) {
    // No system browser — auto-download Chrome.
    try {
      executablePath = await import('vscode').then(async (vscode) => {
        return vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'MD to PDF: downloading Chrome (one-time setup)...',
            cancellable: false,
          },
          async (progress) => {
            let lastPct = 0;
            return downloadChrome((downloaded, total) => {
              if (total > 0) {
                const pct = Math.floor((downloaded / total) * 100);
                if (pct > lastPct) {
                  progress.report({ increment: pct - lastPct, message: `${pct}%` });
                  lastPct = pct;
                }
              }
            });
          }
        );
      });
    } catch (err) {
      // Fall back to a download without the VS Code progress UI if needed.
      try {
        executablePath = await downloadChrome();
      } catch (downloadErr) {
        throw new Error(
          'Chrome, Chromium, or Edge not found and automatic download failed. ' +
            'Install a Chromium-based browser or set "md-to-pdf.browserPath". ' +
            `(${downloadErr instanceof Error ? downloadErr.message : String(downloadErr)})`
        );
      }
    }
  }

  browserInstance = await puppeteer.launch({
    headless: true,
    executablePath,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--allow-file-access-from-files',
    ],
  });

  return browserInstance;
}

/**
 * Close the browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch {
      // Ignore errors during cleanup
    }
    browserInstance = null;
  }
}
