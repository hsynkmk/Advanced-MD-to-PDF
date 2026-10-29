/**
 * Browser detection and management for PDF generation.
 *
 * Resolution order:
 *   1. An explicit executable path from the `md-to-pdf.browserPath` setting.
 *   2. An auto-detected system Chrome / Chromium / Edge / Brave.
 *   3. A Chrome build auto-downloaded via @puppeteer/browsers into the
 *      extension's global storage (reused offline on later sessions).
 *
 * A single headless instance is shared by all conversions. Concurrent callers
 * share one launch, and the browser is closed after a period of inactivity so
 * it does not stay resident for the whole VS Code session.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import type { Browser, Page } from 'puppeteer-core';

let puppeteer: typeof import('puppeteer-core') | null = null;
let browserInstance: Browser | null = null;
let launching: Promise<Browser> | null = null;

// Configured by the extension at activation.
let configuredBrowserPath = '';
let downloadDir = '';
let downloadedExecutable: string | null = null;
let warn: (message: string) => void = (message) => console.warn(message);
let warnedMissingPath = '';

/** Close the shared browser after this long without any conversion. */
const IDLE_CLOSE_MS = 5 * 60 * 1000;
let activePages = 0;
let idleTimer: NodeJS.Timeout | undefined;

export interface BrowserConfig {
  browserPath?: string;
  downloadDir?: string;
  /** Receives user-facing warnings (e.g. a configured browserPath that does not exist). */
  onWarning?: (message: string) => void;
}

/** Provide the configured browser path and the directory to cache downloads in. */
export function configureBrowser(cfg: BrowserConfig): void {
  configuredBrowserPath = (cfg.browserPath || '').trim();
  downloadDir = cfg.downloadDir || '';
  if (cfg.onWarning) { warn = cfg.onWarning; }
  warnedMissingPath = '';
}

const HOME = os.homedir();
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const PROGRAMFILES = process.env.ProgramFiles || 'C:\\Program Files';
const PROGRAMFILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

/** Chrome/Chromium executable paths by platform */
const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    `${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    `${HOME}/Applications/Chromium.app/Contents/MacOS/Chromium`,
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ],
  win32: [
    `${PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
    `${PROGRAMFILES_X86}\\Google\\Chrome\\Application\\chrome.exe`,
    `${LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${PROGRAMFILES_X86}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${PROGRAMFILES}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    `${LOCALAPPDATA}\\Chromium\\Application\\chrome.exe`,
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/opt/google/chrome/chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/brave-browser',
    '/var/lib/flatpak/exports/bin/com.google.Chrome',
  ],
};

/**
 * Find a usable Chrome/Chromium executable: configured path first, then known
 * system locations.
 */
export function findChrome(): string | undefined {
  if (configuredBrowserPath) {
    if (fs.existsSync(configuredBrowserPath)) {
      return configuredBrowserPath;
    }
    if (warnedMissingPath !== configuredBrowserPath) {
      warnedMissingPath = configuredBrowserPath;
      warn(`MD to PDF: "md-to-pdf.browserPath" (${configuredBrowserPath}) does not exist — falling back to auto-detection.`);
    }
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
      const result = execSync(
        'command -v google-chrome google-chrome-stable chromium chromium-browser microsoft-edge brave-browser chrome 2>/dev/null | head -1',
        { encoding: 'utf-8' }
      ).trim();
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
 * return the executable path. A previously downloaded build is reused without
 * touching the network, so conversions keep working offline.
 */
async function downloadChrome(
  onProgress?: (downloaded: number, total: number) => void
): Promise<string> {
  if (downloadedExecutable && fs.existsSync(downloadedExecutable)) {
    return downloadedExecutable;
  }

  const browsers = await import('@puppeteer/browsers');
  const cacheDir = downloadDir || path.join(os.tmpdir(), 'md-to-pdf-chrome');
  fs.mkdirSync(cacheDir, { recursive: true });

  // Reuse an existing download first (newest build wins).
  try {
    const installed = (await browsers.getInstalledBrowsers({ cacheDir }))
      .filter((b) => b.browser === browsers.Browser.CHROME && fs.existsSync(b.executablePath))
      .sort((a, b) => b.buildId.localeCompare(a.buildId, undefined, { numeric: true }));
    if (installed.length) {
      downloadedExecutable = installed[0].executablePath;
      return downloadedExecutable;
    }
  } catch {
    // Unreadable cache — fall through to a fresh download.
  }

  const platform = browsers.detectBrowserPlatform();
  if (!platform) {
    throw new Error('Unable to determine the browser platform for download.');
  }

  const buildId = await browsers.resolveBuildId(browsers.Browser.CHROME, platform, 'stable');
  const installed = await browsers.install({
    browser: browsers.Browser.CHROME,
    buildId,
    cacheDir,
    downloadProgressCallback: onProgress,
  });

  downloadedExecutable = installed.executablePath;
  return downloadedExecutable;
}

/** Download Chrome, showing VS Code progress when running inside the editor. */
async function downloadChromeWithProgress(): Promise<string> {
  let vscode: typeof import('vscode') | undefined;
  try {
    vscode = await import('vscode');
  } catch {
    // Not running inside VS Code (e.g. tests) — download without UI.
  }
  if (!vscode) {
    return downloadChrome();
  }

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
}

/** Chrome's sandbox only needs disabling when running as root on Linux (e.g. containers). */
function launchArgs(): string[] {
  const args = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--allow-file-access-from-files',
  ];
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (process.platform === 'linux' && isRoot) {
    args.push('--no-sandbox', '--disable-setuid-sandbox');
  }
  return args;
}

async function launchBrowser(): Promise<Browser> {
  if (!puppeteer) {
    puppeteer = await import('puppeteer-core');
  }

  let executablePath = findChrome();
  if (!executablePath) {
    try {
      executablePath = await downloadChromeWithProgress();
    } catch (downloadErr) {
      throw new Error(
        'Chrome, Chromium, Edge, or Brave not found and automatic download failed. ' +
          'Install a Chromium-based browser or set "md-to-pdf.browserPath". ' +
          `(${downloadErr instanceof Error ? downloadErr.message : String(downloadErr)})`
      );
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: launchArgs(),
  });
  browser.on('disconnected', () => {
    if (browserInstance === browser) { browserInstance = null; }
  });
  return browser;
}

/**
 * Get or create the shared browser instance. Concurrent callers await the same
 * launch instead of each starting (and leaking) their own Chrome.
 */
export async function getBrowser(): Promise<Browser> {
  if (browserInstance && browserInstance.connected) {
    return browserInstance;
  }
  if (!launching) {
    launching = launchBrowser()
      .then((browser) => {
        browserInstance = browser;
        return browser;
      })
      .finally(() => {
        launching = null;
      });
  }
  return launching;
}

function scheduleIdleClose(): void {
  if (idleTimer) { clearTimeout(idleTimer); }
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (activePages === 0) {
      closeBrowser().catch(console.error);
    }
  }, IDLE_CLOSE_MS);
  idleTimer.unref?.();
}

/**
 * Run `fn` with a fresh page on the shared browser. The page is always closed
 * afterwards (without masking the original error if the browser died), and the
 * browser is shut down once it has been idle for a while.
 */
export async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
  activePages++;
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      return await fn(page);
    } finally {
      try { await page.close(); } catch { /* browser may already be gone */ }
    }
  } finally {
    activePages--;
    if (activePages === 0) { scheduleIdleClose(); }
  }
}

/**
 * Close the browser instance.
 */
export async function closeBrowser(): Promise<void> {
  if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
  const pending = launching;
  const browser = browserInstance ?? (pending ? await pending.catch(() => null) : null);
  browserInstance = null;
  if (browser) {
    try {
      await browser.close();
    } catch {
      // Ignore errors during cleanup
    }
  }
}
