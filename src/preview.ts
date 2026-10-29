/**
 * Live preview panel.
 *
 * Renders a Markdown document through the SAME pipeline used for PDF export
 * (renderMarkdownBody), so what you see matches what you get. The page is sized
 * to the real paper format, orientation, margins and scale, so line wrapping and
 * table widths match the PDF. The webview updates as you type, follows the active
 * Markdown editor, and exposes a toolbar to change theme / page size / orientation
 * for a single export — plus Export to PDF and Export As… buttons.
 */

import * as vscode from 'vscode';
import * as path from 'path';

import { renderMarkdownBody, extractFrontMatterTitle, RenderOptions, ThemeName } from './markdown';
import { PAGE_FORMATS, cssLengthToPx, pageGeometry } from './page';
import {
  getConfig,
  getRenderOptions as buildRenderOptions,
  getPdfOptions,
  frontMatterOverrides,
  mergeOverrides,
  resolveCustomCssPath,
  resolveOutputPath,
  exportWithProgress,
  ConversionOverrides,
  PageFormat,
} from './convert';

const MARKDOWN_LANGUAGES = new Set(['markdown']);

export function isMarkdownDocument(doc: vscode.TextDocument | undefined): boolean {
  if (!doc) { return false; }
  if (MARKDOWN_LANGUAGES.has(doc.languageId)) { return true; }
  const ext = path.extname(doc.uri.fsPath).toLowerCase();
  return ext === '.md' || ext === '.markdown';
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

/** Whether `child` is `parent` or inside it (case-insensitive on Windows). */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export class PreviewPanel {
  public static readonly viewType = 'md-to-pdf.preview';
  private static current: PreviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private readonly extensionPath: string;
  private disposables: vscode.Disposable[] = [];

  private docUri: vscode.Uri;
  private overrides: ConversionOverrides = {};
  private roots: vscode.Uri[] = [];
  private updateTimer: NodeJS.Timeout | undefined;
  private busy = false;

  public static createOrShow(
    extensionUri: vscode.Uri,
    extensionPath: string,
    document: vscode.TextDocument
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;
    const beside = column === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.Beside;

    if (PreviewPanel.current) {
      PreviewPanel.current.panel.reveal(beside, true);
      PreviewPanel.current.setDocument(document);
      return;
    }

    const roots = PreviewPanel.resourceRoots(extensionUri, document.uri);
    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      'PDF Preview',
      { viewColumn: beside, preserveFocus: true },
      {
        enableScripts: true,
        enableFindWidget: true,
        retainContextWhenHidden: true,
        localResourceRoots: roots,
      }
    );

    PreviewPanel.current = new PreviewPanel(panel, extensionUri, extensionPath, document);
  }

  /** Reattach to a panel restored by VS Code after a window reload. */
  public static revive(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    extensionPath: string,
    document: vscode.TextDocument,
    overrides?: ConversionOverrides
  ): void {
    PreviewPanel.current?.panel.dispose();
    PreviewPanel.current = new PreviewPanel(panel, extensionUri, extensionPath, document, overrides);
  }

  private static resourceRoots(extensionUri: vscode.Uri, docUri: vscode.Uri): vscode.Uri[] {
    const roots: vscode.Uri[] = [vscode.Uri.joinPath(extensionUri, 'out')];
    roots.push(vscode.Uri.file(path.dirname(docUri.fsPath)));
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      roots.push(folder.uri);
    }
    const cssPath = resolveCustomCssPath(getConfig(docUri), docUri.fsPath);
    if (cssPath) {
      roots.push(vscode.Uri.file(path.dirname(cssPath)));
    }
    return roots;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    extensionPath: string,
    document: vscode.TextDocument,
    overrides?: ConversionOverrides
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.extensionPath = extensionPath;
    this.docUri = document.uri;
    if (overrides) { this.overrides = { ...overrides }; }

    this.applyWebviewOptions();
    this.panel.webview.html = this.buildHtml();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables
    );

    // Re-render as the tracked document changes (debounced).
    vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === this.docUri.toString()) {
          this.scheduleUpdate();
        }
      },
      null,
      this.disposables
    );

    // Follow the active Markdown editor, like the built-in preview.
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        if (editor && isMarkdownDocument(editor.document) && editor.document.uri.scheme !== 'untitled') {
          this.setDocument(editor.document);
        }
      },
      null,
      this.disposables
    );

    // Re-render when any extension setting changes (theme, fonts, custom CSS, ...).
    vscode.workspace.onDidChangeConfiguration(
      (e) => {
        if (e.affectsConfiguration('md-to-pdf')) {
          if (e.affectsConfiguration('md-to-pdf.customCss')) { this.applyWebviewOptions(); }
          this.update();
        }
      },
      null,
      this.disposables
    );
  }

  /** (Re)apply resource roots for the current document (its folder, workspace, custom CSS folder). */
  private applyWebviewOptions(): void {
    this.roots = PreviewPanel.resourceRoots(this.extensionUri, this.docUri);
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.roots,
    };
  }

  private setDocument(document: vscode.TextDocument): void {
    if (this.docUri.toString() === document.uri.toString()) {
      this.update();
      return;
    }
    this.docUri = document.uri;
    this.applyWebviewOptions();
    this.update(true);
  }

  private scheduleUpdate(): void {
    if (this.updateTimer) { clearTimeout(this.updateTimer); }
    this.updateTimer = setTimeout(() => this.update(), 250);
  }

  private getDocument(): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.docUri.toString()
    );
  }

  /** The previewed document, reopened from disk if its editor was closed. */
  private async loadDocument(): Promise<vscode.TextDocument | undefined> {
    const open = this.getDocument();
    if (open || this.docUri.scheme !== 'file') { return open; }
    try {
      return await vscode.workspace.openTextDocument(this.docUri);
    } catch {
      return undefined; // deleted or renamed
    }
  }

  /** Front matter (`pdf:`) first, then the toolbar choices on top — same layering as the export. */
  private effectiveOverrides(text: string): ConversionOverrides {
    return mergeOverrides(frontMatterOverrides(text), this.overrides);
  }

  /**
   * Build RenderOptions configured for the webview surface. Reuses the exact
   * option assembly of the PDF path (including custom CSS) so preview output
   * cannot drift from what gets exported.
   */
  private getRenderOptions(overrides: ConversionOverrides): RenderOptions {
    const webview = this.panel.webview;
    const toAssetUri = (absPath: string) => webview.asWebviewUri(vscode.Uri.file(absPath)).toString();
    const rootPaths = this.roots.map((r) => r.fsPath);
    return {
      ...buildRenderOptions(getConfig(this.docUri), this.extensionPath, this.docUri.fsPath, overrides, toAssetUri),
      assetMode: 'webview',
      toAssetUri,
      // Images the webview can load directly are referenced, not re-embedded on every keystroke.
      canServe: (absPath: string) => rootPaths.some((root) => isInside(root, absPath)),
    };
  }

  private async update(resetScroll = false): Promise<void> {
    const docUri = this.docUri;
    const doc = await this.loadDocument();
    // Skip if the panel moved on to another document (or closed) meanwhile.
    if (!doc || docUri.toString() !== this.docUri.toString() || PreviewPanel.current !== this) { return; }

    const text = doc.getText();
    const title = extractFrontMatterTitle(text) ?? path.basename(this.docUri.fsPath);
    this.panel.title = `Preview: ${title}`;

    let payload;
    try {
      const config = getConfig(this.docUri);
      const overrides = this.effectiveOverrides(text);
      const opts = this.getRenderOptions(overrides);
      const pdf = getPdfOptions(config, opts.theme, overrides);
      const geometry = pageGeometry(pdf.format, pdf.landscape, pdf.margins, pdf.scale);
      const { content, styles, hasMermaid } = renderMarkdownBody(text, opts);
      payload = {
        type: 'update',
        content,
        styles,
        bodyClass: `theme-${opts.theme}`,
        hasMermaid,
        mermaidTheme: pdf.mermaidTheme,
        resetScroll,
        // Effective values keep the toolbar in sync with settings and front matter.
        toolbar: { theme: opts.theme, format: pdf.format, landscape: pdf.landscape },
        page: {
          width: geometry.pageWidth,
          contentWidth: geometry.contentWidth,
          scale: pdf.scale,
          margins: {
            top: cssLengthToPx(pdf.margins.top),
            right: cssLengthToPx(pdf.margins.right),
            bottom: cssLengthToPx(pdf.margins.bottom),
            left: cssLengthToPx(pdf.margins.left),
          },
        },
        // Persisted by the webview (setState) so the panel survives window reloads.
        state: { doc: this.docUri.toString(), overrides: this.overrides },
      };
    } catch (err) {
      payload = {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
    this.panel.webview.postMessage(payload);
  }

  private async handleMessage(msg: any): Promise<void> {
    switch (msg?.type) {
      case 'ready':
        this.update();
        break;
      case 'setTheme':
        this.overrides.theme = msg.value as ThemeName;
        this.update();
        break;
      case 'setFormat':
        this.overrides.format = msg.value as PageFormat;
        this.update();
        break;
      case 'setOrientation':
        this.overrides.landscape = !!msg.value;
        this.update();
        break;
      case 'export':
        await this.export(false);
        break;
      case 'exportAs':
        await this.export(true);
        break;
      case 'openLink':
        await this.openLink(String(msg.href ?? ''));
        break;
    }
  }

  /** Open a link clicked in the preview: web links externally, local files in VS Code. */
  private async openLink(href: string): Promise<void> {
    if (!href) { return; }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }

    let target: vscode.Uri;
    if (/^file:/i.test(href)) {
      target = vscode.Uri.parse(href);
    } else {
      const [pathPart] = href.split(/[?#]/);
      let decoded = pathPart;
      try { decoded = decodeURIComponent(pathPart); } catch { /* keep raw */ }
      const docDir = path.dirname(this.docUri.fsPath);
      const workspace = vscode.workspace.getWorkspaceFolder(this.docUri)?.uri.fsPath ?? docDir;
      const abs = path.isAbsolute(decoded) && !/^[\\/]/.test(decoded)
        ? decoded
        : decoded.startsWith('/') ? path.join(workspace, decoded) : path.resolve(docDir, decoded);
      target = vscode.Uri.file(abs);
    }

    try {
      if (/\.(md|markdown)$/i.test(target.fsPath)) {
        const doc = await vscode.workspace.openTextDocument(target);
        await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One });
      } else {
        await vscode.commands.executeCommand('vscode.open', target);
      }
    } catch (err) {
      vscode.window.showErrorMessage(
        `MD to PDF: could not open ${target.fsPath}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async export(pickLocation: boolean): Promise<void> {
    if (this.busy) { return; }
    const doc = await this.loadDocument();
    if (!doc) {
      vscode.window.showErrorMessage('MD to PDF: the previewed file no longer exists.');
      return;
    }
    if (this.docUri.scheme !== 'file') {
      vscode.window.showErrorMessage('MD to PDF: save the file to disk before exporting it.');
      return;
    }
    if (doc.isDirty) {
      await doc.save();
    }

    const filePath = this.docUri.fsPath;

    let saveAs: string | undefined;
    if (pickLocation) {
      const defaultPath = resolveOutputPath(filePath, getConfig(this.docUri));
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultPath),
        filters: { PDF: ['pdf'] },
        saveLabel: 'Export PDF',
      });
      if (!target) { return; }
      saveAs = target.fsPath;
    }

    this.busy = true;
    this.panel.webview.postMessage({ type: 'exporting', value: true });
    try {
      await exportWithProgress(filePath, this.extensionPath, this.overrides, saveAs);
    } finally {
      this.busy = false;
      this.panel.webview.postMessage({ type: 'exporting', value: false });
    }
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const nonce = getNonce();
    const cspSource = webview.cspSource;
    const mermaidUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'mermaid', 'mermaid.esm.min.mjs')
    );

    const themeOption = (value: string, label: string) => `<option value="${value}">${label}</option>`;
    const formatOption = (value: string) => `<option value="${value}">${value}</option>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; media-src ${cspSource} https:; style-src ${cspSource} 'unsafe-inline'; font-src ${cspSource} data:; script-src ${cspSource} 'nonce-${nonce}' 'unsafe-eval'; connect-src ${cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PDF Preview</title>
  <style>
    :root { color-scheme: light dark; }
    html, body { height: 100%; margin: 0; padding: 0; }
    body {
      display: flex; flex-direction: column;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
    }
    /* Toolbar/chrome use ID selectors with explicit color so the injected
       document theme CSS (bare body/:root rules) cannot clobber them. */
    #toolbar {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; flex: 0 0 auto;
      background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family); line-height: normal;
      border-bottom: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.35));
      flex-wrap: wrap;
    }
    #toolbar label, #toolbar span { color: var(--vscode-foreground); font-size: 12px; }
    #toolbar label { opacity: 0.85; }
    #toolbar select, #toolbar button {
      font-size: 12px; padding: 3px 8px; border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-input-foreground));
      cursor: pointer;
    }
    #toolbar .spacer { flex: 1 1 auto; }
    #toolbar button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
    }
    #toolbar button:disabled { opacity: 0.5; cursor: default; }
    #scroll { flex: 1 1 auto; overflow: auto; padding: 24px; background: var(--vscode-editor-background); box-sizing: border-box; }
    #page {
      margin: 0 auto;
      /* Follow the document theme's canvas so dark themes stay readable. */
      background: var(--color-canvas-default, #ffffff);
      box-shadow: 0 2px 14px rgba(0,0,0,0.25);
      border-radius: 2px;
      box-sizing: border-box;
      width: 794px; padding: 57px;
    }
    #content { box-sizing: border-box; }
    #status { font-size: 12px; opacity: 0.7; padding: 0 6px; }
    #error {
      display: none; margin: 12px auto; max-width: 880px;
      padding: 12px 16px; border-radius: 6px;
      background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
      border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
      white-space: pre-wrap; font-family: var(--vscode-editor-font-family, monospace);
    }
  </style>
  <style id="doc-styles"></style>
</head>
<body>
  <div id="toolbar">
    <label for="theme">Theme</label>
    <select id="theme">
      ${themeOption('github-light', 'GitHub Light')}
      ${themeOption('github-dark', 'GitHub Dark')}
      ${themeOption('academic', 'Academic')}
    </select>
    <label for="format">Page</label>
    <select id="format">
      ${PAGE_FORMATS.map(formatOption).join('')}
    </select>
    <label><input type="checkbox" id="landscape"> Landscape</label>
    <span id="status"></span>
    <span class="spacer"></span>
    <button id="exportAs">Export As…</button>
    <button id="export" class="primary">⤓ Export to PDF</button>
  </div>
  <div id="scroll">
    <div id="error"></div>
    <div id="page"><div id="content" class="markdown-body"></div></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const MERMAID_URL = ${JSON.stringify(mermaidUri.toString()).replace(/</g, '\\u003c')};
    const docStyles = document.getElementById('doc-styles');
    const scrollEl = document.getElementById('scroll');
    const content = document.getElementById('content');
    const page = document.getElementById('page');
    const errorBox = document.getElementById('error');
    const statusEl = document.getElementById('status');
    const exportBtn = document.getElementById('export');
    const exportAsBtn = document.getElementById('exportAs');
    const themeSel = document.getElementById('theme');
    const formatSel = document.getElementById('format');
    const landscapeBox = document.getElementById('landscape');
    let mermaidMod = null;
    let generation = 0;
    let pageInfo = null;

    async function runMermaid(theme, gen) {
      if (!content.querySelector('pre.mermaid')) { return; }
      try {
        if (!mermaidMod) {
          const mod = await import(MERMAID_URL);
          mermaidMod = mod.default || mod;
        }
        if (gen !== generation) { return; }
        mermaidMod.initialize({ startOnLoad: false, theme, securityLevel: 'strict' });
        const nodes = Array.from(content.querySelectorAll('pre.mermaid'));
        for (const node of nodes) {
          if (gen !== generation) { return; }   // a newer render replaced the content
          try { await mermaidMod.run({ nodes: [node] }); }
          catch (e) { console.error('Mermaid preview failed:', e); }
        }
      } catch (e) {
        console.error('Mermaid preview failed:', e);
      }
    }

    /** Shrink display equations wider than the page, exactly like the PDF export. */
    function fitWideMath() {
      content.querySelectorAll('.katex-display').forEach((el) => {
        el.style.zoom = '';
        const inner = el.firstElementChild;
        if (inner && inner.scrollWidth > el.clientWidth + 1) {
          el.style.zoom = String(el.clientWidth / inner.scrollWidth);
        }
      });
    }

    /** Size the sheet to the real paper and shrink it to fit the panel when needed. */
    function layoutPage() {
      if (!pageInfo) { return; }
      const m = pageInfo.margins;
      page.style.width = pageInfo.width + 'px';
      page.style.padding = m.top + 'px ' + m.right + 'px ' + m.bottom + 'px ' + m.left + 'px';
      content.style.width = pageInfo.contentWidth + 'px';
      content.style.zoom = String(pageInfo.scale || 1);
      const available = scrollEl.clientWidth - 48;
      page.style.zoom = String(Math.min(1, available / pageInfo.width));
    }
    new ResizeObserver(layoutPage).observe(scrollEl);

    // Links: #anchors scroll inside the preview; everything else is opened by the
    // extension (web links externally, relative files in VS Code). Capture phase so
    // the webview host does not navigate the frame first.
    window.addEventListener('click', (e) => {
      const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || !content.contains(a)) { return; }
      const href = a.getAttribute('href') || '';
      e.preventDefault();
      e.stopPropagation();
      if (href.startsWith('#')) {
        const raw = href.slice(1);
        let decoded = raw;
        try { decoded = decodeURIComponent(raw); } catch (_) { /* keep raw */ }
        const target = document.getElementById(raw) || document.getElementById(decoded) ||
          document.getElementsByName(decoded)[0];
        if (target) { target.scrollIntoView({ block: 'start' }); }
        return;
      }
      vscode.postMessage({ type: 'openLink', href });
    }, true);

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type === 'update') {
        const gen = ++generation;
        const scrollTop = scrollEl.scrollTop;
        errorBox.style.display = 'none';
        docStyles.textContent = msg.styles;
        content.className = 'markdown-body ' + msg.bodyClass;
        content.innerHTML = msg.content;
        themeSel.value = msg.toolbar.theme;
        formatSel.value = msg.toolbar.format;
        landscapeBox.checked = msg.toolbar.landscape;
        pageInfo = msg.page;
        layoutPage();
        fitWideMath();
        scrollEl.scrollTop = msg.resetScroll ? 0 : scrollTop;
        if (msg.state) { vscode.setState(msg.state); }
        if (msg.hasMermaid) {
          runMermaid(msg.mermaidTheme, gen).then(() => {
            if (gen === generation && !msg.resetScroll) { scrollEl.scrollTop = scrollTop; }
          });
        }
      } else if (msg.type === 'error') {
        errorBox.style.display = 'block';
        errorBox.textContent = 'Preview error:\\n' + msg.message;
      } else if (msg.type === 'exporting') {
        exportBtn.disabled = msg.value;
        exportAsBtn.disabled = msg.value;
        statusEl.textContent = msg.value ? 'Exporting…' : '';
      }
    });

    themeSel.addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setTheme', value: e.target.value });
    });
    formatSel.addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setFormat', value: e.target.value });
    });
    landscapeBox.addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setOrientation', value: e.target.checked });
    });
    exportBtn.addEventListener('click', () => vscode.postMessage({ type: 'export' }));
    exportAsBtn.addEventListener('click', () => vscode.postMessage({ type: 'exportAs' }));

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    if (PreviewPanel.current === this) { PreviewPanel.current = undefined; }
    if (this.updateTimer) { clearTimeout(this.updateTimer); }
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}

/**
 * Restores the preview panel after a window reload from the state the webview
 * persisted (document uri + toolbar overrides).
 */
export class PreviewPanelSerializer implements vscode.WebviewPanelSerializer {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionPath: string
  ) { }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    const saved = (state ?? {}) as { doc?: string; overrides?: ConversionOverrides };

    let document: vscode.TextDocument | undefined;
    if (typeof saved.doc === 'string') {
      try {
        document = await vscode.workspace.openTextDocument(vscode.Uri.parse(saved.doc, true));
      } catch {
        // File was removed/renamed while the window was closed.
      }
    }
    if (!document) {
      const active = vscode.window.activeTextEditor?.document;
      if (isMarkdownDocument(active)) { document = active; }
    }
    if (!document) {
      panel.dispose();
      return;
    }

    PreviewPanel.revive(panel, this.extensionUri, this.extensionPath, document, saved.overrides);
  }
}
