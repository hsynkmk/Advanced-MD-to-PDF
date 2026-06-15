/**
 * Copy runtime browser assets (pdf.js, KaTeX, Mermaid) into out/ so they can be
 * loaded offline by the webview / headless Chrome. Cross-platform (no shell cp).
 */
import { cpSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
copyFile(join(nm, 'pdfjs-dist/build/pdf.min.mjs'), join(out, 'pdfjs/pdf.min.mjs'));
copyFile(join(nm, 'pdfjs-dist/build/pdf.worker.min.mjs'), join(out, 'pdfjs/pdf.worker.min.mjs'));

// --- KaTeX (math rendering) ---
copyFile(join(nm, 'katex/dist/katex.min.css'), join(out, 'katex/katex.min.css'));
copyDir(join(nm, 'katex/dist/fonts'), join(out, 'katex/fonts'));

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
