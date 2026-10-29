/**
 * Internal PDF viewer (custom editor for *.pdf).
 *
 * Renders pages with pdf.js into a scrollable webview with a toolbar (page
 * navigation, zoom, fit-width/page, save, print, open externally), a selectable
 * text layer (Ctrl+F find), clickable links (internal destinations such as the
 * generated table of contents, and external URLs), keyboard navigation, lazy page
 * rendering, a strict CSP, and auto-refresh — keeping the current page and zoom —
 * when the underlying file changes (e.g. after a re-export).
 */

import * as vscode from 'vscode';
import * as path from 'path';

/** Serialize a value for embedding in an inline <script> (quotes and `</script>` safe). */
function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

export class PdfViewerProvider implements vscode.CustomReadonlyEditorProvider {
  public static readonly viewType = 'md-to-pdf.viewer';

  constructor(private readonly _extensionUri: vscode.Uri) { }

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new PdfViewerProvider(context.extensionUri);
    return vscode.window.registerCustomEditorProvider(
      PdfViewerProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
          enableFindWidget: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => { } };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    // The PDF bytes are read here and posted to the webview, so only the bundled
    // pdf.js assets need to be loadable — this works for any file system scheme.
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out', 'pdfjs')],
    };

    webviewPanel.webview.html = this._getHtmlForWebview(webviewPanel.webview);

    let disposed = false;
    const sendPdf = async (keepPosition: boolean) => {
      try {
        const data = await vscode.workspace.fs.readFile(document.uri);
        if (!disposed) {
          await webviewPanel.webview.postMessage({ type: 'load', data, keepPosition });
        }
      } catch (err) {
        if (!disposed) {
          await webviewPanel.webview.postMessage({
            type: 'loadError',
            message: err instanceof Error ? err.message : String(err),
            keepPosition,
          });
        }
      }
    };

    // Auto-refresh when the file changes on disk (e.g. after re-exporting).
    // Writes arrive as bursts of events, so reloads are debounced.
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(document.uri, '..'), path.posix.basename(document.uri.path))
    );
    let reloadTimer: NodeJS.Timeout | undefined;
    const reload = () => {
      if (reloadTimer) { clearTimeout(reloadTimer); }
      reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        sendPdf(true);
      }, 300);
    };
    watcher.onDidChange(reload);
    watcher.onDidCreate(reload);

    const msgSub = webviewPanel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        sendPdf(false);
      } else if (msg?.type === 'retry') {
        sendPdf(true);
      } else {
        this._handleMessage(msg, document.uri);
      }
    });

    webviewPanel.onDidDispose(() => {
      disposed = true;
      if (reloadTimer) { clearTimeout(reloadTimer); }
      watcher.dispose();
      msgSub.dispose();
    });
  }

  private async _handleMessage(msg: any, pdfUri: vscode.Uri): Promise<void> {
    switch (msg?.type) {
      case 'openExternal':
        await vscode.env.openExternal(pdfUri);
        break;
      case 'openLink': {
        const url = String(msg.url ?? '');
        if (/^(https?|mailto):/i.test(url)) {
          await vscode.env.openExternal(vscode.Uri.parse(url));
        } else if (/^file:/i.test(url)) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(url));
        }
        break;
      }
      case 'reveal':
        await vscode.commands.executeCommand('revealFileInOS', pdfUri);
        break;
      case 'download': {
        const name = path.posix.basename(pdfUri.path).replace(/\.pdf$/i, '');
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.joinPath(pdfUri, '..', `${name}-copy.pdf`),
          filters: { PDF: ['pdf'] },
          saveLabel: 'Save a copy',
        });
        if (target) {
          try {
            await vscode.workspace.fs.copy(pdfUri, target, { overwrite: true });
            vscode.window.showInformationMessage(`Saved a copy to ${target.fsPath}`);
          } catch (err) {
            vscode.window.showErrorMessage(
              `Could not save a copy: ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }
        break;
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cspSource = webview.cspSource;
    const asset = (...p: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'pdfjs', ...p)).toString();

    const pdfJsPath = asset('pdf.min.mjs');
    const pdfWorkerPath = asset('pdf.worker.min.mjs');
    const viewerCss = asset('pdf_viewer.css');
    const cMapUrl = `${asset('cmaps')}/`;
    const standardFontDataUrl = `${asset('standard_fonts')}/`;
    const wasmUrl = `${asset('wasm')}/`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} blob: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src ${cspSource} blob:; connect-src ${cspSource} blob: data:; font-src ${cspSource} blob: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeAttr(viewerCss)}">
  <title>PDF Viewer</title>
  <style>
    html, body { height: 100%; margin: 0; padding: 0; }
    body { display: flex; flex-direction: column; background: #525659; }
    #toolbar {
      flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
      padding: 6px 10px; color: #ddd;
      background: var(--vscode-editorWidget-background, #333);
      border-bottom: 1px solid rgba(0,0,0,0.4);
      font-family: var(--vscode-font-family, sans-serif); font-size: 12px;
      flex-wrap: wrap;
    }
    #toolbar button {
      background: rgba(255,255,255,0.08); color: inherit;
      border: 1px solid rgba(255,255,255,0.15); border-radius: 4px;
      padding: 3px 8px; cursor: pointer; font-size: 12px;
    }
    #toolbar button:hover { background: rgba(255,255,255,0.18); }
    #toolbar input { width: 42px; text-align: center; background: rgba(0,0,0,0.3);
      color: inherit; border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; padding: 2px; }
    #toolbar .sep { width: 1px; height: 18px; background: rgba(255,255,255,0.2); margin: 0 4px; }
    #toolbar .spacer { flex: 1 1 auto; }
    #zoomLevel { min-width: 44px; text-align: center; }
    #scroll { flex: 1 1 auto; overflow: auto; padding: 20px; outline: none; position: relative; }
    #pages { display: flex; flex-direction: column; align-items: center; gap: 18px; }
    /* pdf.js sizes text layers with these variables (normally set by its own viewer). */
    .page-wrap {
      position: relative; background: white; box-shadow: 0 4px 10px rgba(0,0,0,0.4);
      --scale-factor: 1; --user-unit: 1;
      --total-scale-factor: calc(var(--scale-factor) * var(--user-unit));
      --scale-round-x: 1px; --scale-round-y: 1px;
    }
    .page-wrap canvas { display: block; }
    .link-layer { position: absolute; inset: 0; z-index: 3; pointer-events: none; }
    .link-layer a { position: absolute; display: block; pointer-events: auto; cursor: pointer; }
    .link-layer a:hover { background: rgba(255, 213, 0, 0.18); outline: 1px solid rgba(255, 180, 0, 0.5); }
    #loading, #error { color: #eee; text-align: center; padding: 40px; font-family: sans-serif; }
    #error { color: #ff8a80; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="prev" title="Previous page (Page Up)">▲</button>
    <input id="pageNum" type="text" value="1" inputmode="numeric"> / <span id="pageCount">?</span>
    <button id="next" title="Next page (Page Down)">▼</button>
    <span class="sep"></span>
    <button id="zoomOut" title="Zoom out (Ctrl+-)">−</button>
    <span id="zoomLevel">100%</span>
    <button id="zoomIn" title="Zoom in (Ctrl+=)">+</button>
    <button id="fitWidth" title="Fit width (Ctrl+0)">↔ Width</button>
    <button id="fitPage" title="Fit page">⤢ Page</button>
    <span class="spacer"></span>
    <button id="download" title="Save a copy">⤓ Save</button>
    <button id="print" title="Print (opens in the system PDF viewer)">🖨 Print</button>
    <button id="openExternal" title="Open in default app">↗ Open</button>
  </div>
  <div id="scroll" tabindex="0">
    <div id="loading">Loading PDF…</div>
    <div id="error" style="display:none"></div>
    <div id="pages"></div>
  </div>
  <script type="module" nonce="${nonce}">
    import * as pdfjsLib from ${toScriptLiteral(pdfJsPath)};
    pdfjsLib.GlobalWorkerOptions.workerSrc = ${toScriptLiteral(pdfWorkerPath)};

    const DOC_OPTIONS = {
      cMapUrl: ${toScriptLiteral(cMapUrl)},
      cMapPacked: true,
      standardFontDataUrl: ${toScriptLiteral(standardFontDataUrl)},
      wasmUrl: ${toScriptLiteral(wasmUrl)},
      isEvalSupported: false,
    };
    // Largest canvas (in device pixels) per page, like pdf.js' own viewer; above
    // this the page is rendered at a lower resolution instead of exhausting memory.
    const MAX_CANVAS_PIXELS = 16777216;
    // Reloads (e.g. while a re-export replaces the file) are retried quietly this often.
    const MAX_RELOAD_RETRIES = 3;
    const scrollEl = document.getElementById('scroll');
    const pagesEl = document.getElementById('pages');
    const loadingEl = document.getElementById('loading');
    const errorEl = document.getElementById('error');
    const pageNumEl = document.getElementById('pageNum');
    const pageCountEl = document.getElementById('pageCount');
    const zoomLevelEl = document.getElementById('zoomLevel');
    const vscode = acquireVsCodeApi();

    let pdfDoc = null;
    let scale = 1;
    let baseViewports = [];   // unscaled (scale 1) viewports per page
    let wrappers = [];        // .page-wrap per page
    let renderedScale = [];   // scale a page was last rendered at (0 = not rendered)
    let renderTasks = [];     // in-flight { scale, task, textLayer } per page
    let currentPage = 1;
    let loadToken = 0;
    let reloadRetries = 0;

    // 'width' | 'page' | null (manual zoom). The active fit is re-applied when
    // the panel is resized; manual zoom sticks until a fit button is pressed.
    let fitMode = 'width';

    function cancelRender(i) {
      const r = renderTasks[i];
      if (!r) return;
      try { r.task && r.task.cancel(); } catch (_) {}
      try { r.textLayer && r.textLayer.cancel(); } catch (_) {}
      renderTasks[i] = null;
    }

    function cancelRenders() {
      for (let i = 0; i < renderTasks.length; i++) cancelRender(i);
      renderTasks = [];
    }

    function showError(message) {
      loadingEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.textContent = 'Error loading PDF:\\n' + message;
    }

    /** A load or reload failed. Reloads of a shown document are retried quietly first. */
    function loadFailed(message, keepPosition) {
      if (keepPosition && pdfDoc && reloadRetries < MAX_RELOAD_RETRIES) {
        reloadRetries++;
        setTimeout(() => vscode.postMessage({ type: 'retry' }), 300);
        return;
      }
      reloadRetries = 0;
      showError(message);
    }

    async function loadPdf(data, keepPosition) {
      const token = ++loadToken;
      const previous = keepPosition && pdfDoc
        ? { page: currentPage, offset: pageOffsetRatio(currentPage), scale, fitMode }
        : null;
      try {
        if (!previous) { loadingEl.style.display = 'block'; }

        const pdf = await pdfjsLib.getDocument({ data, ...DOC_OPTIONS }).promise;
        if (token !== loadToken) { pdf.destroy(); return; }

        const pages = await Promise.all(
          Array.from({ length: pdf.numPages }, (_, k) => pdf.getPage(k + 1))
        );
        if (token !== loadToken) { pdf.destroy(); return; }
        const viewports = [];
        pages.forEach((page, k) => { viewports[k + 1] = page.getViewport({ scale: 1 }); });

        // Swap in the new document only once it is fully ready (no flash, no duplicates).
        cancelRenders();
        if (pdfDoc) { pdfDoc.destroy(); }
        pdfDoc = pdf;
        reloadRetries = 0;
        errorEl.style.display = 'none';
        baseViewports = viewports;
        wrappers = []; renderedScale = [];
        pagesEl.innerHTML = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const wrap = document.createElement('div');
          wrap.className = 'page-wrap';
          wrap.dataset.page = i;
          pagesEl.appendChild(wrap);
          wrappers[i] = wrap;
          renderedScale[i] = 0;
        }
        pageCountEl.textContent = pdf.numPages;
        loadingEl.style.display = 'none';

        if (previous) {
          fitMode = previous.fitMode;
          const target = fitMode ? fitScaleFor(fitMode) : null;
          applyScale(target || previous.scale);
          const pageNo = Math.min(previous.page, pdf.numPages);
          scrollToPage(pageNo, previous.offset, false);
        } else {
          fitWidth();
        }
        observeVisibility();
      } catch (err) {
        if (token !== loadToken) return;
        loadFailed(err && err.message ? err.message : String(err), keepPosition);
      }
    }

    function applyLayout() {
      for (let i = 1; i < wrappers.length; i++) {
        const vp = baseViewports[i];
        if (!vp) continue;
        wrappers[i].style.width = Math.floor(vp.width * scale) + 'px';
        wrappers[i].style.height = Math.floor(vp.height * scale) + 'px';
        wrappers[i].style.setProperty('--scale-factor', String(scale));
      }
      zoomLevelEl.textContent = Math.round(scale * 100) + '%';
    }

    /** Clickable overlays for link annotations (internal destinations and URLs). */
    async function renderLinks(page, viewport, wrap) {
      const annotations = await page.getAnnotations({ intent: 'display' });
      const layer = document.createElement('div');
      layer.className = 'link-layer';
      for (const a of annotations) {
        if (a.subtype !== 'Link' || !a.rect) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
        const el = document.createElement('a');
        el.style.left = Math.min(x1, x2) + 'px';
        el.style.top = Math.min(y1, y2) + 'px';
        el.style.width = Math.abs(x2 - x1) + 'px';
        el.style.height = Math.abs(y2 - y1) + 'px';
        if (a.url || a.unsafeUrl) {
          const url = a.url || a.unsafeUrl;
          el.title = url;
          el.addEventListener('click', (e) => { e.preventDefault(); vscode.postMessage({ type: 'openLink', url }); });
        } else if (a.dest) {
          el.title = 'Go to ' + (typeof a.dest === 'string' ? '#' + a.dest : 'destination');
          el.addEventListener('click', (e) => { e.preventDefault(); goToDestination(a.dest); });
        } else {
          continue;
        }
        layer.appendChild(el);
      }
      if (layer.childElementCount) wrap.appendChild(layer);
    }

    async function goToDestination(dest) {
      if (!pdfDoc) return;
      try {
        const explicit = typeof dest === 'string' ? await pdfDoc.getDestination(dest) : dest;
        if (!Array.isArray(explicit)) return;
        const ref = explicit[0];
        const pageIndex = typeof ref === 'object' && ref !== null
          ? await pdfDoc.getPageIndex(ref)
          : Number(ref);
        const pageNo = pageIndex + 1;
        const vp = baseViewports[pageNo];
        let offset = 0;
        // [ref, {name: 'XYZ'}, left, top, zoom] — top is in PDF units from the bottom.
        if (vp && explicit[1] && explicit[1].name === 'XYZ' && typeof explicit[3] === 'number') {
          const [, y] = vp.convertToViewportPoint(0, explicit[3]);
          offset = Math.max(0, y / vp.height);
        }
        scrollToPage(pageNo, offset, true);
      } catch (e) {
        console.error('Could not resolve destination', dest, e);
      }
    }

    async function renderPage(i) {
      if (!pdfDoc || renderedScale[i] === scale) return;
      if (renderTasks[i] && renderTasks[i].scale === scale) return; // already in flight
      cancelRender(i);
      const doc = pdfDoc;
      const state = { scale, task: null, textLayer: null };
      renderTasks[i] = state;
      const stale = () => renderTasks[i] !== state || pdfDoc !== doc;

      try {
        const page = await doc.getPage(i);
        if (stale()) return;
        const viewport = page.getViewport({ scale: state.scale });
        const wrap = wrappers[i];
        if (!wrap) return;

        // Read the pixel ratio per render so moving between monitors stays sharp,
        // and cap the canvas size so high zoom cannot exhaust memory.
        let outputScale = window.devicePixelRatio || 1;
        const area = viewport.width * viewport.height;
        if (area * outputScale * outputScale > MAX_CANVAS_PIXELS) {
          outputScale = Math.sqrt(MAX_CANVAS_PIXELS / area);
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        // Fill the wrapper, so after a zoom the old canvas stretches until the re-render lands.
        canvas.style.width = '100%';
        canvas.style.height = '100%';

        const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
        state.task = page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport, transform });
        await state.task.promise;
        if (stale()) return;

        // Selectable / searchable text layer.
        const textDiv = document.createElement('div');
        textDiv.className = 'textLayer';
        state.textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport,
        });
        await state.textLayer.render();
        if (stale()) return;

        releaseCanvases(wrap);
        wrap.replaceChildren(canvas, textDiv);
        await renderLinks(page, viewport, wrap);
        if (stale()) return;
        renderedScale[i] = state.scale;
      } catch (err) {
        if (!err || err.name !== 'RenderingCancelledException') console.error('Render failed', err);
      } finally {
        if (renderTasks[i] === state) renderTasks[i] = null;
      }
    }

    /** Free canvas backing stores immediately (detached canvases are collected lazily). */
    function releaseCanvases(wrap) {
      for (const c of wrap.querySelectorAll('canvas')) { c.width = 0; c.height = 0; }
    }

    /** Drop a far-away page's canvas and text layer; it re-renders when it comes back. */
    function releasePage(i) {
      const wrap = wrappers[i];
      if (!wrap || (!renderedScale[i] && !renderTasks[i])) return;
      cancelRender(i);
      releaseCanvases(wrap);
      wrap.replaceChildren();
      renderedScale[i] = 0;
    }

    let renderObserver = null;
    let keepObserver = null;
    function observeVisibility() {
      if (renderObserver) renderObserver.disconnect();
      if (keepObserver) keepObserver.disconnect();
      renderObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) renderPage(Number(entry.target.dataset.page));
        }
      }, { root: scrollEl, rootMargin: '600px 0px', threshold: 0 });
      // Pages several screens away are released so long documents stay light.
      keepObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) releasePage(Number(entry.target.dataset.page));
        }
      }, { root: scrollEl, rootMargin: '300% 0px', threshold: 0 });
      for (let i = 1; i < wrappers.length; i++) {
        renderObserver.observe(wrappers[i]);
        keepObserver.observe(wrappers[i]);
      }
    }

    /** The current page is the one covering a line 30% down the viewport. */
    let scrollRaf = 0;
    scrollEl.addEventListener('scroll', () => {
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = 0;
        const y = scrollEl.scrollTop + scrollEl.clientHeight * 0.3;
        for (let i = 1; i < wrappers.length; i++) {
          if (wrappers[i].offsetTop + wrappers[i].offsetHeight > y) { setCurrentPage(i); break; }
        }
      });
    });

    function setCurrentPage(i) {
      currentPage = i;
      if (document.activeElement !== pageNumEl) pageNumEl.value = i;
    }

    function renderVisible() {
      const top = scrollEl.scrollTop, bottom = top + scrollEl.clientHeight;
      for (let i = 1; i < wrappers.length; i++) {
        const w = wrappers[i];
        if (w.offsetTop < bottom + 600 && w.offsetTop + w.offsetHeight > top - 600) {
          renderPage(i);
        }
      }
    }

    /** Fraction (0..1) of page i scrolled past the top of the viewport. */
    function pageOffsetRatio(i) {
      const w = wrappers[i];
      if (!w || !w.offsetHeight) return 0;
      return Math.min(1, Math.max(0, (scrollEl.scrollTop - (w.offsetTop)) / w.offsetHeight));
    }

    function scrollToPage(i, offsetRatio, smooth) {
      if (!pdfDoc) return;
      i = Math.min(pdfDoc.numPages, Math.max(1, i));
      const w = wrappers[i];
      if (!w) return;
      const top = w.offsetTop + (offsetRatio || 0) * w.offsetHeight;
      scrollEl.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
      setCurrentPage(i);
      renderVisible();
    }

    /** Change zoom while keeping the same spot of the document in view. */
    function applyScale(s) {
      const anchorPage = currentPage;
      const anchorOffset = pageOffsetRatio(anchorPage);
      scale = Math.min(5, Math.max(0.2, s));
      for (let i = 1; i < renderedScale.length; i++) renderedScale[i] = 0;
      applyLayout();
      if (wrappers[anchorPage]) {
        const w = wrappers[anchorPage];
        scrollEl.scrollTop = w.offsetTop + anchorOffset * w.offsetHeight;
      }
      renderVisible();
    }

    function setScale(s, mode = null) {
      fitMode = mode;
      applyScale(s);
    }
    /** Scale that fits page 1 to the panel, or null while the panel has no size (hidden). */
    function fitScaleFor(mode) {
      const vp = baseViewports[1];
      if (!vp || scrollEl.clientWidth <= 56 || scrollEl.clientHeight <= 56) return null;
      const w = (scrollEl.clientWidth - 56) / vp.width;
      return mode === 'page' ? Math.min(w, (scrollEl.clientHeight - 56) / vp.height) : w;
    }
    // While hidden the current scale is kept; the resize observer fits once the panel has a size.
    function fitWidth() {
      setScale(fitScaleFor('width') || scale, 'width');
    }
    function fitPage() {
      setScale(fitScaleFor('page') || scale, 'page');
    }

    let resizeTimer = null;
    new ResizeObserver(() => {
      if (!pdfDoc || !fitMode) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const target = fitScaleFor(fitMode);
        if (target && Math.abs(target - scale) > 0.005) setScale(target, fitMode);
      }, 150);
    }).observe(scrollEl);

    // Re-render at the new resolution when the window moves to a display with another scale factor.
    function watchPixelRatio() {
      const query = matchMedia('(resolution: ' + (window.devicePixelRatio || 1) + 'dppx)');
      query.addEventListener('change', () => {
        for (let i = 1; i < renderedScale.length; i++) renderedScale[i] = 0;
        renderVisible();
        watchPixelRatio();
      }, { once: true });
    }
    watchPixelRatio();

    document.getElementById('prev').onclick = () => scrollToPage(currentPage - 1, 0, true);
    document.getElementById('next').onclick = () => scrollToPage(currentPage + 1, 0, true);
    document.getElementById('zoomIn').onclick = () => setScale(scale * 1.2);
    document.getElementById('zoomOut').onclick = () => setScale(scale / 1.2);
    document.getElementById('fitWidth').onclick = fitWidth;
    document.getElementById('fitPage').onclick = fitPage;
    document.getElementById('download').onclick = () => vscode.postMessage({ type: 'download' });
    // window.print() is a no-op inside VS Code webviews — hand off to the
    // system PDF viewer, which has a working print dialog.
    document.getElementById('print').onclick = () => vscode.postMessage({ type: 'openExternal' });
    document.getElementById('openExternal').onclick = () => vscode.postMessage({ type: 'openExternal' });
    pageNumEl.addEventListener('change', () => scrollToPage(parseInt(pageNumEl.value, 10) || 1, 0, true));
    scrollEl.addEventListener('wheel', (e) => {
      if (e.ctrlKey) { e.preventDefault(); setScale(scale * (e.deltaY < 0 ? 1.1 : 0.9)); }
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (!pdfDoc || e.target === pageNumEl) return;
      const mod = e.ctrlKey || e.metaKey;
      let handled = true;
      if (mod && (e.key === '=' || e.key === '+')) setScale(scale * 1.2);
      else if (mod && e.key === '-') setScale(scale / 1.2);
      else if (mod && e.key === '0') fitWidth();
      else if (!mod && e.key === 'PageDown') scrollToPage(currentPage + 1, 0, false);
      else if (!mod && e.key === 'PageUp') scrollToPage(pageOffsetRatio(currentPage) > 0.02 ? currentPage : currentPage - 1, 0, false);
      else if (!mod && e.key === 'Home') scrollToPage(1, 0, false);
      else if (!mod && e.key === 'End') scrollToPage(pdfDoc.numPages, 0, false);
      else handled = false;
      if (handled) e.preventDefault();
    });

    // The extension reads the file and posts its bytes: on start-up ('ready') and
    // whenever the file changes on disk (keepPosition), e.g. after a re-export.
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg) return;
      if (msg.type === 'load') {
        loadPdf(msg.data, !!msg.keepPosition);
      } else if (msg.type === 'loadError') {
        loadFailed(msg.message, !!msg.keepPosition);
      }
    });

    vscode.postMessage({ type: 'ready' });
    scrollEl.focus();
  </script>
</body>
</html>`;
  }
}
