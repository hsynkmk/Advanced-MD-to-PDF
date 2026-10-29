/**
 * Per-conversion option overrides and their `pdf:` front-matter source.
 * Free of `vscode` imports so it can be unit-tested.
 */

import { extractFrontMatter, FrontMatter, ThemeName, THEMES } from './markdown';
import { PageFormat, PAGE_FORMATS, PdfMargins } from './page';

/** Per-conversion overrides applied on top of the saved configuration. */
export interface ConversionOverrides {
  theme?: ThemeName;
  format?: PageFormat;
  landscape?: boolean;
  margins?: Partial<PdfMargins>;
  toc?: boolean;
}

function isMap(v: unknown): v is FrontMatter {
  return typeof v === 'object' && v !== null;
}

/**
 * Per-document overrides from a `pdf:` front-matter block, e.g.
 *
 *     ---
 *     pdf:
 *       theme: academic
 *       format: Letter
 *       landscape: true
 *       margins: 20mm          # or a map with top/right/bottom/left
 *       toc: false
 *     ---
 */
export function frontMatterOverrides(markdown: string): ConversionOverrides {
  const pdf = extractFrontMatter(markdown).pdf;
  const out: ConversionOverrides = {};
  if (!isMap(pdf)) { return out; }

  if (typeof pdf.theme === 'string' && (THEMES as readonly string[]).includes(pdf.theme)) {
    out.theme = pdf.theme as ThemeName;
  }
  const format = pdf.format ?? pdf.pageFormat;
  if (typeof format === 'string') {
    const match = PAGE_FORMATS.find((f) => f.toLowerCase() === format.toLowerCase());
    if (match) { out.format = match; }
  }
  if (typeof pdf.landscape === 'boolean') { out.landscape = pdf.landscape; }
  if (typeof pdf.orientation === 'string') { out.landscape = pdf.orientation.toLowerCase() === 'landscape'; }
  if (typeof pdf.margins === 'string' || typeof pdf.margins === 'number') {
    const m = String(pdf.margins);
    out.margins = { top: m, right: m, bottom: m, left: m };
  } else if (isMap(pdf.margins)) {
    const margins: Partial<PdfMargins> = {};
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      const v = pdf.margins[side];
      if (typeof v === 'string' || typeof v === 'number') { margins[side] = String(v); }
    }
    out.margins = margins;
  }
  if (typeof pdf.toc === 'boolean') { out.toc = pdf.toc; }
  return out;
}

/** Layer explicit overrides (toolbar / quick pick) on top of lower-priority ones (front matter). */
export function mergeOverrides(base: ConversionOverrides, top?: ConversionOverrides): ConversionOverrides {
  const out: ConversionOverrides = { ...base };
  if (!top) { return out; }
  if (top.theme !== undefined) { out.theme = top.theme; }
  if (top.format !== undefined) { out.format = top.format; }
  if (top.landscape !== undefined) { out.landscape = top.landscape; }
  if (top.toc !== undefined) { out.toc = top.toc; }
  if (top.margins) { out.margins = { ...base.margins, ...top.margins }; }
  return out;
}
