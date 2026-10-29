/**
 * Copy runtime browser assets (pdf.js, KaTeX, Mermaid) into out/ so they can be
 * loaded offline by the webview / headless Chrome. Cross-platform (no shell cp).
 */
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'out');

function copyFile(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

/** Recursively copy a directory, skipping source maps to keep the bundle small. */
function copyDir(from, to, { skipMaps = true } = {}) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !(skipMaps && src.endsWith('.map')),
  });
}

// --- pdf.js (internal viewer) ---
// The legacy build polyfills APIs (e.g. Promise.withResolvers) that the modern
// build assumes but the Chromium in older supported VS Code releases lacks.
copyFile(join(nm, 'pdfjs-dist/legacy/build/pdf.min.mjs'), join(out, 'pdfjs/pdf.min.mjs'));
copyFile(join(nm, 'pdfjs-dist/legacy/build/pdf.worker.min.mjs'), join(out, 'pdfjs/pdf.worker.min.mjs'));
// Text-layer / viewer CSS so PDF text is selectable and searchable.
copyFile(join(nm, 'pdfjs-dist/web/pdf_viewer.css'), join(out, 'pdfjs/pdf_viewer.css'));
// Character maps, standard (non-embedded) fonts and wasm decoders so arbitrary
// PDFs — not just the ones we generate — render correctly.
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
  const src = join(nm, 'pdfjs-dist', dir);
  if (existsSync(src)) { copyDir(src, join(out, 'pdfjs', dir)); }
}

// --- KaTeX (math rendering) ---
// Copy the CSS/fonts of the exact KaTeX build the markdown plugin renders with
// (it may ship its own nested copy); mismatched CSS misplaces glyphs.
const require = createRequire(import.meta.url);
const katexPlugin = require.resolve('@vscode/markdown-it-katex', { paths: [root] });
const katexDist = dirname(require.resolve('katex', { paths: [dirname(katexPlugin)] }));
copyFile(join(katexDist, 'katex.min.css'), join(out, 'katex/katex.min.css'));
copyDir(join(katexDist, 'fonts'), join(out, 'katex/fonts'));

// --- Mermaid (diagram rendering) ---
// ESM bundle with lazily imported chunks; preserve the relative layout so the
// dynamic ./chunks/... imports resolve against the copied entry module.
const mermaidOut = join(out, 'mermaid');
if (existsSync(mermaidOut)) {
  rmSync(mermaidOut, { recursive: true, force: true });
}
copyFile(join(nm, 'mermaid/dist/mermaid.esm.min.mjs'), join(mermaidOut, 'mermaid.esm.min.mjs'));
copyDir(join(nm, 'mermaid/dist/chunks/mermaid.esm.min'), join(mermaidOut, 'chunks/mermaid.esm.min'));

const mermaidChunks = readdirSync(join(mermaidOut, 'chunks/mermaid.esm.min')).length;
console.log(`Assets copied: pdf.js, KaTeX (+fonts), Mermaid (${mermaidChunks} chunks).`);
