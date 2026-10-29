/**
 * Markdown parsing: config-driven markdown-it pipeline with syntax highlighting,
 * task lists, GitHub alerts, math, mermaid, footnotes, TOC and extended syntax.
 */

import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';
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
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import diff from 'highlight.js/lib/languages/diff';
import plaintext from 'highlight.js/lib/languages/plaintext';
import powershell from 'highlight.js/lib/languages/powershell';
import dart from 'highlight.js/lib/languages/dart';
import r from 'highlight.js/lib/languages/r';
import scss from 'highlight.js/lib/languages/scss';
import lua from 'highlight.js/lib/languages/lua';
import perl from 'highlight.js/lib/languages/perl';
import graphql from 'highlight.js/lib/languages/graphql';
import makefile from 'highlight.js/lib/languages/makefile';
import scala from 'highlight.js/lib/languages/scala';
import groovy from 'highlight.js/lib/languages/groovy';
import haskell from 'highlight.js/lib/languages/haskell';
import elixir from 'highlight.js/lib/languages/elixir';
import objectivec from 'highlight.js/lib/languages/objectivec';
import latex from 'highlight.js/lib/languages/latex';
import nginx from 'highlight.js/lib/languages/nginx';
import protobuf from 'highlight.js/lib/languages/protobuf';
import vbnet from 'highlight.js/lib/languages/vbnet';
import julia from 'highlight.js/lib/languages/julia';
import matlab from 'highlight.js/lib/languages/matlab';
import fortran from 'highlight.js/lib/languages/fortran';

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
hljs.registerLanguage('php', php);
hljs.registerLanguage('ruby', ruby);
hljs.registerLanguage('kotlin', kotlin);
hljs.registerLanguage('swift', swift);
hljs.registerLanguage('dockerfile', dockerfile);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('powershell', powershell);
hljs.registerLanguage('dart', dart);
hljs.registerLanguage('r', r);
hljs.registerLanguage('scss', scss);
hljs.registerLanguage('lua', lua);
hljs.registerLanguage('perl', perl);
hljs.registerLanguage('graphql', graphql);
hljs.registerLanguage('makefile', makefile);
hljs.registerLanguage('scala', scala);
hljs.registerLanguage('groovy', groovy);
hljs.registerLanguage('haskell', haskell);
hljs.registerLanguage('elixir', elixir);
hljs.registerLanguage('objectivec', objectivec);
hljs.registerLanguage('latex', latex);
hljs.registerLanguage('nginx', nginx);
hljs.registerLanguage('protobuf', protobuf);
hljs.registerLanguage('vbnet', vbnet);
hljs.registerLanguage('julia', julia);
hljs.registerLanguage('matlab', matlab);
hljs.registerLanguage('fortran', fortran);

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

export const THEMES: readonly ThemeName[] = ['github-light', 'github-dark', 'academic'];

/**
 * How bundled assets (KaTeX fonts, local images that are not embedded) are
 * referenced in the generated HTML.
 *   'file'    — absolute `file://` URLs (headless Chrome / PDF generation).
 *   'webview' — resolved through `toAssetUri` into vscode-webview URIs.
 */
export type AssetMode = 'file' | 'webview';

export interface RenderOptions {
  /** Absolute path to the extension root (used to locate bundled KaTeX/mermaid assets in out/). */
  extensionPath: string;
  /** Directory of the source markdown file (used to resolve relative images). */
  basePath: string;
  /** Root that site-absolute paths (`/img.png`) resolve against, e.g. the workspace folder. Defaults to basePath. */
  rootPath?: string;
  theme: ThemeName;
  fonts: FontOptions;
  /** Already-resolved custom CSS text appended last so it overrides the theme. */
  customCss: string;
  math: boolean;
  mermaid: boolean;
  toc: boolean;
  /** Heading levels included in [[toc]] (default [1, 2, 3]). */
  tocLevels?: number[];
  emoji: boolean;
  alerts: boolean;
  extraSyntax: boolean;
  footnotes: boolean;
  embedImages: boolean;
  linkRenderUrls: boolean;
  codeWrap: boolean;
  tablesWide: WideTableMode;
  /** Add the `open` attribute to every <details> so collapsed content is visible (and laid out before Mermaid runs). */
  expandDetails?: boolean;
  /** Defaults to 'file'. Set to 'webview' (with toAssetUri) for the live preview. */
  assetMode?: AssetMode;
  /** Maps an absolute filesystem path to a URL usable in the target surface. Required when assetMode === 'webview'. */
  toAssetUri?: (absPath: string) => string;
  /**
   * Webview only: whether `toAssetUri` can serve this path (it lies inside the
   * webview's resource roots). Such images are referenced instead of embedded,
   * which keeps live re-renders cheap.
   */
  canServe?: (absPath: string) => boolean;
}

export interface RenderResult {
  html: string;
  /** Whether the output contains mermaid diagrams that still need client-side rendering. */
  hasMermaid: boolean;
  /** Document title: front-matter `title:` when present, otherwise the caller-supplied fallback. */
  title: string;
}

export interface RenderBodyResult {
  /** Rendered <body> inner HTML. */
  content: string;
  /** Assembled stylesheet text. */
  styles: string;
  /** Whether the content contains mermaid diagrams needing client-side rendering. */
  hasMermaid: boolean;
}

// ============================================
// Front matter
// ============================================

export type FrontMatterValue = string | number | boolean | FrontMatter;
export interface FrontMatter { [key: string]: FrontMatterValue }

function parseScalar(raw: string): string | number | boolean {
  const v = raw.replace(/\s+#.*$/, '').trim();
  const quoted = /^(["'])(.*)\1$/.exec(v);
  if (quoted) { return quoted[2]; }
  if (/^(true|yes|on)$/i.test(v)) { return true; }
  if (/^(false|no|off)$/i.test(v)) { return false; }
  if (/^-?\d+(\.\d+)?$/.test(v)) { return Number(v); }
  return v;
}

/**
 * Parse leading YAML front matter into nested maps of scalars.
 * Deliberately minimal (indentation-nested `key: value` maps only — no lists,
 * no multi-line strings) to avoid a YAML dependency. Unsupported lines are ignored.
 */
export function extractFrontMatter(src: string): FrontMatter {
  const fm = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  const root: FrontMatter = {};
  if (!fm) { return root; }

  const stack: { indent: number; obj: FrontMatter }[] = [{ indent: -1, obj: root }];
  for (const line of fm[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) { continue; }
    const m = /^(\s*)([A-Za-z0-9_.-]+)\s*:(?:\s+(.*?))?\s*$/.exec(line);
    if (!m) { continue; }
    const indent = m[1].replace(/\t/g, '  ').length;
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) { stack.pop(); }
    const parent = stack[stack.length - 1].obj;
    const value = m[3];
    if (value === undefined || value === '') {
      const child: FrontMatter = {};
      parent[m[2]] = child;
      stack.push({ indent, obj: child });
    } else {
      parent[m[2]] = parseScalar(value);
    }
  }
  return root;
}

/** Extract a `title:` value from leading YAML front matter, if any. */
export function extractFrontMatterTitle(src: string): string | undefined {
  const title = extractFrontMatter(src).title;
  if (typeof title === 'string' || typeof title === 'number') {
    return String(title).trim() || undefined;
  }
  return undefined;
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
      const language = (lang || '').toLowerCase();

      // Mermaid: emit a container for client-side rendering, do not highlight.
      if (language === 'mermaid' && opts.mermaid) {
        return '<pre class="mermaid">' + md.utils.escapeHtml(str) + '</pre>';
      }

      const langClass = language ? ` class="language-${md.utils.escapeHtml(language)}"` : '';
      if (language && hljs.getLanguage(language)) {
        try {
          return `<pre class="hljs"><code${langClass}>` +
            hljs.highlight(str, { language, ignoreIllegals: true }).value +
            '</code></pre>';
        } catch (__) { /* fall through */ }
      }

      return `<pre class="hljs"><code${langClass}>` + md.utils.escapeHtml(str) + '</code></pre>';
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
      includeLevel: opts.tocLevels?.length ? opts.tocLevels : [1, 2, 3],
      slugify: githubSlugify,
      // Match [[toc]] or [TOC] alone on a line (text after it is not swallowed).
      markerPattern: /^\[\[?toc\]?\][ \t]*$/i,
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
  addPageBreakPlugin(md);

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
    // Tight and loose items alike are <list_item_open><paragraph_open><inline>.
    const inline = tokens[idx + 2];
    const first = inline?.type === 'inline' ? inline.children?.[0] : undefined;

    // The marker must be stripped from the first text CHILD: the renderer
    // renders inline children, so mutating inline.content has no effect.
    if (first?.type === 'text') {
      const marker = /^\[( |x|X)\](?: +|$)/.exec(first.content);
      if (marker) {
        first.content = first.content.slice(marker[0].length);
        const checked = marker[1] !== ' ';
        return checked
          ? '<li class="task-list-item task-list-item-checked"><input type="checkbox" checked disabled> '
          : '<li class="task-list-item"><input type="checkbox" disabled> ';
      }
    }

    return originalRule(tokens, idx, options, env, self);
  };
}

const PAGE_BREAK_HTML = '<div class="page-break"></div>\n';

/**
 * Manual page breaks: `<!-- pagebreak -->` (or `<!-- page-break -->`) and a
 * `\pagebreak` / `\newpage` line on its own.
 */
function addPageBreakPlugin(md: MarkdownIt): void {
  const commentRe = /^<!--\s*page-?break\s*-->\s*$/i;
  const defaultHtmlBlock = md.renderer.rules.html_block;
  md.renderer.rules.html_block = function (tokens: any[], idx: number, options: any, env: any, self: any) {
    if (commentRe.test(tokens[idx].content.trim())) { return PAGE_BREAK_HTML; }
    return defaultHtmlBlock
      ? defaultHtmlBlock(tokens, idx, options, env, self)
      : tokens[idx].content;
  };

  md.block.ruler.before('paragraph', 'latex_pagebreak', (state: any, startLine: number, _endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const line = state.src.slice(start, state.eMarks[startLine]);
    if (state.sCount[startLine] - state.blkIndent >= 4) { return false; }
    if (!/^\\(pagebreak|newpage)[ \t]*$/.test(line)) { return false; }
    if (silent) { return true; }
    state.line = startLine + 1;
    const token = state.push('page_break', 'div', 0);
    token.map = [startLine, state.line];
    return true;
  });
  md.renderer.rules.page_break = () => PAGE_BREAK_HTML;
}

/**
 * Append the destination URL after external link text, e.g. "docs (https://…)".
 * Useful when the PDF will be printed. Internal/anchor links, and autolinks
 * whose visible text already is the URL, are left untouched.
 */
function addPrintUrlPlugin(md: MarkdownIt): void {
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function (tokens: any[], idx: number, options: any, _env: any, self: any) {
      return self.renderToken(tokens, idx, options);
    };

  const hrefStack: (string | null)[] = [];

  md.renderer.rules.link_open = function (tokens: any[], idx: number, options: any, env: any, self: any) {
    const token = tokens[idx];
    const href: string = token.attrGet('href') || '';
    const next = tokens[idx + 1];
    const textIsUrl =
      token.markup === 'linkify' ||
      token.markup === 'autolink' ||
      (next?.type === 'text' && tokens[idx + 2]?.type === 'link_close' &&
        (next.content === href || md.normalizeLink(next.content) === href));
    hrefStack.push(textIsUrl ? null : href);
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  md.renderer.rules.link_close = function (tokens: any[], idx: number, options: any, _env: any, self: any) {
    const href = hrefStack.pop();
    let out = self.renderToken(tokens, idx, options);
    if (href && /^https?:\/\//i.test(href)) {
      out += `<span class="print-url"> (${md.utils.escapeHtml(href)})</span>`;
    }
    return out;
  };
}

// ============================================
// Local resources (images, media, links)
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|#39);/gi, (m, ent: string) => {
    const e = ent.toLowerCase();
    if (e === 'amp') { return '&'; }
    if (e === 'lt') { return '<'; }
    if (e === 'gt') { return '>'; }
    if (e === 'quot') { return '"'; }
    if (e === 'apos' || e === '#39') { return "'"; }
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

function safeDecode(text: string): string {
  try { return decodeURIComponent(text); } catch { return text; }
}

/**
 * Classify a URL-ish attribute value. Returns the local absolute path plus the
 * `?query#hash` suffix for local references, or undefined for anything remote,
 * a pure fragment, or another scheme.
 */
export function resolveLocalRef(
  raw: string,
  basePath: string,
  rootPath?: string
): { absPath: string; suffix: string } | undefined {
  const value = raw.trim();
  if (!value || value.startsWith('#') || value.startsWith('//')) { return undefined; }

  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(value);
  if (!isWinAbs && /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) { return undefined; }

  const cut = value.search(/[?#]/);
  const pathPart = cut >= 0 ? value.slice(0, cut) : value;
  const suffix = cut >= 0 ? value.slice(cut) : '';
  if (!pathPart) { return undefined; }

  const decoded = safeDecode(pathPart);
  let absPath: string;
  if (isWinAbs) {
    absPath = path.normalize(decoded);
  } else if (decoded.startsWith('/') && rootPath) {
    // Site-absolute (`/docs/img.png`) → relative to the workspace root, like GitHub.
    absPath = path.join(rootPath, decoded);
  } else {
    absPath = path.resolve(basePath, decoded);
  }
  return { absPath, suffix };
}

const embedCache = new Map<string, { mtimeMs: number; uri: string }>();
const EMBED_CACHE_LIMIT = 200;

/** Read a local image as a data URI (cached by mtime so live re-renders stay cheap). */
function embedImage(absPath: string): string | undefined {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile()) { return undefined; }
    const cached = embedCache.get(absPath);
    if (cached && cached.mtimeMs === stat.mtimeMs) { return cached.uri; }
    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    const uri = `data:${mime};base64,${fs.readFileSync(absPath).toString('base64')}`;
    if (embedCache.size >= EMBED_CACHE_LIMIT) {
      embedCache.delete(embedCache.keys().next().value as string);
    }
    embedCache.set(absPath, { mtimeMs: stat.mtimeMs, uri });
    return uri;
  } catch {
    return undefined;
  }
}

/**
 * Resolve local references so they work from wherever the HTML is loaded
 * (a temp file for PDF generation, a webview for the preview):
 *   - <img src>: embedded as a data URI when requested (self-contained), else a
 *     `file://` URL (PDF) or webview URI (preview).
 *   - <video>/<audio>/<source> src and <video poster>: `file://` / webview URI.
 *   - <a href> to local files (PDF only): absolute `file://` URLs. Pure
 *     `#fragment` links are untouched so internal PDF links keep working. The
 *     preview intercepts link clicks itself and resolves them against the document.
 */
export function processLocalResources(html: string, opts: RenderOptions): string {
  const webview = opts.assetMode === 'webview' && !!opts.toAssetUri;

  const toUrl = (absPath: string, suffix: string): string =>
    webview ? opts.toAssetUri!(absPath) + suffix : pathToFileURL(absPath).href + suffix;

  return html.replace(/<(img|video|audio|source|a)\b[^>]*>/gi, (tag: string, tagName: string) => {
    const name = tagName.toLowerCase();
    if (name === 'a' && webview) { return tag; }
    const attrs = name === 'a' ? 'href' : name === 'video' ? 'src|poster' : 'src';
    const attrRe = new RegExp(`(\\s(?:${attrs})\\s*=\\s*)(?:"([^"]*)"|'([^']*)')`, 'gi');

    return tag.replace(attrRe, (match: string, prefix: string, dq?: string, sq?: string) => {
      const ref = resolveLocalRef(unescapeHtml(dq ?? sq ?? ''), opts.basePath, opts.rootPath);
      if (!ref) { return match; }

      let url: string | undefined;
      if (name === 'img') {
        const servable = webview && (opts.canServe ? opts.canServe(ref.absPath) : !opts.embedImages);
        if (!servable && (opts.embedImages || webview)) {
          url = embedImage(ref.absPath);
        }
      }
      url ??= toUrl(ref.absPath, ref.suffix);
      return `${prefix}"${escapeHtml(url)}"`;
    });
  });
}

/** Add `open` to every <details> start tag that does not already have it. */
function openAllDetails(html: string): string {
  return html.replace(/<details\b([^>]*)>/gi, (match: string, attrs: string) =>
    /\sopen(\s|=|$)/i.test(attrs) ? match : `<details open${attrs}>`
  );
}

// ============================================
// HTML assembly
// ============================================

/**
 * Render markdown content to its body HTML + stylesheet, without wrapping it in a
 * full document. Shared by the PDF path and the live preview so both render the
 * exact same output through the exact same pipeline.
 */
export function renderMarkdownBody(
  markdownContent: string,
  opts: RenderOptions
): RenderBodyResult {
  const md = buildParser(opts);
  // A UTF-8 BOM (common from Windows editors) would stop front matter being recognised.
  let content = md.render(markdownContent.replace(/^\uFEFF/, ''));

  content = processLocalResources(content, opts);
  if (opts.expandDetails) {
    content = openAllDetails(content);
  }

  const hasMermaid = opts.mermaid && /class="mermaid"/.test(content);
  const styles = getStyles(opts);

  return { content, styles, hasMermaid };
}

/**
 * Render markdown content to a full standalone HTML document (used for PDF
 * generation in headless Chrome).
 *
 * A Content-Security-Policy stops scripts embedded in the Markdown (raw HTML is
 * allowed) from running while Chrome renders it: only module scripts from
 * `scriptSrc` (the bundled Mermaid directory) may load, and no network
 * connections are possible, so a document cannot read and exfiltrate local files.
 */
export function renderMarkdownToHtml(
  markdownContent: string,
  fallbackTitle: string,
  opts: RenderOptions,
  scriptSrc?: string
): RenderResult {
  const { content, styles, hasMermaid } = renderMarkdownBody(markdownContent, opts);
  // The <title> also feeds Chrome's {title} header/footer token.
  const title = extractFrontMatterTitle(markdownContent) ?? fallbackTitle;

  const csp = [
    "default-src 'none'",
    `script-src ${scriptSrc ? escapeHtml(scriptSrc) : "'none'"}`,
    "style-src 'unsafe-inline' file: https: data:",
    'img-src file: https: http: data: blob:',
    'font-src file: https: data:',
    'media-src file: https: http: data:',
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
  ].join('; ');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body class="markdown-body theme-${opts.theme}">
  ${content}
</body>
</html>`;

  return { html, hasMermaid, title };
}
