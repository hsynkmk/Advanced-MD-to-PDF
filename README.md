# Advanced MD to PDF ⚡

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/hsynkmk.Advanced-MD-to-PDF)](https://marketplace.visualstudio.com/items?itemName=hsynkmk.Advanced-MD-to-PDF)
[![Visual Studio Marketplace Installs](https://img.shields.io/visual-studio-marketplace/i/hsynkmk.Advanced-MD-to-PDF)](https://marketplace.visualstudio.com/items?itemName=hsynkmk.Advanced-MD-to-PDF)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Convert Markdown to PDF instantly with a single click. Beautiful GitHub-style formatting with syntax highlighting, **Mermaid diagrams**, **KaTeX math**, **GitHub alerts**, collapsible `<details>`, themes, and smart overflow handling.

## ✨ Features

- **⚡ Super Fast** — Persistent browser instance for near-instant conversions
- **🎨 Themes** — `github-light`, `github-dark`, and `academic`, plus custom CSS and font overrides
- **📊 Mermaid Diagrams** — ` ```mermaid ` blocks rendered to crisp vector graphics
- **🧮 Math** — KaTeX inline `$…$` and block `$$…$$` LaTeX with bundled fonts
- **📣 GitHub Alerts** — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`
- **📂 Collapsible Details** — `<details>` blocks are auto-expanded so nothing is hidden
- **🔗 Smart Links & Overflow** — Working internal anchors, wrapped long code/URLs, fitted wide tables
- **📑 Rich Markdown** — TOC, footnotes, emoji, task lists, definition lists, sub/sup, ==highlight==, abbreviations
- **🖱️ One-Click** — Convert from title bar, context menu, status bar, or convert a whole folder
- **⌨️ Keyboard Shortcut** — `Cmd+Alt+P` (Mac) / `Ctrl+Alt+P` (Windows/Linux)
- **🖨️ Headers & Footers** — Page numbers, title, date, and file path tokens
- **👀 PDF Viewer** — View generated PDFs directly in VS Code
- **⬇️ Zero-Config Browser** — Auto-detects Chrome/Edge, or downloads Chrome automatically when none is found

## 📸 Screenshots

### Preview
![Feature Preview](images/demo-preview.png)

*See [examples/feature-showcase.md](examples/feature-showcase.md) for the source file.*


## 🚀 Usage

### Method 1: Title Bar Button
Click the **PDF** button in the editor title bar when viewing a Markdown file.

### Method 2: Context Menu
Right-click on a `.md` file in the Explorer or editor and select **MD to PDF: Convert to PDF**.

### Method 3: Status Bar
Click the **PDF** button in the status bar when a Markdown file is open.

### Method 4: Keyboard Shortcut
Press `Cmd+Alt+P` (Mac) or `Ctrl+Alt+P` (Windows/Linux) while editing a Markdown file.

### Method 5: Convert a Folder
Right-click a folder in the Explorer and select **MD to PDF: Convert All Markdown in Folder**.

## ⚙️ Settings

### Output & layout
| Setting | Default | Description |
|---------|---------|-------------|
| `md-to-pdf.openAfterConversion` | `true` | Automatically open PDF after conversion |
| `md-to-pdf.pageFormat` | `"A4"` | A4, Letter, Legal, A3, A5, A6, Tabloid |
| `md-to-pdf.landscape` | `false` | Render pages in landscape orientation |
| `md-to-pdf.scale` | `1` | Render scale (0.1–2) to shrink wide content |
| `md-to-pdf.margins` | `{...}` | Page margins (top, right, bottom, left) |
| `md-to-pdf.onFileExists` | `"overwrite"` | `overwrite` or `newFile` (adds a sequence number) |
| `md-to-pdf.outputDirectory` | `""` | Where to write PDFs (relative to the source file, or absolute) |
| `md-to-pdf.viewer` | `"internal"` | `system` (default app) or `internal` (VS Code) |
| `md-to-pdf.header` / `md-to-pdf.footer` | `{ enabled: false }` | Running header/footer; tokens: `{title} {date} {pageNumber} {totalPages} {filePath}` |

### Styling
| Setting | Default | Description |
|---------|---------|-------------|
| `md-to-pdf.theme` | `"github-light"` | `github-light`, `github-dark`, or `academic` |
| `md-to-pdf.customCss` | `""` | Path to a CSS file appended after the theme |
| `md-to-pdf.fonts` | `{}` | `body`, `mono`, and `size` overrides |

### Content & rendering
| Setting | Default | Description |
|---------|---------|-------------|
| `md-to-pdf.mermaid.enabled` / `md-to-pdf.mermaid.theme` | `true` / `"auto"` | Render Mermaid diagrams and choose their theme |
| `md-to-pdf.math.enabled` | `true` | Render KaTeX math |
| `md-to-pdf.alerts.enabled` | `true` | Render GitHub-style alerts/callouts |
| `md-to-pdf.toc.enabled` | `true` | `[[toc]]`/`[TOC]` and heading anchors |
| `md-to-pdf.emoji` | `true` | Render `:emoji:` shortcodes |
| `md-to-pdf.extraSyntax` | `true` | Definition lists, sub/sup, `==mark==`, abbreviations |
| `md-to-pdf.expandDetails` | `true` | Expand `<details>` so content is visible |
| `md-to-pdf.embedImages` | `true` | Embed local images as data URIs |
| `md-to-pdf.linkRenderUrls` | `false` | Print the URL after external links |
| `md-to-pdf.codeBlocks.wordWrap` | `true` | Wrap long code lines instead of clipping |
| `md-to-pdf.tables.wide` | `"wrap"` | `wrap` cells or `shrink` font for wide tables |
| `md-to-pdf.convertFolder.recursive` | `false` | Include subfolders when converting a folder |

### Browser
| Setting | Default | Description |
|---------|---------|-------------|
| `md-to-pdf.browserPath` | `""` | Explicit Chrome/Chromium/Edge path (auto-detected, then auto-downloaded, if empty) |
| `md-to-pdf.timeout` | `120000` | Max time (ms) to wait while rendering. Set to `0` to disable for very large documents |

### Example Configuration

```json
{
  "md-to-pdf.theme": "github-dark",
  "md-to-pdf.pageFormat": "Letter",
  "md-to-pdf.footer": {
    "enabled": true,
    "template": "{pageNumber} / {totalPages}"
  },
  "md-to-pdf.tables.wide": "shrink",
  "md-to-pdf.linkRenderUrls": true
}
```

## 📋 Requirements

- **VS Code** 1.85.0 or higher
- **Browser**: Chrome, Chromium, Microsoft Edge, or Brave (automatically detected)

## 🛠️ Supported Markdown Features

- ✅ Headings (H1–H6) with anchors and internal links
- ✅ Bold, italic, strikethrough, ==highlight==, sub~script~, super^script^
- ✅ Links (with optional printed URLs) and images (embedded as data URIs)
- ✅ Ordered, unordered, task, and definition lists
- ✅ Code blocks with syntax highlighting (long lines wrap)
- ✅ Tables (wide tables wrap or shrink to fit)
- ✅ Blockquotes and GitHub-style alerts/callouts
- ✅ Collapsible `<details>` (auto-expanded)
- ✅ Mermaid diagrams and KaTeX math
- ✅ Footnotes, table of contents, emoji, abbreviations
- ✅ Raw HTML, horizontal rules, ASCII diagrams

## 🐛 Known Issues

- Very large files (tens of thousands of lines) and documents with many Mermaid diagrams take longer to convert. If you hit a timeout, raise `md-to-pdf.timeout` or set it to `0` to disable the limit. Extremely large documents are also memory-heavy in Chrome — if conversion is very slow, consider splitting them or using **Convert All Markdown in Folder** on per-chapter files.
- Web fonts referenced only by name must be installed locally to render in the PDF

## 📝 Release Notes

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This extension is licensed under the [MIT License](LICENSE).

---

**Enjoy!** If you find this extension useful, please consider leaving a ⭐️ review on the marketplace.
