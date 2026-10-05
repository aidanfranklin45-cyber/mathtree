/**
 * Turns a file into plain text in the browser, so the text (never the file) is what goes to the document reader. A PDF's text layer is
 * rebuilt into lines and columns: pieces on the same baseline become one line, and a wide gap between pieces becomes a tab, which keeps a
 * rent roll's columns apart (the redaction step finds the tenant column from those tabs).
 *
 * A scanned PDF (pictures of pages, no text layer) has nothing to read. It is refused with a plain message rather than guessed at: reading
 * it would need OCR, and a picture cannot have tenant names hidden before it is sent.
 */

export interface TextPiece {
  str: string;
  /** Left edge and baseline, in PDF units. */
  x: number;
  y: number;
  width: number;
}

const SAME_LINE = 3; // baselines closer than this (PDF units) are one line
const COLUMN_GAP = 12; // a gap wider than this between pieces is a column break

/** One page's pieces as text lines, top to bottom, with tabs between columns. */
export function linesFromPieces(pieces: TextPiece[]): string {
  const real = pieces.filter((p) => p.str.trim() !== '');
  real.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextPiece[][] = [];
  for (const p of real) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - p.y) <= SAME_LINE) line.push(p);
    else lines.push([p]);
  }
  return lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      let out = '';
      let prevEnd = 0;
      line.forEach((p, i) => {
        if (i > 0) {
          const gap = p.x - prevEnd;
          out += gap > COLUMN_GAP ? '\t' : gap > 1 ? ' ' : '';
        }
        out += p.str.trim();
        prevEnd = p.x + p.width;
      });
      return out;
    })
    .join('\n');
}

export const MAX_PDF_PAGES = 60;

export class ScannedPdfError extends Error {
  constructor() {
    super('This PDF has no text in it (it looks like a scan). Export a text version from the source, or type the figures in Edit Inputs.');
    this.name = 'ScannedPdfError';
  }
}

export async function extractPdfText(file: File): Promise<string> {
  // Loaded only when a PDF is read, so it is not part of the main bundle
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const out: string[] = [];
    for (let n = 1; n <= pages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const item of content.items) {
        if ('str' in item) pieces.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
      }
      out.push(linesFromPieces(pieces));
    }
    const text = out.join('\n\n');
    if (text.replace(/\s/g, '').length < 20 * pages) throw new ScannedPdfError();
    return pdf.numPages > pages ? `${text}\n\n[Only the first ${pages} of ${pdf.numPages} pages were read.]` : text;
  } finally {
    void task.destroy();
  }
}

export const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt', '.md'];
export const READABLE_EXTENSIONS = [...TEXT_EXTENSIONS, '.pdf'];

export function isReadableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return READABLE_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** The file's text, whichever supported kind it is. */
export async function extractFileText(file: File): Promise<string> {
  return file.name.toLowerCase().endsWith('.pdf') ? extractPdfText(file) : file.text();
}
