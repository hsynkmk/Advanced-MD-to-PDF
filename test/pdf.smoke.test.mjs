/**
 * End-to-end smoke test: renders examples/feature-showcase.md to a real PDF with
 * headless Chrome through the same code the extension uses (out/pdf.js), then
 * inspects the result with pdf.js. Skipped when no local Chrome/Edge is found.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = require(path.join(root, 'out', 'markdown.js'));
const pdf = require(path.join(root, 'out', 'pdf.js'));
const browser = require(path.join(root, 'out', 'browser.js'));
const { DEFAULT_MARGINS } = require(path.join(root, 'out', 'page.js'));

const chrome = browser.findChrome();
const skip = !chrome ? 'no Chrome/Edge found' : !fs.existsSync(path.join(root, 'out', 'mermaid')) ? 'run copy-assets first' : false;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-pdf-smoke-'));
const showcase = path.join(root, 'examples', 'feature-showcase.md');

after(async () => {
  await browser.closeBrowser();
});

function renderOptions(theme) {
  return {
    extensionPath: root,
    basePath: path.dirname(showcase),
    theme,
    fonts: {},
    customCss: '',
    math: true,
    mermaid: true,
    toc: true,
    emoji: true,
    alerts: true,
    extraSyntax: true,
    footnotes: true,
    embedImages: true,
    linkRenderUrls: false,
    codeWrap: true,
    tablesWide: 'wrap',
    expandDetails: true,
  };
}

const pdfOptions = (theme) => ({
  format: 'A4',
  margins: DEFAULT_MARGINS,
  landscape: false,
  scale: 1,
  timeout: 120000,
  header: { enabled: false },
  footer: { enabled: true, template: '{pageNumber} / {totalPages}' },
  mermaidTheme: theme === 'github-dark' ? 'dark' : 'default',
});

async function convert(theme, extra = '') {
  const source = fs.readFileSync(showcase, 'utf-8') + extra;
  const { html, hasMermaid } = md.renderMarkdownToHtml(source, 'showcase', renderOptions(theme), 'file:');
  const out = path.join(tmp, `showcase-${theme}.pdf`);
  const warnings = await pdf.convertHtmlToPdf(html, out, showcase, hasMermaid, root, pdfOptions(theme));
  return { out, warnings, hasMermaid };
}

async function openPdf(file) {
  const pdfjs = await import(pathToFileURL(path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs')).href);
  return pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
}

test('feature showcase converts to a valid PDF with working diagrams and links', { skip, timeout: 180000 }, async () => {
  // Two conversions at once must share one browser launch (no leaked Chrome).
  const [light, dark] = await Promise.all([
    convert('github-light', '\n\n<script>document.body.innerHTML = "INJECTED"</script>\n'),
    convert('github-dark'),
  ]);

  for (const result of [light, dark]) {
    assert.ok(result.hasMermaid, 'showcase contains Mermaid');
    assert.deepEqual(result.warnings, [], 'no Mermaid failures');
    const bytes = fs.readFileSync(result.out);
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.equal(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')).length, 0, 'no temp files left behind');
  }

  const doc = await openPdf(light.out);
  assert.ok(doc.numPages >= 2, `expected several pages, got ${doc.numPages}`);

  let text = '';
  let internalLinks = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    text += (await page.getTextContent()).items.map((it) => it.str).join(' ') + '\n';
    internalLinks += (await page.getAnnotations()).filter((a) => a.subtype === 'Link' && a.dest).length;
  }
  assert.match(text, /Feature Showcase/);
  assert.doesNotMatch(text, /INJECTED/, 'scripts embedded in Markdown must not run');
  assert.doesNotMatch(text, /graph (TD|LR)/, 'Mermaid source should be replaced by a diagram');
  assert.match(text, /1 \/ \d+/, 'footer page numbers');
  assert.ok(internalLinks > 0, 'TOC / anchor links become internal PDF links');
});

test('dark theme paints the page margins', { skip, timeout: 120000 }, async (t) => {
  let createCanvas;
  try {
    ({ createCanvas } = require('@napi-rs/canvas'));
  } catch {
    t.skip('@napi-rs/canvas not installed');
    return;
  }
  const { out } = await convert('github-dark');
  const doc = await openPdf(out);
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 0.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, canvas, viewport }).promise;
  const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data;
  assert.ok(r < 40 && g < 40 && b < 40, `margin pixel should be dark, got ${r},${g},${b}`);
});
