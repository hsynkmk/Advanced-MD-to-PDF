/**
 * Unit tests for the vscode-free rendering pipeline (out/markdown.js, out/page.js,
 * out/overrides.js). Run with `npm test` (compiles first).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const md = require(path.join(root, 'out', 'markdown.js'));
const page = require(path.join(root, 'out', 'page.js'));
const overrides = require(path.join(root, 'out', 'overrides.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'md-to-pdf-test-'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);
fs.writeFileSync(path.join(tmp, 'a&b.png'), PNG);
fs.writeFileSync(path.join(tmp, '100%.png'), PNG);
fs.writeFileSync(path.join(tmp, 'pic.png'), PNG);

const base = {
  extensionPath: root,
  basePath: tmp,
  theme: 'github-light',
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
const render = (src, opts = {}) => md.renderMarkdownBody(src, { ...base, ...opts }).content;

test('local images with &, % and ?query are embedded', () => {
  for (const src of ['![x](a&b.png)', '![x](100%25.png)', '![x](pic.png?raw=true)']) {
    assert.match(render(src), /src="data:image\/png;base64,/, src);
  }
});

test('raw-HTML image with an unescaped % does not abort the render', () => {
  assert.match(render('<img src="100%.png">'), /src="data:image\/png;base64,/);
});

test('remote, protocol-relative and data images are left alone', () => {
  assert.match(render('![x](https://example.com/a.png)'), /src="https:\/\/example.com\/a.png"/);
  assert.match(render('![x](//cdn.example.com/a.png)'), /src="\/\/cdn.example.com\/a.png"/);
  assert.match(render('<img data-src="lazy.png" src="https://x/y.png">'), /data-src="lazy.png"/);
});

test('missing images fall back to a file:// URL; site-absolute paths use rootPath', () => {
  const html = render('![x](missing.png) ![y](/docs/img.png)', { rootPath: path.join(tmp, 'root') });
  assert.ok(html.includes(pathToFileURL(path.join(tmp, 'missing.png')).href));
  assert.ok(html.includes(pathToFileURL(path.join(tmp, 'root', 'docs', 'img.png')).href));
});

test('webview mode references servable images instead of embedding them', () => {
  const html = render('![x](pic.png)', {
    assetMode: 'webview',
    toAssetUri: (p) => 'vscode-resource:' + p.replace(/\\/g, '/'),
    canServe: () => true,
  });
  assert.match(html, /src="vscode-resource:[^"]*pic.png"/);
});

test('relative links become file:// URLs for the PDF; #fragments are untouched', () => {
  const html = render('[doc](other.md#part) [here](#task-lists) [web](https://example.com)');
  assert.ok(html.includes(`href="${pathToFileURL(path.join(tmp, 'other.md')).href}#part"`));
  assert.match(html, /href="#task-lists"/);
  assert.match(html, /href="https:\/\/example.com"/);
});

test('task lists render checkboxes without the literal marker', () => {
  const html = render('- [ ] open\n- [x] done');
  assert.match(html, /<input type="checkbox" disabled> open/);
  assert.match(html, /<input type="checkbox" checked disabled> done/);
  assert.doesNotMatch(html, /\[[ x]\]/);
});

test('TOC links match heading ids, including duplicates and unicode', () => {
  const html = render('[[toc]]\n\n# Foo\n## Foo\n## Über Straße\n');
  const ids = [...html.matchAll(/<h\d id="([^"]+)"/g)].map((m) => m[1]);
  const links = [...html.matchAll(/<a href="#([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, ids);
  assert.equal(new Set(ids).size, ids.length);
});

test('a TOC marker followed by text is not swallowed', () => {
  const html = render('[toc] is a marker\n\n# A');
  assert.match(html, /\[toc\] is a marker/);
  assert.doesNotMatch(html, /table-of-contents/);
});

test('toc levels are configurable', () => {
  const html = render('[[toc]]\n\n# A\n## B\n### C\n#### D', { tocLevels: [2, 3, 4] });
  const toc = /<div class="table-of-contents">([\s\S]*?)<\/div>/.exec(html)[1];
  assert.doesNotMatch(toc, />A</);
  assert.match(toc, />D</);
});

test('printed URLs are not duplicated for autolinks', () => {
  const html = render('See https://example.com and [docs](https://docs.example.com)', { linkRenderUrls: true });
  assert.equal((html.match(/print-url/g) || []).length, 1);
  assert.match(html, /\(https:\/\/docs.example.com\)/);
});

test('<details> is expanded when requested (and only then)', () => {
  const src = '<details>\n<summary>S</summary>\n\nBody\n</details>';
  assert.match(render(src), /<details open>/);
  assert.doesNotMatch(render(src, { expandDetails: false }), /<details open/);
  assert.equal((render('<details open>\n\nx\n</details>').match(/open/g) || []).length, 1);
});

test('page breaks: HTML comment and LaTeX-style command', () => {
  for (const src of ['a\n\n<!-- pagebreak -->\n\nb', 'a\n\n\\pagebreak\n\nb', 'a\n\n\\newpage\n\nb']) {
    assert.match(render(src), /<div class="page-break"><\/div>/, src);
  }
  assert.doesNotMatch(render('`\\pagebreak` inline'), /page-break/);
});

test('code blocks carry a language class; mermaid blocks are left for client rendering', () => {
  assert.match(render('```js\nlet a = 1\n```'), /<code class="language-js">/);
  assert.match(render('```scala\nobject A\n```'), /hljs-keyword/);
  assert.match(render('```mermaid\ngraph TD;A-->B\n```'), /<pre class="mermaid">/);
  assert.doesNotMatch(render('```mermaid\ngraph TD;A-->B\n```', { mermaid: false }), /class="mermaid"/);
});

test('front matter: title, nested pdf overrides, and BOM/comment handling', () => {
  const src = '﻿---\ntitle: "My Doc"\n# comment\npdf:\n  theme: academic\n  format: letter\n  landscape: true\n  margins:\n    top: 10mm\n    left: 1in\n  toc: false\n---\n# Body';
  assert.equal(md.extractFrontMatterTitle(src), 'My Doc');
  assert.deepEqual(overrides.frontMatterOverrides(src), {
    theme: 'academic',
    format: 'Letter',
    landscape: true,
    margins: { top: '10mm', left: '1in' },
    toc: false,
  });
  assert.deepEqual(overrides.frontMatterOverrides('---\npdf:\n  margins: 20mm\n  theme: nope\n---\n').margins,
    { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' });
  assert.doesNotMatch(render(src), /theme: academic/);
});

test('explicit overrides beat front matter', () => {
  const merged = overrides.mergeOverrides(
    { theme: 'academic', landscape: true, margins: { top: '1mm', left: '2mm' } },
    { theme: 'github-dark', margins: { top: '9mm' } }
  );
  assert.deepEqual(merged, { theme: 'github-dark', landscape: true, margins: { top: '9mm', left: '2mm' } });
});

test('standalone HTML has a script-blocking CSP and the front-matter title', () => {
  const { html, title } = md.renderMarkdownToHtml('---\ntitle: T & C\n---\n<script>alert(1)</script>', 'fallback', base, 'file:');
  assert.equal(title, 'T & C');
  assert.match(html, /<title>T &amp; C<\/title>/);
  assert.match(html, /Content-Security-Policy" content="[^"]*script-src file:;[^"]*connect-src 'none'/);
});

test('styles: @page background per theme, academic justify works in the preview container', () => {
  const dark = md.renderMarkdownBody('x', { ...base, theme: 'github-dark' }).styles;
  assert.match(dark, /@page \{ background: #0d1117; \}/);
  assert.match(md.renderMarkdownBody('x', base).styles, /^\.theme-academic p \{ text-align: justify; \}/m);
});

test('bundled KaTeX CSS matches the KaTeX version that renders the math', { skip: !fs.existsSync(path.join(root, 'out', 'katex', 'katex.min.css')) }, () => {
  const plugin = require.resolve('@vscode/markdown-it-katex', { paths: [root] });
  const katexCss = path.join(path.dirname(require.resolve('katex', { paths: [path.dirname(plugin)] })), 'katex.min.css');
  assert.equal(
    fs.readFileSync(path.join(root, 'out', 'katex', 'katex.min.css'), 'utf-8'),
    fs.readFileSync(katexCss, 'utf-8')
  );
});

test('page geometry and CSS lengths', () => {
  assert.equal(Math.round(page.cssLengthToPx('1in')), 96);
  assert.equal(Math.round(page.cssLengthToPx('25.4mm')), 96);
  assert.equal(page.cssLengthToPx('bogus', 7), 7);
  assert.deepEqual(page.normalizeMargins({ top: '5mm' }), { top: '5mm', right: '15mm', bottom: '15mm', left: '15mm' });
  const a4 = page.pageGeometry('A4', false, page.DEFAULT_MARGINS, 1);
  const a4l = page.pageGeometry('A4', true, page.DEFAULT_MARGINS, 1);
  assert.equal(Math.round(a4.pageWidth), 794);
  assert.equal(Math.round(a4l.pageWidth), 1123);
  assert.ok(page.pageGeometry('A4', false, page.DEFAULT_MARGINS, 0.5).contentWidth > a4.contentWidth * 1.9);
});
