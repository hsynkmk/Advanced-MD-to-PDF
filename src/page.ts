/**
 * Page geometry shared by PDF generation and the live preview (no `vscode`
 * dependency so it is unit-testable).
 */

export type PageFormat = 'A4' | 'Letter' | 'Legal' | 'A3' | 'A5' | 'A6' | 'Tabloid';

export const PAGE_FORMATS: readonly PageFormat[] = ['A4', 'Letter', 'Legal', 'A3', 'A5', 'A6', 'Tabloid'];

export interface PdfMargins {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export const DEFAULT_MARGINS: PdfMargins = {
  top: '15mm',
  right: '15mm',
  bottom: '15mm',
  left: '15mm',
};

/** Portrait page sizes in millimetres (width × height), matching Chrome's formats. */
export const PAGE_SIZES_MM: Record<PageFormat, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  Tabloid: [279.4, 431.8],
};

const PX_PER_UNIT: Record<string, number> = {
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  pt: 96 / 72,
  pc: 16,
};

/** Convert a CSS length ('15mm', '0.5in', '20px', bare number = px) to CSS pixels. */
export function cssLengthToPx(value: string | number | undefined, fallbackPx = 0): number {
  if (typeof value === 'number') { return Number.isFinite(value) ? value : fallbackPx; }
  const m = /^\s*(-?\d*\.?\d+)\s*([a-z]*)\s*$/i.exec(value ?? '');
  if (!m) { return fallbackPx; }
  const factor = PX_PER_UNIT[(m[2] || 'px').toLowerCase()];
  return factor === undefined ? fallbackPx : parseFloat(m[1]) * factor;
}

/** Fill in any missing sides from the defaults (settings may specify only some). */
export function normalizeMargins(margins: Partial<PdfMargins> | string | undefined): PdfMargins {
  if (typeof margins === 'string') {
    return { top: margins, right: margins, bottom: margins, left: margins };
  }
  const out = { ...DEFAULT_MARGINS };
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const v = margins?.[side];
    if (typeof v === 'string' && v.trim()) { out[side] = v.trim(); }
    else if (typeof v === 'number') { out[side] = `${v}px`; }
  }
  return out;
}

export interface PageGeometry {
  /** Full page width/height in CSS px. */
  pageWidth: number;
  pageHeight: number;
  /** Width available to content (page width minus left/right margins), in CSS px, before `scale`. */
  contentWidth: number;
}

export function pageGeometry(format: PageFormat, landscape: boolean, margins: PdfMargins, scale = 1): PageGeometry {
  const [wMm, hMm] = PAGE_SIZES_MM[format] ?? PAGE_SIZES_MM.A4;
  const mm = PX_PER_UNIT.mm;
  const pageWidth = (landscape ? hMm : wMm) * mm;
  const pageHeight = (landscape ? wMm : hMm) * mm;
  const content = pageWidth - cssLengthToPx(margins.left) - cssLengthToPx(margins.right);
  // Chrome lays the document out at (content width / scale) so it fits once scaled.
  return { pageWidth, pageHeight, contentWidth: Math.max(50, content / (scale || 1)) };
}
