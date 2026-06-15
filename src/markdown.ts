/**
 * Markdown parsing: config-driven markdown-it pipeline with syntax highlighting,
 * task lists, GitHub alerts, math, mermaid, footnotes, TOC and extended syntax.
 */

import * as path from 'path';
import * as fs from 'fs';
import type MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import ini from 'highlight.js/lib/languages/ini';
import markdown from 'highlight.js/lib/languages/markdown';

import { getStyles } from './styles';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('java', java);
hljs.registerLanguage('c', c);
hljs.registerLanguage('cpp', cpp);
hljs.registerLanguage('csharp', csharp);
hljs.registerLanguage('go', go);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('ini', ini);
hljs.registerLanguage('markdown', markdown);

// ============================================
// Types
// ============================================

export interface FontOptions {
  body?: string;
  mono?: string;
  size?: string;
}

export type ThemeName = 'github-light' | 'github-dark' | 'academic';
export type WideTableMode = 'wrap' | 'shrink';

export interface RenderOptions {
  /** Absolute path to the extension root (used to locate bundled KaTeX/mermaid assets in out/). */
  extensionPath: string;
  /** Directory of the source markdown file (used to resolve relative images). */
  basePath: string;
  theme: ThemeName;
  fonts: FontOptions;
  /** Already-resolved custom CSS text appended last so it overrides the theme. */
  customCss: string;
  math: boolean;
  mermaid: boolean;
  toc: boolean;
  emoji: boolean;
  alerts: boolean;
  extraSyntax: boolean;
  footnotes: boolean;
  embedImages: boolean;
  linkRenderUrls: boolean;
  codeWrap: boolean;
  tablesWide: WideTableMode;
}

export interface RenderResult {
  html: string;
  /** Whether the output contains mermaid diagrams that still need client-side rendering. */
  hasMermaid: boolean;
}

// ============================================
// Plugin loading helpers
// ============================================

/**
 * Unwrap an ESM/interop default export.
 * NOTE: callers must use literal require('...') strings so esbuild bundles the
 * dependency into the output (dynamic require(variable) is NOT bundled).
 */
function unwrap(mod: any): any {
  return mod && mod.default ? mod.default : mod;
}

/** GitHub-compatible heading slugifier for anchors and internal links. */
function githubSlugify(str: string): string {
  return encodeURIComponent(
    String(str)
      .trim()
      .toLowerCase()
      .replace(/[\s]+/g, '-')
      .replace(/[^\p{L}\p{N}\-_]/gu, '')
  );
}

// ============================================
// Parser construction
// ============================================

/**
 * Build a fresh markdown-it instance configured from the given options.
 * A new instance is created per conversion so settings always take effect
 * (construction is cheap compared to PDF rendering).
 */
export function buildParser(opts: RenderOptions): MarkdownIt {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const MarkdownItCtor = require('markdown-it');

  const md: MarkdownIt = new MarkdownItCtor({
    html: true,
    linkify: true,
    typographer: true,
    breaks: false,
    highlight: function (str: string, lang: string): string {
      // Mermaid: emit a container for client-side rendering, do not highlight.
      if (lang === 'mermaid') {
        return '<pre class="mermaid">' + md.utils.escapeHtml(str) + '</pre>';
      }

      if (lang && hljs.getLanguage(lang)) {
        try {
          return '<pre class="hljs"><code>' +
            hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
            '</code></pre>';
        } catch (__) { /* fall through */ }
      }

      return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    },
  });

  // Strip leading YAML front matter so it does not render as stray text/rules.
  try {
    md.use(unwrap(require('markdown-it-front-matter')), () => { /* ignore */ });
  } catch (__) { /* optional */ }

  // Heading anchors + table of contents (enables working internal links).
  if (opts.toc) {
    md.use(unwrap(require('markdown-it-anchor')), {
      slugify: githubSlugify,
      permalink: false,
    });
    md.use(unwrap(require('markdown-it-table-of-contents')), {
      includeLevel: [1, 2, 3],
      slugify: githubSlugify,
      // Match both [[toc]] and [TOC].
      markerPattern: /^\[\[?toc\]?\]/im,
    });
  }

  if (opts.math) {
    md.use(unwrap(require('@vscode/markdown-it-katex')), { throwOnError: false });
  }

  if (opts.footnotes) {
    md.use(unwrap(require('markdown-it-footnote')));
  }

  if (opts.emoji) {
    // emoji exposes { full, light, bare }; use the full database.
    md.use(require('markdown-it-emoji').full);
  }

  if (opts.alerts) {
    md.use(unwrap(require('markdown-it-github-alerts')));
  }

  if (opts.extraSyntax) {
    md.use(unwrap(require('markdown-it-deflist')));
    md.use(unwrap(require('markdown-it-sub')));
    md.use(unwrap(require('markdown-it-sup')));
    md.use(unwrap(require('markdown-it-mark')));
    md.use(unwrap(require('markdown-it-abbr')));
  }

  addTaskListPlugin(md);

  if (opts.linkRenderUrls) {
    addPrintUrlPlugin(md);
  }

  return md;
}

/**
 * Plugin to render GitHub-style task lists.
 */
function addTaskListPlugin(md: MarkdownIt): void {
  const originalRule =
    md.renderer.rules.list_item_open ||
    function (tokens: any[], idx: number, options: any, _env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };

  md.renderer.rules.list_item_open = function (tokens: any[], idx: number, options: any, env: any, self: any) {
    const token = tokens[idx];
    const nextToken = tokens[idx + 2];

    if (nextToken?.content) {
      const content = nextToken.content;

      if (content.startsWith('[ ] ')) {
        nextToken.content = content.slice(4);
        token.attrPush(['class', 'task-list-item']);
        return '<li class="task-list-item"><input type="checkbox" disabled> ';
      }

      if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
        nextToken.content = content.slice(4);
        token.attrPush(['class', 'task-list-item task-list-item-checked']);
        return '<li class="task-list-item task-list-item-checked"><input type="checkbox" checked disabled> ';
      }
    }

    return originalRule(tokens, idx, options, env, self);
  };
}

/**
 * Append the destination URL after external link text, e.g. "docs (https://…)".
 * Useful when the PDF will be printed. Internal/anchor links are left untouched.
 */
function addPrintUrlPlugin(md: MarkdownIt): void {
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function (tokens: any[], idx: number, options: any, _env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };

  const hrefStack: string[] = [];

  md.renderer.rules.link_open = function (tokens: any[], idx: number, options: any, env: any, self: any) {
    hrefStack.push(tokens[idx].attrGet('href') || '');
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  md.renderer.rules.link_close = function (tokens: any[], idx: number, options: any, _env: any, self: any) {
    const href = hrefStack.pop() || '';
    let out = self.renderToken(tokens, idx, options);
    if (/^https?:\/\//i.test(href)) {
      out += `<span class="print-url"> (${md.utils.escapeHtml(href)})</span>`;
    }
    return out;
  };
}

// ============================================
// Image handling
// ============================================

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
};

/**
 * Resolve local image references: embed as data URIs when requested
 * (most reliable under setContent), otherwise rewrite to absolute file:// URLs.
 */
function processImages(html: string, basePath: string, embed: boolean): string {
  return html.replace(
    /(<img[^>]+src=["'])(?!https?:|data:|file:)([^"']+)(["'])/gi,
    (match, prefix, src, suffix) => {
      const absolutePath = path.resolve(basePath, decodeURIComponent(src));

      if (embed) {
        try {
          const ext = path.extname(absolutePath).toLowerCase();
          const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
          const data = fs.readFileSync(absolutePath).toString('base64');
          return `${prefix}data:${mime};base64,${data}${suffix}`;
        } catch (__) {
          // Fall back to file:// if the image cannot be read.
        }
      }

      return `${prefix}file://${absolutePath.replace(/\\/g, '/')}${suffix}`;
    }
  );
}

// ============================================
// HTML assembly
// ============================================

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render markdown content to a full standalone HTML document.
 */
export function renderMarkdownToHtml(
  markdownContent: string,
  title: string,
  opts: RenderOptions
): RenderResult {
  const md = buildParser(opts);
  let htmlContent = md.render(markdownContent);

  htmlContent = processImages(htmlContent, opts.basePath, opts.embedImages);

  const hasMermaid = opts.mermaid && /class="mermaid"/.test(htmlContent);
  const styles = getStyles(opts);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body class="theme-${opts.theme}">
  ${htmlContent}
</body>
</html>`;

  return { html, hasMermaid };
}
