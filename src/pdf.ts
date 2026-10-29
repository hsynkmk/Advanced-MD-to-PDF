/**
 * Chrome side of PDF generation: loads rendered HTML in headless Chrome, renders
 * Mermaid, waits for assets, prints to PDF and writes the file atomically.
 *
 * Free of `vscode` imports so it can be exercised directly by tests.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { pathToFileURL } from 'url';
import type { Page } from 'puppeteer-core';

import { withPage } from './browser';
import { PageFormat, PdfMargins, pageGeometry } from './page';

// ============================================
// Types
// ============================================

export interface HeaderFooterConfig {
  enabled?: boolean;
  template?: string;
}

export interface PdfOptions {
  format: PageFormat;
  margins: PdfMargins;
  landscape: boolean;
  scale: number;
  timeout: number;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  mermaidTheme: string;
}

/** Minimal cancellation token (structurally compatible with vscode.CancellationToken). */
export interface CancellationLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): { dispose(): void };
}

/** Thrown when the user cancels a conversion. */
export class ConversionCancelled extends Error {
  constructor() { super('Conversion cancelled'); }
}

/** Thrown when the target PDF cannot be replaced (typically open in another program). */
export class PdfLockedError extends Error {
  constructor(public readonly pdfPath: string, cause: unknown) {
    super(
      `${path.basename(pdfPath)} is open in another program or not writable ` +
      `(${cause instanceof Error ? cause.message : String(cause)}).`
    );
  }
}

// ============================================
// Header / Footer templates
// ============================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Translate a user template (with {title} {date} {pageNumber} {totalPages} {filePath}
 * tokens) into the HTML Chrome expects for header/footer, wrapped with sensible
 * styling and aligned with the page's left/right margins.
 */
function buildHeaderFooterTemplate(template: string, filePath: string, margins: PdfMargins): string {
  const html = template
    .replace(/\{title\}/g, '<span class="title"></span>')
    .replace(/\{date\}/g, '<span class="date"></span>')
    .replace(/\{pageNumber\}/g, '<span class="pageNumber"></span>')
    .replace(/\{totalPages\}/g, '<span class="totalPages"></span>')
    .replace(/\{filePath\}/g, escapeHtml(filePath));

  return `<div style="font-size:9px; width:100%; padding:0 ${escapeHtml(margins.right)} 0 ${escapeHtml(margins.left)}; color:#888; -webkit-print-color-adjust:exact;">${html}</div>`;
}

// ============================================
// PDF Conversion
// ============================================

/** Cap on how long to wait for slow remote images/fonts before printing anyway. */
const ASSET_WAIT_MS = 15000;

/** Render every Mermaid diagram individually so one bad diagram does not hide the others. */
async function renderMermaid(page: Page, extensionPath: string, theme: string): Promise<string[]> {
  const mermaidUrl = pathToFileURL(
    path.join(extensionPath, 'out', 'mermaid', 'mermaid.esm.min.mjs')
  ).href;
  // The in-page code is passed as a string: compilers targeting CommonJS rewrite a
  // dynamic import() inside a function into require(), which does not exist in the page.
  const script = `(async () => {
    const mod = await import(${JSON.stringify(mermaidUrl)});
    const mermaid = mod.default || mod;
    mermaid.initialize({ startOnLoad: false, theme: ${JSON.stringify(theme)}, securityLevel: 'strict' });
    const failures = [];
    const nodes = Array.from(document.querySelectorAll('pre.mermaid'));
    for (let i = 0; i < nodes.length; i++) {
      try {
        await mermaid.run({ nodes: [nodes[i]] });
      } catch (e) {
        const first = (nodes[i].textContent || '').trim().split(String.fromCharCode(10))[0].slice(0, 60);
        failures.push('diagram ' + (i + 1) + ' (' + first + '): ' + (e && e.message ? e.message : e));
      }
    }
    return failures;
  })()`;
  try {
    return (await page.evaluate(script)) as string[];
  } catch (err) {
    return [`Mermaid could not be loaded: ${err instanceof Error ? err.message : String(err)}`];
  }
}

/** Wait (bounded) for fonts and images so the PDF never captures half-loaded assets. */
async function waitForAssets(page: Page): Promise<void> {
  await page.evaluate(async (capMs: number) => {
    const images = Array.from(document.images).map((img) =>
      img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
        img.addEventListener('load', () => resolve(), { once: true });
        img.addEventListener('error', () => resolve(), { once: true });
      })
    );
    await Promise.race([
      Promise.all([document.fonts.ready, ...images]),
      new Promise((resolve) => setTimeout(resolve, capMs)),
    ]);
  }, ASSET_WAIT_MS);
}

/** Shrink display equations wider than the page so they are not cut off. */
async function fitWideMath(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('.katex-display').forEach((el) => {
      const inner = el.firstElementChild as HTMLElement | null;
      if (inner && inner.scrollWidth > el.clientWidth + 1) {
        el.style.zoom = String(el.clientWidth / inner.scrollWidth);
      }
    });
  });
}

/** Write bytes via a temp file + rename so viewers never see a half-written PDF. */
function writeFileAtomic(target: string, data: Uint8Array): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, data);
    try {
      fs.renameSync(tmp, target);
    } catch (err: any) {
      if (err?.code === 'EXDEV') {
        fs.copyFileSync(tmp, target);
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    try { fs.unlinkSync(tmp); } catch { /* best effort */ }
    if (['EBUSY', 'EPERM', 'EACCES'].includes(err?.code)) {
      throw new PdfLockedError(target, err);
    }
    throw err;
  }
}

/**
 * Render an HTML string to a PDF file via headless Chrome.
 * The HTML is written to a temporary file and loaded over file:// so that
 * mermaid's ES-module imports (and local images/media) resolve correctly.
 */
export async function convertHtmlToPdf(
  htmlContent: string,
  outputPath: string,
  sourcePath: string,
  hasMermaid: boolean,
  extensionPath: string,
  opts: PdfOptions,
  token?: CancellationLike
): Promise<string[]> {
  const tmpHtml = path.join(os.tmpdir(), `md-to-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpHtml, htmlContent, 'utf-8');

  try {
    return await withPage(async (page) => {
      const cancelSub = token?.onCancellationRequested(() => { page.close().catch(() => undefined); });
      const checkCancelled = () => {
        if (token?.isCancellationRequested) { throw new ConversionCancelled(); }
      };

      try {
        // Apply the configured timeout to ALL operations (navigation, evaluate, and
        // crucially page.pdf), not just navigation. 0 disables the limit.
        page.setDefaultTimeout(opts.timeout);
        page.setDefaultNavigationTimeout(opts.timeout);

        // Lay the document out at the printable width so Mermaid, math fitting
        // and anything width-dependent are measured as they will be printed.
        const geometry = pageGeometry(opts.format, opts.landscape, opts.margins, opts.scale);
        await page.setViewport({ width: Math.round(geometry.contentWidth), height: 1000 });
        await page.emulateMediaType('print');

        await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: 'domcontentloaded', timeout: opts.timeout });
        checkCancelled();

        const warnings = hasMermaid ? await renderMermaid(page, extensionPath, opts.mermaidTheme) : [];
        checkCancelled();

        await waitForAssets(page);
        await fitWideMath(page);
        checkCancelled();

        const headerEnabled = !!opts.header?.enabled;
        const footerEnabled = !!opts.footer?.enabled;
        const headerTemplate = headerEnabled
          ? buildHeaderFooterTemplate(opts.header.template || '<span class="title"></span>', sourcePath, opts.margins)
          : '<span></span>';
        const footerTemplate = footerEnabled
          ? buildHeaderFooterTemplate(opts.footer.template || '{pageNumber} / {totalPages}', sourcePath, opts.margins)
          : '<span></span>';

        const pdf = await page.pdf({
          format: opts.format,
          landscape: opts.landscape,
          scale: opts.scale,
          margin: opts.margins,
          printBackground: true,
          displayHeaderFooter: headerEnabled || footerEnabled,
          headerTemplate,
          footerTemplate,
          preferCSSPageSize: false,
          timeout: opts.timeout,
        });
        checkCancelled();

        writeFileAtomic(outputPath, pdf);
        return warnings;
      } catch (err) {
        if (token?.isCancellationRequested) { throw new ConversionCancelled(); }
        throw err;
      } finally {
        cancelSub?.dispose();
      }
    });
  } finally {
    try { fs.unlinkSync(tmpHtml); } catch { /* best effort */ }
  }
}
