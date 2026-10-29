/**
 * Theme-aware CSS generation for PDF rendering.
 *
 * getStyles(opts) assembles: theme variables + base CSS + syntax highlighting +
 * overflow handling + font overrides + (optional) KaTeX CSS + user custom CSS.
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
import type { RenderOptions, ThemeName, FontOptions } from './markdown';

// ============================================
// Theme variable blocks
// ============================================

const THEME_VARS: Record<ThemeName, string> = {
  'github-light': `
:root {
  --color-fg-default: #24292f;
  --color-fg-muted: #57606a;
  --color-fg-subtle: #6e7781;
  --color-canvas-default: #ffffff;
  --color-canvas-subtle: #f6f8fa;
  --color-border-default: #d0d7de;
  --color-border-muted: #d8dee4;
  --color-accent-fg: #0969da;
  --color-neutral-muted: rgba(175, 184, 193, 0.2);
  --color-mark-bg: #fff8c5;
  --color-note: #0969da;
  --color-tip: #1a7f37;
  --color-warning: #9a6700;
  --color-severe: #bc4c00;
  --color-caution: #d1242f;
  --color-important: #8250df;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --font-family-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --body-font-size: 14px;
}`,
  'github-dark': `
:root {
  --color-fg-default: #c9d1d9;
  --color-fg-muted: #8b949e;
  --color-fg-subtle: #6e7681;
  --color-canvas-default: #0d1117;
  --color-canvas-subtle: #161b22;
  --color-border-default: #30363d;
  --color-border-muted: #21262d;
  --color-accent-fg: #58a6ff;
  --color-neutral-muted: rgba(110, 118, 129, 0.4);
  --color-mark-bg: rgba(187, 128, 9, 0.25);
  --color-note: #1f6feb;
  --color-tip: #238636;
  --color-warning: #9e6a03;
  --color-severe: #db6d28;
  --color-caution: #f85149;
  --color-important: #8957e5;
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  --font-family-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --body-font-size: 14px;
}`,
  'academic': `
:root {
  --color-fg-default: #1a1a1a;
  --color-fg-muted: #555555;
  --color-fg-subtle: #777777;
  --color-canvas-default: #ffffff;
  --color-canvas-subtle: #f4f4f4;
  --color-border-default: #cccccc;
  --color-border-muted: #dddddd;
  --color-accent-fg: #00529b;
  --color-neutral-muted: rgba(0, 0, 0, 0.06);
  --color-mark-bg: #fff3b0;
  --color-note: #00529b;
  --color-tip: #1a7f37;
  --color-warning: #9a6700;
  --color-severe: #bc4c00;
  --color-caution: #c0392b;
  --color-important: #6a3d9a;
  --font-family: Georgia, "Times New Roman", "Liberation Serif", serif;
  --font-family-mono: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  --body-font-size: 12pt;
}`,
};

/**
 * Page (paper) colour per theme. Chrome leaves the page-margin area unpainted
 * unless @page has a background, which printed dark themes with white borders.
 * Custom properties do not reach the @page context, so literal colours are used.
 */
const PAGE_BACKGROUND: Record<ThemeName, string> = {
  'github-light': '#ffffff',
  'github-dark': '#0d1117',
  'academic': '#ffffff',
};

// ============================================
// Base CSS (theme-agnostic, uses the variables above)
// ============================================

const BASE_CSS = `
* { box-sizing: border-box; }

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}

body {
  font-family: var(--font-family);
  font-size: var(--body-font-size);
  line-height: 1.5;
  color: var(--color-fg-default);
  background-color: var(--color-canvas-default);
  word-wrap: break-word;
  max-width: 100%;
  margin: 0;
  padding: 0;
}

.theme-academic p { text-align: justify; }

/* Headings */
h1, h2, h3, h4, h5, h6 {
  margin-top: 24px;
  margin-bottom: 16px;
  font-weight: 600;
  line-height: 1.25;
  color: var(--color-fg-default);
}
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--color-border-muted); }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--color-border-muted); }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }
h5 { font-size: 0.875em; }
h6 { font-size: 0.85em; color: var(--color-fg-muted); }
h1:first-child, h2:first-child, h3:first-child { margin-top: 0; }

/* Text */
p { margin-top: 0; margin-bottom: 16px; }
b, strong { font-weight: 600; }
a { color: var(--color-accent-fg); text-decoration: none; }
a:hover { text-decoration: underline; }
.print-url { color: var(--color-fg-muted); font-size: 0.85em; word-break: break-all; }

sub, sup { font-size: 75%; line-height: 0; }
mark { background-color: var(--color-mark-bg); color: inherit; padding: 0.1em 0.2em; border-radius: 3px; }
abbr[title] { text-decoration: underline dotted; cursor: help; }

/* Lists */
ul, ol { margin-top: 0; margin-bottom: 16px; padding-left: 2em; }
ul ul, ul ol, ol ul, ol ol { margin-top: 0; margin-bottom: 0; }
li { margin-top: 0.25em; }
li > p { margin-top: 16px; }
li + li { margin-top: 0.25em; }

.task-list-item { list-style-type: none; margin-left: -1.5em; }
.task-list-item input[type="checkbox"] { margin-right: 0.5em; vertical-align: middle; }
ul:has(.task-list-item) { list-style: none; padding-left: 1em; }

/* Definition lists */
dl { padding: 0; }
dt { font-weight: 600; font-style: italic; margin-top: 16px; }
dd { margin-bottom: 8px; margin-left: 0; padding-left: 16px; }

/* Blockquotes */
blockquote {
  margin: 0 0 16px 0;
  padding: 0 1em;
  color: var(--color-fg-muted);
  border-left: 0.25em solid var(--color-border-default);
}
blockquote > :first-child { margin-top: 0; }
blockquote > :last-child { margin-bottom: 0; }

/* Code */
code, tt {
  font-family: var(--font-family-mono);
  font-size: 85%;
  padding: 0.2em 0.4em;
  margin: 0;
  background-color: var(--color-neutral-muted);
  border-radius: 6px;
  white-space: break-spaces;
}
pre {
  margin-top: 0;
  margin-bottom: 16px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.45;
  background-color: var(--color-canvas-subtle);
  border-radius: 6px;
}
pre code {
  display: block;
  padding: 0;
  margin: 0;
  line-height: inherit;
  background-color: transparent;
  border: 0;
  font-size: 100%;
  white-space: pre;
  tab-size: 4;
  -moz-tab-size: 4;
  font-variant-ligatures: none;
}

/* Collapsible details */
details {
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  padding: 0.5em 1em;
  margin-bottom: 16px;
}
summary {
  cursor: pointer;
  font-weight: 600;
  margin: -0.5em -1em;
  padding: 0.5em 1em;
}
details[open] > summary {
  border-bottom: 1px solid var(--color-border-muted);
  margin-bottom: 0.5em;
}
details > :last-child { margin-bottom: 0; }

/* GitHub-style alerts */
.markdown-alert {
  padding: 0.5rem 1rem;
  margin-bottom: 16px;
  color: inherit;
  border-left: 0.25em solid var(--color-border-default);
}
.markdown-alert > :first-child { margin-top: 0; }
.markdown-alert > :last-child { margin-bottom: 0; }
.markdown-alert .markdown-alert-title {
  display: flex;
  font-weight: 600;
  align-items: center;
  line-height: 1;
  margin-bottom: 0.5rem;
}
.markdown-alert .markdown-alert-title .octicon {
  margin-right: 0.5rem;
  display: inline-block;
  overflow: visible !important;
  vertical-align: text-bottom;
  fill: currentColor;
}
.markdown-alert-note { border-left-color: var(--color-note); }
.markdown-alert-note .markdown-alert-title { color: var(--color-note); }
.markdown-alert-tip { border-left-color: var(--color-tip); }
.markdown-alert-tip .markdown-alert-title { color: var(--color-tip); }
.markdown-alert-important { border-left-color: var(--color-important); }
.markdown-alert-important .markdown-alert-title { color: var(--color-important); }
.markdown-alert-warning { border-left-color: var(--color-warning); }
.markdown-alert-warning .markdown-alert-title { color: var(--color-warning); }
.markdown-alert-caution { border-left-color: var(--color-caution); }
.markdown-alert-caution .markdown-alert-title { color: var(--color-caution); }

/* Tables */
table {
  display: table;
  width: 100%;
  max-width: 100%;
  border-spacing: 0;
  border-collapse: collapse;
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 13px;
}
table th { font-weight: 600; padding: 6px 13px; border: 1px solid var(--color-border-default); background-color: var(--color-canvas-subtle); }
table td { padding: 6px 13px; border: 1px solid var(--color-border-default); }
table tr { background-color: var(--color-canvas-default); border-top: 1px solid var(--color-border-muted); }
table tr:nth-child(2n) { background-color: var(--color-canvas-subtle); }

/* Other */
hr { height: 0.25em; padding: 0; margin: 24px 0; background-color: var(--color-border-default); border: 0; }
img { max-width: 100%; box-sizing: content-box; background-color: var(--color-canvas-default); }
kbd {
  display: inline-block;
  padding: 3px 5px;
  font-family: var(--font-family-mono);
  font-size: 11px;
  line-height: 10px;
  color: var(--color-fg-default);
  vertical-align: middle;
  background-color: var(--color-canvas-subtle);
  border: solid 1px var(--color-border-default);
  border-radius: 6px;
  box-shadow: inset 0 -1px 0 var(--color-border-default);
}

/* Footnotes */
.footnotes { font-size: 0.85em; color: var(--color-fg-muted); border-top: 1px solid var(--color-border-muted); margin-top: 32px; }
.footnotes ol { padding-left: 1.5em; }

/* Manual page breaks: <!-- pagebreak --> or a pagebreak/newpage command line */
.page-break { break-after: page; page-break-after: always; height: 0; margin: 0; border: 0; }

/* Math: keep wide display equations inside the page */
.katex-display { max-width: 100%; overflow-x: auto; overflow-y: hidden; }

/* Mermaid */
.mermaid { background: transparent; text-align: center; margin-bottom: 16px; page-break-inside: avoid; }
.mermaid svg { max-width: 100%; height: auto; }

/* Print / PDF optimization */
@media print {
  body { max-width: none !important; padding: 0 !important; }
  pre, blockquote, img, .mermaid, .katex-display { page-break-inside: avoid; }
  /* Tables may span pages (avoiding breaks inside a long table leaves a big
     blank gap); keep rows whole and repeat the header on every page. */
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .katex-display { overflow: visible; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; page-break-inside: avoid; }
}
`;

// ============================================
// Syntax highlighting (theme-specific palettes)
// ============================================

const HLJS_LIGHT = `
.hljs { background: var(--color-canvas-subtle); color: var(--color-fg-default); }
.hljs-doctag, .hljs-keyword, .hljs-meta .hljs-keyword, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-variable.language_ { color: #cf222e; }
.hljs-title, .hljs-title.class_, .hljs-title.class_.inherited__, .hljs-title.function_ { color: #8250df; }
.hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-variable { color: #0550ae; }
.hljs-meta .hljs-string, .hljs-regexp, .hljs-string { color: #0a3069; }
.hljs-built_in, .hljs-symbol { color: #e36209; }
.hljs-code, .hljs-comment, .hljs-formula { color: #6e7781; }
.hljs-name, .hljs-quote, .hljs-selector-pseudo, .hljs-selector-tag { color: #116329; }
.hljs-subst { color: var(--color-fg-default); }
.hljs-section { color: #0550ae; font-weight: bold; }
.hljs-bullet { color: #953800; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
.hljs-addition { color: #116329; background-color: #dafbe1; }
.hljs-deletion { color: #82071e; background-color: #ffebe9; }
`;

const HLJS_DARK = `
.hljs { background: var(--color-canvas-subtle); color: var(--color-fg-default); }
.hljs-doctag, .hljs-keyword, .hljs-meta .hljs-keyword, .hljs-template-tag, .hljs-template-variable, .hljs-type, .hljs-variable.language_ { color: #ff7b72; }
.hljs-title, .hljs-title.class_, .hljs-title.class_.inherited__, .hljs-title.function_ { color: #d2a8ff; }
.hljs-attr, .hljs-attribute, .hljs-literal, .hljs-meta, .hljs-number, .hljs-operator, .hljs-selector-attr, .hljs-selector-class, .hljs-selector-id, .hljs-variable { color: #79c0ff; }
.hljs-meta .hljs-string, .hljs-regexp, .hljs-string { color: #a5d6ff; }
.hljs-built_in, .hljs-symbol { color: #ffa657; }
.hljs-code, .hljs-comment, .hljs-formula { color: #8b949e; }
.hljs-name, .hljs-quote, .hljs-selector-pseudo, .hljs-selector-tag { color: #7ee787; }
.hljs-subst { color: var(--color-fg-default); }
.hljs-section { color: #1f6feb; font-weight: bold; }
.hljs-bullet { color: #f2cc60; }
.hljs-emphasis { font-style: italic; }
.hljs-strong { font-weight: bold; }
.hljs-addition { color: #aff5b4; background-color: #033a16; }
.hljs-deletion { color: #ffdcd7; background-color: #67060c; }
`;

// ============================================
// Dynamic CSS fragments
// ============================================

function getOverflowCss(opts: RenderOptions): string {
  let css = `
/* Break long unbroken strings (URLs, hashes) so they stay within the page. */
a, code { overflow-wrap: anywhere; }
td, th, li, p, dd, dt { overflow-wrap: break-word; }
`;

  if (opts.codeWrap) {
    css += `
pre, pre code, pre.hljs code { white-space: pre-wrap !important; overflow-wrap: anywhere; word-break: break-word; }
pre { page-break-inside: auto; }
`;
  } else {
    css += `
pre { overflow: hidden; }
`;
  }

  if (opts.tablesWide === 'wrap') {
    css += `
table { table-layout: fixed; }
table th, table td { overflow-wrap: anywhere; word-break: break-word; }
`;
  } else {
    // shrink
    css += `
table { font-size: 11px; }
table th, table td { padding: 4px 8px; }
`;
  }

  return css;
}

function getFontCss(fonts: FontOptions): string {
  if (!fonts) { return ''; }
  const decls: string[] = [];
  if (fonts.body) { decls.push(`--font-family: ${fonts.body};`); }
  if (fonts.mono) { decls.push(`--font-family-mono: ${fonts.mono};`); }
  if (fonts.size) { decls.push(`--body-font-size: ${fonts.size};`); }
  return decls.length ? `:root { ${decls.join(' ')} }` : '';
}

/**
 * Read bundled KaTeX CSS and rewrite relative font URLs to a target-appropriate
 * base (`file://` for PDF generation, a webview URI for the live preview).
 */
function getKatexCss(opts: RenderOptions): string {
  try {
    const cssPath = path.join(opts.extensionPath, 'out', 'katex', 'katex.min.css');
    const raw = fs.readFileSync(cssPath, 'utf-8');
    const fontsDir = path.join(opts.extensionPath, 'out', 'katex', 'fonts');
    const fontsUrl =
      opts.assetMode === 'webview' && opts.toAssetUri
        ? opts.toAssetUri(fontsDir)
        : pathToFileURL(fontsDir).href;
    return raw.replace(/url\(fonts\//g, `url(${fontsUrl}/`);
  } catch (__) {
    return '';
  }
}

// ============================================
// Public entry point
// ============================================

export function getStyles(opts: RenderOptions): string {
  const themeVars = THEME_VARS[opts.theme] || THEME_VARS['github-light'];
  const hljs = opts.theme === 'github-dark' ? HLJS_DARK : HLJS_LIGHT;
  const katex = opts.math ? getKatexCss(opts) : '';

  const pageBg = PAGE_BACKGROUND[opts.theme] || PAGE_BACKGROUND['github-light'];

  return [
    themeVars,
    `@page { background: ${pageBg}; }`,
    BASE_CSS,
    hljs,
    getOverflowCss(opts),
    getFontCss(opts.fonts),
    katex,
    opts.customCss || '',
  ].join('\n');
}
