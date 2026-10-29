# Changelog

All notable changes to the "Advanced MD to PDF" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.1.html).

## [2.3.0] - 2026-10-29

### Security

- **Scripts in Markdown no longer run during conversion.** The rendered page now has a Content-Security-Policy, so raw `<script>` tags and inline event handlers are blocked and scripts can't open network connections. A document you convert can no longer read local files and send them anywhere.
- **`md-to-pdf.browserPath` is now a user-only (machine-scoped) setting.** A repository's `.vscode/settings.json` can no longer point the extension at an arbitrary executable.
- **Workspace Trust support.** In Restricted Mode, workspace settings can't change `browserPath`, `customCss`, or `outputDirectory`.
- **Chrome's sandbox stays enabled.** `--no-sandbox` is now only used on Linux when running as root (containers), where Chrome requires it.

### Fixed

- **PDF viewer stuck on "Loading PDF…" on VS Code 1.85–1.87.** The bundled pdf.js needed a newer Chromium than those releases ship; the viewer now uses pdf.js' compatibility build.
- **PDF viewer stuck on "Loading PDF…" when a path contained an apostrophe** (e.g. `John's notes.pdf`, or a user folder like `O'Brien`). The same fix applies to Mermaid in the preview.
- **PDF viewer: PDFs on remote or virtual file systems** (and *Open With…* on them) now load; the extension reads the file and hands it to the viewer.
- **PDF viewer: error flash after re-exporting.** A reload that catches the file mid-write is retried quietly instead of showing an error.
- **PDF viewer: blank pages or a crashed viewer on long PDFs or at high zoom.** Pages far from the viewport release their memory, and very large pages render at a capped resolution.
- **PDF viewer:** faster first page on long documents, no stretched or misaligned pages while zooming, no needless re-render when the tab is hidden, and sharp pages after moving VS Code to a monitor with different scaling.
- **Preview:** a Markdown file without a `.md` extension (language mode set to Markdown) was refused, and the preview stopped updating once the previewed file's editor was closed.
- **README:** the page-break instructions were garbled.
- **Dark theme printed white page margins.** The page background now covers the whole sheet.
- **Local images with `&`, `?query`, or `%` in the path were missing**, and a raw-HTML `<img src="100%.png">` aborted the whole conversion. Protocol-relative (`//cdn/…`) images were turned into broken `file://` URLs. All of these now work.
- **Files saved with a UTF-8 BOM** (common on Windows) printed their YAML front matter as body text.
- **Relative links, videos, and audio were broken in the PDF.** They resolved against a temporary folder; they now point at the real files.
- **`linkRenderUrls` duplicated URLs:** it printed `https://x.com (https://x.com)` for autolinks.
- **`[toc] some text` swallowed the text after the marker.** The marker now has to be alone on its line.
- **KaTeX glyph placement.** The KaTeX CSS and fonts were taken from a different KaTeX version than the one rendering the math; they now come from the same build.
- **PDF viewer: misaligned text selection.** The selectable text layer was sized with a CSS variable pdf.js' own viewer normally provides, so selection and find highlights didn't line up with the page.
- **PDF viewer: duplicated pages and text layers.** Re-exporting while the viewer was open (the file changes several times while it's being written), or scrolling quickly, could duplicate pages or stack text layers. The viewer also keeps your page and zoom across reloads now.
- **PDF viewer: `Ctrl/Cmd+F` didn't work** even though the text layer is searchable.
- **PDF viewer: other PDFs.** Documents with non-embedded fonts, CJK text, or JPEG 2000 images now render (cmaps, standard fonts, and wasm decoders are bundled).
- **Two conversions at once launched two Chromes**, leaking one.
- **The downloaded Chrome needed the internet on every VS Code start.** An already-downloaded build is now reused offline.
- **Locked output file.** Re-exporting while the PDF is open in another program (e.g. Acrobat on Windows) now explains what happened and offers *Save As…*. PDFs are written atomically, so viewers never see a half-written file.
- **Header/footer alignment** now follows your left/right margins instead of a fixed 15 mm.
- **Partial `margins` settings** (e.g. only `top`) no longer leave the other sides undefined.
- **Multi-root workspaces:** folder-level settings are honoured, and `customCss` resolves against the document's own workspace folder.
- **Custom CSS `url(...)` references** (fonts, images) resolve against the CSS file instead of breaking.
- **Wide display equations** are scaled to fit the page instead of being cut off.
- **Long tables** no longer jump to the next page and leave a blank gap. Rows stay whole and the header repeats on every page.
- **Preview: a bad `customCss` path showed a warning on every keystroke.** It's now reported once.
- **Preview: toolbar out of sync.** Changing `md-to-pdf.theme` (or other settings) left the toolbar showing the old values.
- **Preview: Academic theme** paragraphs weren't justified.
- **Preview: jumping scroll position** while typing in documents with Mermaid diagrams.
- **Preview restore after reload** now works even when no Markdown file is open yet.
- **Mermaid errors are reported** (a warning plus details in the *MD to PDF* output channel) instead of silently leaving raw diagram source. One broken diagram no longer stops the others.
- **Faster exports.** Chrome no longer waits for a fixed network-idle period, and slow remote images can't stall a conversion indefinitely.

### Added

- **Page-accurate preview.** The preview draws the page at the real paper width, margins, orientation, and scale, so wrapping matches the PDF. Links work: `#anchors` scroll, relative `.md` files open in the editor, and web links open in the browser.
- **Clickable links in the PDF viewer.** Table-of-contents and other internal links jump to the target, web links open in your browser, and there's keyboard navigation (`Page Up/Down`, `Home/End`, `Ctrl/Cmd +/-/0`). Zooming keeps your place.
- **Manual page breaks:** `<!-- pagebreak -->`, `\pagebreak`, or `\newpage` on its own line.
- **Per-document options in front matter:** a `pdf:` block with `theme`, `format`, `landscape`, `margins`, and `toc`.
- **`md-to-pdf.toc.levels`** chooses which heading levels appear in `[[toc]]`.
- **Path variables** in `outputDirectory` and `customCss`: `${workspaceFolder}`, `${fileDirname}`, `${userHome}`, and `~`.
- **Convert several files at once** by multi-selecting them in the Explorer.
- **Cancellable conversions**, for single files as well as folders.
- The shared Chrome instance **shuts down after 5 idle minutes** instead of staying resident.
- **More browsers detected:** Brave, Chromium, per-user Edge on Windows, `/opt/google/chrome`, and `~/Applications` on macOS. A `browserPath` that doesn't exist now produces a warning.
- **More highlighted languages:** Scala, Groovy, Haskell, Elixir, Objective-C, LaTeX, Nginx, Protobuf, VB.NET, Julia, MATLAB, Fortran. Code blocks also carry a `language-xxx` class for custom CSS.
- **Automated tests** (`npm test`): unit tests for the rendering pipeline plus an end-to-end PDF smoke test in real Chrome.

### Changed

- **The preview shortcut is now `Ctrl+K Ctrl+Alt+V` / `Cmd+K Cmd+Alt+V`**, so VS Code's built-in *Markdown: Open Preview to the Side* (`Ctrl+K V`) works again. Both shortcuts now apply only while a Markdown editor has focus.
- **The PDF viewer is no longer the default editor for every PDF.** Generated PDFs still open in it; for other PDFs use **Open With… → MD to PDF Viewer**.
- `mermaid.theme: auto` now uses the `neutral` Mermaid theme for the Academic theme.
- Mermaid runs with `securityLevel: strict`.
- `<details>` blocks are expanded in the HTML itself (when `expandDetails` is on), so the preview matches the PDF.
- The extension package now ships only the bundled `out/extension.js` (no stray per-file builds or source maps).

## [2.2.0] - 2026-07-12

### Fixed

- **Task lists render correctly.** Checked/unchecked items no longer show a duplicated literal `[ ]` / `[x]` next to the checkbox.
- **`openAfterConversion` works again.** The PDF now opens immediately after conversion; previously it waited until the success notification was dismissed, and the "Converting…" progress spinner hung alongside it.
- **Unsaved changes are exported.** Converting a dirty editor now saves it first, so the PDF matches what you see. Untitled (never-saved) documents get a clear "Save the file first" message.
- **Print button in the PDF viewer.** `window.print()` does nothing inside VS Code webviews, so Print now hands the PDF to the system viewer (which has a working print dialog).
- **"Save a copy" dialog** in the PDF viewer now defaults to a `<name>-copy.pdf` next to the original instead of the filesystem root.
- **Esc cancels.** Dismissing any of the `askOptionsOnConvert` quick-picks cancels the export instead of silently continuing.
- **`md-to-pdf.browserPath` changes apply immediately** — no window reload needed.
- **Robust file URLs.** Paths containing `#`, spaces, or unusual characters no longer break page loading or local image references.
- **Marketplace changelog** — CHANGELOG.md was excluded from the extension package, leaving the Changelog tab empty.

### Added

- **Preview panel survives window reloads**, restoring the previewed document and toolbar choices.
- **Live preview applies your `customCss`** and re-renders when any `md-to-pdf.*` setting changes.
- **Document title from front matter.** A YAML `title:` sets the PDF title (used by the `{title}` header/footer token); the filename remains the fallback.
- **PDF viewer re-fits on resize.** Fit-width / fit-page track panel size changes; manual zoom stays put until you pick a fit again.
- **More syntax-highlighting languages:** PHP, Ruby, Kotlin, Swift, Dockerfile, diff, PowerShell, Dart, R, SCSS, Lua, Perl, GraphQL, Makefile, plaintext.
- **Folder conversion polish:** stable ordering, skips the configured output directory, and the summary offers **Open Folder** / **Show Log** (failures are logged to a new *MD to PDF* output channel).
- `examples/feature-showcase.md` exercising every supported feature.

## [2.1.0] - 2026-06-28

### Added

- **Live PDF Preview.** A new side panel (`Advanced MD to PDF: Open PDF Preview`, title-bar eye icon, or `Ctrl+K V` / `Cmd+K V`) renders the document through the exact same pipeline used for export and updates as you type. It follows the active Markdown editor and includes a toolbar to switch **theme**, **page size**, and **orientation** for a single export — with **Export to PDF** and **Export As…** buttons right in the panel.
- **Export to PDF (choose location)…** command and a Save dialog so you can pick exactly where the PDF goes.
- **`md-to-pdf.askOptionsOnConvert`** setting — optionally prompt for theme / page size / orientation each time you convert.

### Changed

- **Internal PDF viewer rebuilt.** Added a toolbar (page navigation, zoom in/out, fit-width, fit-page, save a copy, print, open externally), **selectable & searchable text**, lazy page rendering for large files, and a strict Content-Security-Policy. The viewer now **auto-refreshes** when the PDF is regenerated, and page rendering is correctly awaited (no more out-of-order pages).
- `.markdown` files are now accepted everywhere `.md` was, and command titles are grouped consistently under the **Advanced MD to PDF** category.

## [2.0.1] - 2026-06-15

### Fixed

- **Large documents no longer time out.** The `md-to-pdf.timeout` setting was only applied to page navigation, so the actual PDF-generation step (`page.pdf`) fell back to Chrome's built-in 30-second limit and aborted on big files. The configured timeout now governs navigation, Mermaid rendering, and PDF generation alike.

### Changed

- `md-to-pdf.timeout` default raised from `60000` to `120000` ms, and **`0` now disables the limit entirely** — recommended for very large documents (tens of thousands of lines).

## [1.0.0] - 2026-06-15

Initial release of **Advanced MD to PDF**.

A fast and reliable Markdown to PDF converter for VS Code with GitHub-style rendering,
syntax highlighting, and browser-based PDF generation.

### Added

- Convert Markdown files to PDF with a single click.
- GitHub-style Markdown rendering.
- Syntax highlighting for code blocks.
- Support for:
  - Tables
  - Task lists
  - Blockquotes
  - Images
  - Links
  - Headings
  - Lists
  - Inline formatting
- Support for Mermaid diagrams.
- Support for mathematical expressions using KaTeX.
- Automatic PDF generation using Chrome/Chromium-based browsers.
- Multiple conversion options:
  - Editor title bar button
  - Right-click context menu
  - Status bar action
  - Keyboard shortcut:
    - Windows/Linux: `Ctrl + Alt + P`
    - macOS: `Cmd + Alt + P`
- Configurable PDF settings:
  - Page format:
    - A4
    - Letter
    - Legal
    - A3
    - A5
  - Page margins
  - Auto-open generated PDFs
- Cross-platform browser detection:
  - Chrome
  - Microsoft Edge
  - Chromium
  - Brave

### Performance

- Optimized rendering pipeline for fast PDF generation.
- Uses local rendering resources where possible.
- Designed to handle large Markdown documents efficiently.

### Notes

This is the first public release of **Advanced MD to PDF**.