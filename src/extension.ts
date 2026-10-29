/**
 * Advanced MD to PDF
 * VS Code extension to convert Markdown files to PDF
 *
 * @license MIT
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

import { closeBrowser, configureBrowser } from './browser';
import { ThemeName } from './markdown';
import { PAGE_FORMATS } from './page';
import { PdfViewerProvider } from './pdfViewer';
import { PreviewPanel, PreviewPanelSerializer, isMarkdownDocument } from './preview';
import {
  getConfig,
  getOutputChannel,
  log,
  renderFileToPdf,
  resolveOutputPath,
  resolveOutputDirectory,
  resetCustomCssWarnings,
  exportWithProgress,
  ConversionCancelled,
  ConversionOverrides,
  PageFormat,
} from './convert';

// ============================================
// Helpers
// ============================================

function isMarkdownPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.md' || ext === '.markdown';
}

/** Save the open (dirty) document for a file so the export matches what the user sees. */
async function saveIfDirty(fileUri: vscode.Uri): Promise<void> {
  const target = fileUri.toString();
  const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === target);
  if (doc?.isDirty) {
    await doc.save();
  }
}

/**
 * Resolve the target markdown file from a command argument or the active editor,
 * saving unsaved changes first so the export matches what the user sees.
 */
async function resolveTargetFile(uri?: vscode.Uri): Promise<string | undefined> {
  let fileUri = uri instanceof vscode.Uri ? uri : undefined;
  if (!fileUri) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('No Markdown file is open');
      return undefined;
    }
    fileUri = editor.document.uri;
  }
  if (fileUri.scheme === 'untitled') {
    vscode.window.showErrorMessage('Save the file before converting it to PDF.');
    return undefined;
  }
  if (fileUri.scheme !== 'file') {
    vscode.window.showErrorMessage(
      `MD to PDF can only convert files on disk (this document uses the "${fileUri.scheme}" scheme).`
    );
    return undefined;
  }
  const filePath = fileUri.fsPath;
  if (!isMarkdownPath(filePath)) {
    vscode.window.showErrorMessage('This command only works with Markdown (.md / .markdown) files');
    return undefined;
  }
  await saveIfDirty(fileUri);
  return filePath;
}

/**
 * Optional quick pick (gated by md-to-pdf.askOptionsOnConvert) letting the user
 * choose theme / page size / orientation for a single conversion. Pressing
 * Escape at any step cancels the whole export (returns undefined); the explicit
 * "Keep configured …" item is the way to skip a step.
 */
async function pickOverrides(
  config: vscode.WorkspaceConfiguration
): Promise<ConversionOverrides | undefined> {
  const overrides: ConversionOverrides = {};
  if (!config.get<boolean>('askOptionsOnConvert', false)) {
    return overrides;
  }

  const theme = await vscode.window.showQuickPick(
    [
      { label: 'Keep configured theme', value: undefined },
      { label: 'GitHub Light', value: 'github-light' },
      { label: 'GitHub Dark', value: 'github-dark' },
      { label: 'Academic', value: 'academic' },
    ],
    { placeHolder: 'Theme for this export (Esc to cancel)', title: 'MD to PDF — Theme' }
  );
  if (!theme) { return undefined; }
  if (theme.value) { overrides.theme = theme.value as ThemeName; }

  const format = await vscode.window.showQuickPick(
    ['Keep configured size', ...PAGE_FORMATS],
    { placeHolder: 'Page size for this export (Esc to cancel)', title: 'MD to PDF — Page size' }
  );
  if (!format) { return undefined; }
  if (format !== 'Keep configured size') { overrides.format = format as PageFormat; }

  const orientation = await vscode.window.showQuickPick(
    ['Keep configured orientation', 'Portrait', 'Landscape'],
    { placeHolder: 'Orientation for this export (Esc to cancel)', title: 'MD to PDF — Orientation' }
  );
  if (!orientation) { return undefined; }
  if (orientation === 'Portrait') { overrides.landscape = false; }
  else if (orientation === 'Landscape') { overrides.landscape = true; }

  return overrides;
}

/**
 * Convert several files with one cancellable progress notification, then show a
 * summary. Failures are logged to the output channel instead of interrupting.
 */
async function convertMany(files: string[], extensionPath: string, revealDir: string): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Converting ${files.length} Markdown file(s) to PDF...`,
      cancellable: true,
    },
    async (progress, token) => {
      let done = 0;
      let failed = 0;
      let warned = 0;
      const increment = 100 / files.length;
      for (const [index, file] of files.entries()) {
        if (token.isCancellationRequested) { break; }
        progress.report({ message: `${index + 1}/${files.length} ${path.basename(file)}` });
        try {
          await saveIfDirty(vscode.Uri.file(file));
          const { pdfPath, warnings } = await renderFileToPdf(file, extensionPath, undefined, undefined, token);
          log(`Converted ${file} → ${pdfPath}`);
          for (const w of warnings) { log(`${path.basename(file)}: ${w}`); }
          if (warnings.length) { warned++; }
          done++;
        } catch (error) {
          if (error instanceof ConversionCancelled) { break; }
          failed++;
          const message = error instanceof Error ? error.message : String(error);
          log(`Failed to convert ${file}: ${message}`);
        }
        progress.report({ increment });
      }

      const cancelled = token.isCancellationRequested ? ' (cancelled)' : '';
      const summary =
        `Converted ${done} of ${files.length} file(s)${cancelled}` +
        (failed ? `, ${failed} failed` : '') +
        (warned ? `, ${warned} with warnings` : '');
      const actions: string[] = [];
      if (done > 0) { actions.push('Open Folder'); }
      if (failed > 0 || warned > 0) { actions.push('Show Log'); }
      const show = failed || warned
        ? vscode.window.showWarningMessage(`⚠️ ${summary}`, ...actions)
        : vscode.window.showInformationMessage(`✅ ${summary}`, ...actions);
      show.then(async (action) => {
        if (action === 'Open Folder') {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(revealDir));
        } else if (action === 'Show Log') {
          getOutputChannel().show();
        }
      }, console.error);
    }
  );
}

// ============================================
// Commands
// ============================================

function makeConvertCommand(extensionPath: string) {
  return async function convertMarkdownToPdf(uri?: vscode.Uri, selected?: vscode.Uri[]): Promise<void> {
    // Explorer multi-select passes (clicked uri, all selected uris).
    const markdown = (Array.isArray(selected) ? selected : [])
      .filter((u) => u.scheme === 'file' && isMarkdownPath(u.fsPath))
      .map((u) => u.fsPath);
    if (markdown.length > 1) {
      const files = [...new Set(markdown)].sort();
      const outDir = resolveOutputDirectory(files[0], getConfig(files[0])) ?? path.dirname(files[0]);
      await convertMany(files, extensionPath, outDir);
      return;
    }

    const filePath = await resolveTargetFile(uri);
    if (!filePath) { return; }
    const overrides = await pickOverrides(getConfig(filePath));
    if (!overrides) { return; }
    await exportWithProgress(filePath, extensionPath, overrides);
  };
}

function makeExportAsCommand(extensionPath: string) {
  return async function exportAs(uri?: vscode.Uri): Promise<void> {
    const filePath = await resolveTargetFile(uri);
    if (!filePath) { return; }

    const config = getConfig(filePath);
    const overrides = await pickOverrides(config);
    if (!overrides) { return; }
    const defaultPath = resolveOutputPath(filePath, config);
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(defaultPath),
      filters: { PDF: ['pdf'] },
      saveLabel: 'Export PDF',
    });
    if (!target) { return; }

    await exportWithProgress(filePath, extensionPath, overrides, target.fsPath);
  };
}

function makePreviewCommand(extensionUri: vscode.Uri, extensionPath: string) {
  return async function openPreview(uri?: vscode.Uri): Promise<void> {
    let document: vscode.TextDocument | undefined;
    if (uri instanceof vscode.Uri) {
      document = await vscode.workspace.openTextDocument(uri);
    } else {
      document = vscode.window.activeTextEditor?.document;
    }
    if (!document || !isMarkdownDocument(document)) {
      vscode.window.showErrorMessage('Open a Markdown (.md / .markdown) file to preview it.');
      return;
    }
    // Relative images and links need the file's folder, so untitled buffers can't be previewed.
    if (document.uri.scheme === 'untitled') {
      vscode.window.showErrorMessage('Save the file before opening the PDF preview.');
      return;
    }
    PreviewPanel.createOrShow(extensionUri, extensionPath, document);
  };
}

/** Recursively (or shallowly) collect markdown files within a folder. */
function collectMarkdownFiles(dir: string, recursive: boolean, skipDir?: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        recursive &&
        entry.name !== 'node_modules' &&
        !entry.name.startsWith('.') &&
        !(skipDir && path.relative(skipDir, full) === '')
      ) {
        out.push(...collectMarkdownFiles(full, recursive, skipDir));
      }
    } else if (entry.isFile() && isMarkdownPath(entry.name)) {
      out.push(full);
    }
  }
  return out.sort();
}

async function pickWorkspaceFolder(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 1) { return folders[0].uri.fsPath; }
  if (folders.length > 1) {
    const folder = await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Folder to convert' });
    return folder?.uri.fsPath;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    openLabel: 'Convert Folder',
  });
  return picked?.[0]?.fsPath;
}

function makeConvertFolderCommand(extensionPath: string) {
  return async function convertFolder(uri?: vscode.Uri): Promise<void> {
    const folderPath = uri instanceof vscode.Uri ? uri.fsPath : await pickWorkspaceFolder();
    if (!folderPath) { return; }
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      vscode.window.showErrorMessage('No folder selected to convert');
      return;
    }

    const config = getConfig(folderPath);
    const recursive = config.get<boolean>('convertFolder.recursive', false);
    // Don't descend into the configured output directory when recursing.
    const probe = path.join(folderPath, 'probe.md');
    const outDir = resolveOutputDirectory(probe, config);
    const files = collectMarkdownFiles(folderPath, recursive, outDir);

    if (files.length === 0) {
      vscode.window.showInformationMessage('No Markdown files found in the selected folder');
      return;
    }

    await convertMany(files, extensionPath, outDir ?? folderPath);
  };
}

// ============================================
// Status Bar
// ============================================

let statusBarItem: vscode.StatusBarItem;

function updateStatusBar(editor: vscode.TextEditor | undefined): void {
  if (editor && isMarkdownPath(editor.document.uri.fsPath)) {
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
  const extensionUri = context.extensionUri;

  const applyBrowserConfig = () =>
    configureBrowser({
      browserPath: getConfig().get<string>('browserPath', ''),
      downloadDir: context.globalStorageUri.fsPath,
      onWarning: (message) => {
        log(message);
        vscode.window.showWarningMessage(message);
      },
    });
  applyBrowserConfig();

  context.subscriptions.push(
    getOutputChannel(),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('md-to-pdf.customCss')) {
        resetCustomCssWarnings();
      }
      // Pick up browser setting changes without requiring a reload: reconfigure and
      // drop the live instance so the next conversion relaunches with the new path.
      if (e.affectsConfiguration('md-to-pdf.browserPath')) {
        applyBrowserConfig();
        closeBrowser().catch(console.error);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('md-to-pdf.convert', makeConvertCommand(extensionPath)),
    vscode.commands.registerCommand('md-to-pdf.exportAs', makeExportAsCommand(extensionPath)),
    vscode.commands.registerCommand('md-to-pdf.preview', makePreviewCommand(extensionUri, extensionPath)),
    vscode.commands.registerCommand('md-to-pdf.convertFolder', makeConvertFolderCommand(extensionPath))
  );

  context.subscriptions.push(PdfViewerProvider.register(context));

  // Restore live preview panels across window reloads.
  context.subscriptions.push(
    vscode.window.registerWebviewPanelSerializer(
      PreviewPanel.viewType,
      new PreviewPanelSerializer(extensionUri, extensionPath)
    )
  );

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'md-to-pdf.convert';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateStatusBar),
    // Fires when a document's language changes too (it is reopened), so the PDF
    // button appears when e.g. a plaintext file is switched to Markdown.
    vscode.workspace.onDidOpenTextDocument(() => updateStatusBar(vscode.window.activeTextEditor))
  );
  updateStatusBar(vscode.window.activeTextEditor);
}

export function deactivate(): Promise<void> {
  return closeBrowser();
}
