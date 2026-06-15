# Changelog

All notable changes to the "Advanced MD to PDF" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.1.html).

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