/**
 * Advanced MD to PDF
 * VS Code extension to convert Markdown files to PDF
 *
 * @license MIT
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { getBrowser, closeBrowser, configureBrowser } from './browser';
import { renderMarkdownToHtml, RenderOptions, FontOptions, ThemeName, WideTableMode } from './markdown';
import { PdfViewerProvider } from './pdfViewer';

// ============================================
// Types
// ============================================

interface PdfMargins {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

type PageFormat = 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'A6' | 'Tabloid';

interface HeaderFooterConfig {
  enabled?: boolean;
  template?: string;
}

interface PdfOptions {
  format: PageFormat;
  margins: PdfMargins;
  landscape: boolean;
  scale: number;
  timeout: number;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  expandDetails: boolean;
  mermaidTheme: string;
}

// ============================================
// Configuration
// ============================================

const DEFAULT_MARGINS: PdfMargins = {
  top: '15mm',
  right: '15mm',
  bottom: '15mm',
  left: '15mm',
};

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('md-to-pdf');
}

/** Resolve the custom CSS path (relative to the first workspace folder) and read it. */
function readCustomCss(config: vscode.WorkspaceConfiguration): string {
  const cssPath = config.get<string>('customCss', '').trim();
  if (!cssPath) { return ''; }

  let resolved = cssPath;
  if (!path.isAbsolute(cssPath)) {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) { resolved = path.join(folder, cssPath); }
  }

  try {
    return fs.readFileSync(resolved, 'utf-8');
  } catch {
    vscode.window.showWarningMessage(`MD to PDF: could not read custom CSS at ${resolved}`);
    return '';
  }
}

/** Build the markdown RenderOptions from configuration. */
function getRenderOptions(
  config: vscode.WorkspaceConfiguration,
  extensionPath: string,
  basePath: string
): RenderOptions {
  return {
    extensionPath,
    basePath,
    theme: config.get<ThemeName>('theme', 'github-light'),
    fonts: config.get<FontOptions>('fonts', {}),
    customCss: readCustomCss(config),
    math: config.get<boolean>('math.enabled', true),
    mermaid: config.get<boolean>('mermaid.enabled', true),
    toc: config.get<boolean>('toc.enabled', true),
    emoji: config.get<boolean>('emoji', true),
    alerts: config.get<boolean>('alerts.enabled', true),
    extraSyntax: config.get<boolean>('extraSyntax', true),
    footnotes: true,
    embedImages: config.get<boolean>('embedImages', true),
    linkRenderUrls: config.get<boolean>('linkRenderUrls', false),
    codeWrap: config.get<boolean>('codeBlocks.wordWrap', true),
    tablesWide: config.get<WideTableMode>('tables.wide', 'wrap'),
  };
}

/** Build the PDF options from configuration. */
function getPdfOptions(config: vscode.WorkspaceConfiguration, theme: ThemeName): PdfOptions {
  let mermaidTheme = config.get<string>('mermaid.theme', 'auto');
  if (mermaidTheme === 'auto') {
    mermaidTheme = theme === 'github-dark' ? 'dark' : 'default';
  }

  return {
    format: config.get<PageFormat>('pageFormat', 'A4'),
    margins: config.get<PdfMargins>('margins', DEFAULT_MARGINS),
    landscape: config.get<boolean>('landscape', false),
    scale: config.get<number>('scale', 1),
    timeout: config.get<number>('timeout', 120000),
    header: config.get<HeaderFooterConfig>('header', { enabled: false }),
    footer: config.get<HeaderFooterConfig>('footer', { enabled: false }),
    expandDetails: config.get<boolean>('expandDetails', true),
    mermaidTheme,
  };
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
 * tokens) into the HTML Chrome expects for header/footer, wrapped with sensible styling.
 */
function buildHeaderFooterTemplate(template: string, filePath: string): string {
  const html = template
    .replace(/\{title\}/g, '<span class="title"></span>')
    .replace(/\{date\}/g, '<span class="date"></span>')
    .replace(/\{pageNumber\}/g, '<span class="pageNumber"></span>')
    .replace(/\{totalPages\}/g, '<span class="totalPages"></span>')
    .replace(/\{filePath\}/g, escapeHtml(filePath));

  return `<div style="font-size:9px; width:100%; padding:0 15mm; color:#888; -webkit-print-color-adjust:exact;">${html}</div>`;
}

// ============================================
// PDF Conversion
// ============================================

/**
 * Render an HTML string to a PDF file via headless Chrome.
 * The HTML is written to a temporary file and loaded over file:// so that
 * mermaid's ES-module imports (and any other module scripts) resolve correctly.
 */
async function convertHtmlToPdf(
  htmlContent: string,
  outputPath: string,
  sourcePath: string,
  hasMermaid: boolean,
  extensionPath: string,
  opts: PdfOptions
): Promise<void> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Apply the configured timeout to ALL operations (navigation, evaluate, and
  // crucially page.pdf), not just navigation. A value of 0 disables the limit,
  // which is what very large documents (tens of thousands of lines) need —
  // otherwise Puppeteer's built-in 30s protocol timeout aborts page.pdf().
  page.setDefaultTimeout(opts.timeout);
  page.setDefaultNavigationTimeout(opts.timeout);

  const tmpHtml = path.join(os.tmpdir(), `md-to-pdf-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);

  try {
    fs.writeFileSync(tmpHtml, htmlContent, 'utf-8');

    await page.goto(`file://${tmpHtml.replace(/\\/g, '/')}`, {
      waitUntil: 'networkidle0',
      timeout: opts.timeout,
    });

    // Render mermaid diagrams client-side before producing the PDF.
    if (hasMermaid) {
      const mermaidUrl = `file://${path
        .join(extensionPath, 'out', 'mermaid', 'mermaid.esm.min.mjs')
        .replace(/\\/g, '/')}`;
      try {
        await page.evaluate(async (url: string, theme: string) => {
          const mod: any = await import(/* webpackIgnore: true */ url);
          const mermaid = mod.default || mod;
          mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'loose' });
          await mermaid.run({ querySelector: '.mermaid' });
        }, mermaidUrl, opts.mermaidTheme);
        // Give the layout/fonts a beat to settle.
        await new Promise((r) => setTimeout(r, 150));
      } catch (err) {
        console.error('Mermaid rendering failed:', err);
      }
    }

    // Expand collapsible <details> so their content is not hidden in the PDF.
    if (opts.expandDetails) {
      await page.evaluate(() => {
        document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true));
      });
    }

    const headerEnabled = !!opts.header?.enabled;
    const footerEnabled = !!opts.footer?.enabled;

    const headerTemplate = headerEnabled
      ? buildHeaderFooterTemplate(opts.header.template || '<span class="title"></span>', sourcePath)
      : '<span></span>';
    const footerTemplate = footerEnabled
      ? buildHeaderFooterTemplate(opts.footer.template || '{pageNumber} / {totalPages}', sourcePath)
      : '<span></span>';

    await page.pdf({
      path: outputPath,
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
  } finally {
    await page.close();
    try { fs.unlinkSync(tmpHtml); } catch { /* best effort */ }
  }
}

/**
 * Determine the output PDF path for a given markdown file, honoring
 * outputDirectory and onFileExists settings.
 */
function resolveOutputPath(filePath: string, config: vscode.WorkspaceConfiguration): string {
  const baseDir = path.dirname(filePath);
  const name = path.basename(filePath, path.extname(filePath));

  const outputDirSetting = config.get<string>('outputDirectory', '').trim();
  let outDir = baseDir;
  if (outputDirSetting) {
    outDir = path.isAbsolute(outputDirSetting)
      ? outputDirSetting
      : path.join(baseDir, outputDirSetting);
    fs.mkdirSync(outDir, { recursive: true });
  }

  let pdfPath = path.join(outDir, `${name}.pdf`);

  if (fs.existsSync(pdfPath) && config.get<string>('onFileExists', 'overwrite') === 'newFile') {
    let counter = 1;
    while (fs.existsSync(pdfPath)) {
      pdfPath = path.join(outDir, `${name}-${counter}.pdf`);
      counter++;
    }
  }

  return pdfPath;
}

/**
 * Core: render a single markdown file to a PDF and return the output path.
 */
async function renderFileToPdf(
  filePath: string,
  config: vscode.WorkspaceConfiguration,
  extensionPath: string
): Promise<string> {
  const basePath = path.dirname(filePath);
  const title = path.basename(filePath, path.extname(filePath));

  const renderOpts = getRenderOptions(config, extensionPath, basePath);
  const pdfOpts = getPdfOptions(config, renderOpts.theme);

  const markdownContent = fs.readFileSync(filePath, 'utf-8');
  const { html, hasMermaid } = renderMarkdownToHtml(markdownContent, title, renderOpts);

  const pdfPath = resolveOutputPath(filePath, config);
  await convertHtmlToPdf(html, pdfPath, filePath, hasMermaid, extensionPath, pdfOpts);

  return pdfPath;
}

function openPdf(pdfPath: string, viewer: string): Thenable<unknown> {
  if (viewer === 'internal') {
    return vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(pdfPath), PdfViewerProvider.viewType);
  }
  return vscode.env.openExternal(vscode.Uri.file(pdfPath));
}

// ============================================
// Commands
// ============================================

function makeConvertCommand(extensionPath: string) {
  return async function convertMarkdownToPdf(uri?: vscode.Uri): Promise<void> {
    let fileUri = uri;
    if (!fileUri) {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No Markdown file is open');
        return;
      }
      fileUri = editor.document.uri;
    }

    const filePath = fileUri.fsPath;
    if (!filePath.toLowerCase().endsWith('.md')) {
      vscode.window.showErrorMessage('This command only works with Markdown (.md) files');
      return;
    }

    const config = getConfig();
    const fileName = path.basename(filePath);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Converting ${fileName} to PDF...`,
        cancellable: false,
      },
      async () => {
        const startTime = Date.now();
        try {
          const pdfPath = await renderFileToPdf(filePath, config, extensionPath);
          const duration = Date.now() - startTime;
          const viewer = config.get<string>('viewer', 'internal');
          const openAfterConversion = config.get<boolean>('openAfterConversion', true);

          const action = await vscode.window.showInformationMessage(
            `✅ ${path.basename(pdfPath)} created in ${duration}ms`,
            'Open PDF',
            'Reveal in Folder'
          );

          if (action === 'Open PDF') {
            await openPdf(pdfPath, viewer);
          } else if (action === 'Reveal in Folder') {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pdfPath));
          } else if (openAfterConversion) {
            await openPdf(pdfPath, viewer);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Failed to convert: ${message}`);
          console.error('MD to PDF conversion error:', error);
        }
      }
    );
  };
}

/** Recursively (or shallowly) collect markdown files within a folder. */
function collectMarkdownFiles(dir: string, recursive: boolean): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
        out.push(...collectMarkdownFiles(full, recursive));
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function makeConvertFolderCommand(extensionPath: string) {
  return async function convertFolder(uri?: vscode.Uri): Promise<void> {
    let folderPath = uri?.fsPath;
    if (!folderPath) {
      folderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    }
    if (!folderPath || !fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      vscode.window.showErrorMessage('No folder selected to convert');
      return;
    }

    const config = getConfig();
    const recursive = config.get<boolean>('convertFolder.recursive', false);
    const files = collectMarkdownFiles(folderPath, recursive);

    if (files.length === 0) {
      vscode.window.showInformationMessage('No Markdown files found in the selected folder');
      return;
    }

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Converting ${files.length} Markdown file(s) to PDF...`,
        cancellable: true,
      },
      async (progress, token) => {
        let done = 0;
        let failed = 0;
        const increment = 100 / files.length;
        for (const file of files) {
          if (token.isCancellationRequested) { break; }
          progress.report({ increment, message: path.basename(file) });
          try {
            await renderFileToPdf(file, config, extensionPath);
            done++;
          } catch (error) {
            failed++;
            console.error(`Failed to convert ${file}:`, error);
          }
        }
        const summary = `Converted ${done} file(s)` + (failed ? `, ${failed} failed` : '');
        vscode.window.showInformationMessage(`✅ ${summary}`);
      }
    );
  };
}

// ============================================
// Status Bar
// ============================================

let statusBarItem: vscode.StatusBarItem;

function updateStatusBar(editor: vscode.TextEditor | undefined): void {
  if (editor?.document.languageId === 'markdown') {
    statusBarItem.text = '$(file-pdf) PDF';
    statusBarItem.tooltip = 'Convert Markdown to PDF';
    statusBarItem.show();
  } else {
    statusBarItem.hide();
  }
}

// ============================================
// Extension Lifecycle
// ============================================

export function activate(context: vscode.ExtensionContext): void {
  const extensionPath = context.extensionPath;

  configureBrowser({
    browserPath: getConfig().get<string>('browserPath', ''),
    downloadDir: context.globalStorageUri.fsPath,
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('md-to-pdf.convert', makeConvertCommand(extensionPath))
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('md-to-pdf.convertFolder', makeConvertFolderCommand(extensionPath))
  );

  context.subscriptions.push(PdfViewerProvider.register(context));

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'md-to-pdf.convert';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBar));
  updateStatusBar(vscode.window.activeTextEditor);

  console.log('MD to PDF extension activated');
}

export function deactivate(): void {
  closeBrowser().catch(console.error);
}
