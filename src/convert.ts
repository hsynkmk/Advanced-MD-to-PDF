/**
 * Conversion core: builds render/PDF options from configuration and renders a
 * Markdown file to a PDF via headless Chrome.
 *
 * Shared by the editor commands and the live preview panel. Options are layered:
 *   settings (resource-scoped)  <  document front matter (`pdf:`)  <  per-export overrides
 * so a single conversion can change theme / page size / orientation without
 * touching the user's settings.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { pathToFileURL } from 'url';

import {
  renderMarkdownToHtml,
  RenderOptions,
  FontOptions,
  ThemeName,
  WideTableMode,
} from './markdown';
import {
  PageFormat,
  PdfMargins,
  DEFAULT_MARGINS,
  normalizeMargins,
} from './page';
import {
  convertHtmlToPdf,
  ConversionCancelled,
  HeaderFooterConfig,
  PdfLockedError,
  PdfOptions,
} from './pdf';
import { ConversionOverrides, frontMatterOverrides, mergeOverrides } from './overrides';
import { PdfViewerProvider } from './pdfViewer';

export { PageFormat, PdfMargins, DEFAULT_MARGINS, PdfOptions, ConversionCancelled, PdfLockedError };
export { ConversionOverrides, frontMatterOverrides, mergeOverrides };

// ============================================
// Types
// ============================================

export interface ConversionResult {
  pdfPath: string;
  /** Non-fatal problems (e.g. Mermaid diagrams that failed to render). */
  warnings: string[];
}

// ============================================
// Logging
// ============================================

let outputChannel: vscode.OutputChannel | undefined;

/** Shared "MD to PDF" output channel (created lazily). */
export function getOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('MD to PDF');
  return outputChannel;
}

export function log(message: string): void {
  getOutputChannel().appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
}

// ============================================
// Configuration
// ============================================

/** Extension settings, scoped to the given file so multi-root folder settings apply. */
export function getConfig(resource?: vscode.Uri | string): vscode.WorkspaceConfiguration {
  const uri = typeof resource === 'string' ? vscode.Uri.file(resource) : resource;
  return vscode.workspace.getConfiguration('md-to-pdf', uri);
}

function workspaceFolderFor(filePath?: string): string | undefined {
  if (filePath) {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (folder) { return folder.uri.fsPath; }
  }
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/**
 * Expand `${workspaceFolder}`, `${fileDirname}`, `${fileBasenameNoExtension}`
 * and a leading `~` in a path setting, then resolve relative paths against
 * `relativeTo` (when given).
 */
export function expandPathVars(value: string, filePath?: string, relativeTo?: string): string {
  let out = value.trim();
  if (!out) { return out; }
  const workspace = workspaceFolderFor(filePath);
  out = out
    .replace(/\$\{workspaceFolder\}/g, workspace ?? (filePath ? path.dirname(filePath) : ''))
    .replace(/\$\{fileDirname\}/g, filePath ? path.dirname(filePath) : '')
    .replace(/\$\{fileBasenameNoExtension\}/g, filePath ? path.basename(filePath, path.extname(filePath)) : '')
    .replace(/\$\{userHome\}/g, os.homedir());
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = path.join(os.homedir(), out.slice(1));
  }
  if (relativeTo && !path.isAbsolute(out)) {
    out = path.join(relativeTo, out);
  }
  return path.normalize(out);
}

const warnedCss = new Set<string>();

/** Forget which missing custom-CSS paths were reported (call when settings change). */
export function resetCustomCssWarnings(): void {
  warnedCss.clear();
}

/** Absolute path of the configured custom CSS file, if any. */
export function resolveCustomCssPath(config: vscode.WorkspaceConfiguration, filePath?: string): string | undefined {
  const cssPath = config.get<string>('customCss', '').trim();
  if (!cssPath) { return undefined; }
  return expandPathVars(cssPath, filePath, workspaceFolderFor(filePath) ?? (filePath ? path.dirname(filePath) : undefined));
}

/**
 * Read the custom CSS file. Relative `url(...)` references inside it (fonts,
 * images) are rewritten against the CSS file's own folder, since the CSS is
 * inlined into a document that lives elsewhere. A missing file is reported once.
 */
export function readCustomCss(
  config: vscode.WorkspaceConfiguration,
  filePath?: string,
  toUrl: (absPath: string) => string = (p) => pathToFileURL(p).href
): string {
  const resolved = resolveCustomCssPath(config, filePath);
  if (!resolved) { return ''; }

  let css: string;
  try {
    css = fs.readFileSync(resolved, 'utf-8');
  } catch {
    if (!warnedCss.has(resolved)) {
      warnedCss.add(resolved);
      vscode.window.showWarningMessage(`MD to PDF: could not read custom CSS at ${resolved}`);
    }
    return '';
  }

  const cssDir = path.dirname(resolved);
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, _q: string, ref: string) => {
    const value = ref.trim();
    if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(value) || path.isAbsolute(value)) { return match; }
    const cut = value.search(/[?#]/);
    const rel = cut >= 0 ? value.slice(0, cut) : value;
    const suffix = cut >= 0 ? value.slice(cut) : '';
    return `url("${toUrl(path.resolve(cssDir, rel))}${suffix}")`;
  });
}


// ============================================
// Option assembly
// ============================================

/** Build the markdown RenderOptions from configuration (plus optional overrides). */
export function getRenderOptions(
  config: vscode.WorkspaceConfiguration,
  extensionPath: string,
  filePath: string,
  overrides?: ConversionOverrides,
  cssUrl?: (absPath: string) => string
): RenderOptions {
  const tocLevels = config.get<number[]>('toc.levels', [1, 2, 3]);
  return {
    extensionPath,
    basePath: path.dirname(filePath),
    rootPath: workspaceFolderFor(filePath),
    theme: overrides?.theme ?? config.get<ThemeName>('theme', 'github-light'),
    fonts: config.get<FontOptions>('fonts', {}),
    customCss: readCustomCss(config, filePath, cssUrl),
    math: config.get<boolean>('math.enabled', true),
    mermaid: config.get<boolean>('mermaid.enabled', true),
    toc: overrides?.toc ?? config.get<boolean>('toc.enabled', true),
    tocLevels: Array.isArray(tocLevels) ? tocLevels.filter((l) => l >= 1 && l <= 6) : undefined,
    emoji: config.get<boolean>('emoji', true),
    alerts: config.get<boolean>('alerts.enabled', true),
    extraSyntax: config.get<boolean>('extraSyntax', true),
    footnotes: true,
    embedImages: config.get<boolean>('embedImages', true),
    linkRenderUrls: config.get<boolean>('linkRenderUrls', false),
    codeWrap: config.get<boolean>('codeBlocks.wordWrap', true),
    tablesWide: config.get<WideTableMode>('tables.wide', 'wrap'),
    expandDetails: config.get<boolean>('expandDetails', true),
  };
}

/** Resolve the Mermaid theme ('auto' follows the document theme). */
export function resolveMermaidTheme(config: vscode.WorkspaceConfiguration, theme: ThemeName): string {
  const configured = config.get<string>('mermaid.theme', 'auto');
  if (configured === 'auto') {
    return theme === 'github-dark' ? 'dark' : theme === 'academic' ? 'neutral' : 'default';
  }
  return configured;
}

/** Build the PDF options from configuration (plus optional overrides). */
export function getPdfOptions(
  config: vscode.WorkspaceConfiguration,
  theme: ThemeName,
  overrides?: ConversionOverrides
): PdfOptions {
  const scale = config.get<number>('scale', 1);
  const timeout = config.get<number>('timeout', 120000);
  return {
    format: overrides?.format ?? config.get<PageFormat>('pageFormat', 'A4'),
    margins: normalizeMargins({ ...config.get<Partial<PdfMargins>>('margins', DEFAULT_MARGINS), ...overrides?.margins }),
    landscape: overrides?.landscape ?? config.get<boolean>('landscape', false),
    scale: Number.isFinite(scale) ? Math.min(2, Math.max(0.1, scale)) : 1,
    timeout: Number.isFinite(timeout) && timeout >= 0 ? timeout : 120000,
    header: config.get<HeaderFooterConfig>('header', { enabled: false }),
    footer: config.get<HeaderFooterConfig>('footer', { enabled: false }),
    mermaidTheme: resolveMermaidTheme(config, theme),
  };
}


/**
 * Determine the output PDF path for a given markdown file, honoring
 * outputDirectory and onFileExists settings. An explicit `saveAs` path
 * (from a Save dialog) short-circuits all of this.
 */
export function resolveOutputPath(
  filePath: string,
  config: vscode.WorkspaceConfiguration,
  saveAs?: string
): string {
  if (saveAs) { return saveAs; }

  const baseDir = path.dirname(filePath);
  const name = path.basename(filePath, path.extname(filePath));
  const outDir = resolveOutputDirectory(filePath, config) ?? baseDir;

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

/** The configured output directory for a file (absolute), or undefined to write next to it. */
export function resolveOutputDirectory(filePath: string, config: vscode.WorkspaceConfiguration): string | undefined {
  const setting = config.get<string>('outputDirectory', '').trim();
  if (!setting) { return undefined; }
  return expandPathVars(setting, filePath, path.dirname(filePath));
}

/**
 * Core: render a single markdown file (as saved on disk) to a PDF.
 */
export async function renderFileToPdf(
  filePath: string,
  extensionPath: string,
  overrides?: ConversionOverrides,
  saveAs?: string,
  token?: vscode.CancellationToken
): Promise<ConversionResult> {
  const config = getConfig(filePath);
  const title = path.basename(filePath, path.extname(filePath));
  const markdownContent = fs.readFileSync(filePath, 'utf-8');

  const effective = mergeOverrides(frontMatterOverrides(markdownContent), overrides);
  const renderOpts = getRenderOptions(config, extensionPath, filePath, effective);
  const pdfOpts = getPdfOptions(config, renderOpts.theme, effective);

  // Only file-based module scripts (the bundled Mermaid) may run; Chrome rejects
  // path-scoped file: sources, so the scheme is the narrowest usable source.
  const { html, hasMermaid } = renderMarkdownToHtml(markdownContent, title, renderOpts, 'file:');

  const pdfPath = resolveOutputPath(filePath, config, saveAs);
  const warnings = await convertHtmlToPdf(html, pdfPath, filePath, hasMermaid, extensionPath, pdfOpts, token);

  return { pdfPath, warnings };
}

function reportWarnings(filePath: string, warnings: string[]): void {
  if (!warnings.length) { return; }
  for (const w of warnings) { log(`${path.basename(filePath)}: ${w}`); }
  vscode.window
    .showWarningMessage(
      `MD to PDF: ${warnings.length} problem(s) while rendering ${path.basename(filePath)} — ${warnings[0]}`,
      'Show Log'
    )
    .then((action) => { if (action === 'Show Log') { getOutputChannel().show(); } }, console.error);
}

/**
 * Run a single-file export with a (cancellable) progress notification, honoring
 * openAfterConversion, then offer follow-up actions.
 *
 * The progress notification ends as soon as the PDF is written; the success
 * toast is fire-and-forget so auto-open never waits on the user dismissing it.
 * Returns the output path, or undefined when the conversion failed or was cancelled.
 */
export async function exportWithProgress(
  filePath: string,
  extensionPath: string,
  overrides?: ConversionOverrides,
  saveAs?: string
): Promise<string | undefined> {
  const config = getConfig(filePath);
  const fileName = path.basename(filePath);

  try {
    const startTime = Date.now();
    const { pdfPath, warnings } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Converting ${fileName} to PDF...`,
        cancellable: true,
      },
      (_progress, token) => renderFileToPdf(filePath, extensionPath, overrides, saveAs, token)
    );
    const duration = Date.now() - startTime;
    log(`Converted ${filePath} → ${pdfPath} in ${duration}ms`);
    reportWarnings(filePath, warnings);

    const viewer = config.get<string>('viewer', 'internal');
    const autoOpen = config.get<boolean>('openAfterConversion', true);
    if (autoOpen) {
      await openPdf(pdfPath, viewer);
    }

    const actions = autoOpen ? ['Reveal in Folder'] : ['Open PDF', 'Reveal in Folder'];
    vscode.window
      .showInformationMessage(`✅ ${path.basename(pdfPath)} created in ${duration}ms`, ...actions)
      .then(async (action) => {
        if (action === 'Open PDF') {
          await openPdf(pdfPath, viewer);
        } else if (action === 'Reveal in Folder') {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(pdfPath));
        }
      }, console.error);

    return pdfPath;
  } catch (error) {
    if (error instanceof ConversionCancelled) {
      log(`Cancelled conversion of ${filePath}`);
      return undefined;
    }
    const message = error instanceof Error ? error.message : String(error);
    log(`Failed to convert ${filePath}: ${message}`);
    console.error('MD to PDF conversion error:', error);

    if (error instanceof PdfLockedError) {
      const action = await vscode.window.showErrorMessage(
        `Failed to convert: ${message} Close it and try again, or save under another name.`,
        'Save As…'
      );
      if (action === 'Save As…') {
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(error.pdfPath.replace(/\.pdf$/i, '-1.pdf')),
          filters: { PDF: ['pdf'] },
          saveLabel: 'Export PDF',
        });
        if (target) {
          return exportWithProgress(filePath, extensionPath, overrides, target.fsPath);
        }
      }
      return undefined;
    }

    vscode.window.showErrorMessage(`Failed to convert: ${message}`, 'Show Log').then((action) => {
      if (action === 'Show Log') { getOutputChannel().show(); }
    }, console.error);
    return undefined;
  }
}

/** Open a generated PDF in the internal viewer or the system default app. */
export function openPdf(pdfPath: string, viewer: string): Thenable<unknown> {
  if (viewer === 'internal') {
    return vscode.commands.executeCommand(
      'vscode.openWith',
      vscode.Uri.file(pdfPath),
      PdfViewerProvider.viewType
    );
  }
  return vscode.env.openExternal(vscode.Uri.file(pdfPath));
}
