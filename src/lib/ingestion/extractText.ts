/**
 * Turns a file into plain text in the browser, so the text (never the file) is what goes to the document reader. A PDF's text layer is
 * rebuilt into lines and columns: pieces on the same baseline become one line, and a wide gap between pieces becomes a tab, which keeps a
 * rent roll's columns apart (the redaction step finds the tenant column from those tabs).
 *
 * A page with no usable text layer (a table pasted in as a picture, or a font whose text comes out as symbols) is read by OCR in the browser,
 * so it becomes text like any other and goes through the same redaction. The picture itself is never sent anywhere. A page that is only a
 * photograph yields no words and is reported as not read. A PDF with no text at all is still refused: it is a scan, and the owner is told so.
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

/**
 * Joins the pages' text, dropping the running headers and footers a brochure repeats on every page ("Confidential", a broker's name, page
 * titles). Only plain lines are dropped, never table rows (a line with a tab), so a rent roll keeps its header and its rows. Pages are
 * joined without a blank line so a table that runs across pages stays one table. Each page starts with `--- Page N ---`, which is how a figure
 * is traced back to its page.
 */
export function joinPages(pages: string[]): string {
  const seen = new Map<string, number>();
  for (const page of pages) for (const line of new Set(page.split('\n').map((l) => l.trim()))) if (line) seen.set(line, (seen.get(line) ?? 0) + 1);
  const repeated = (line: string) => !line.includes('\t') && line.length < 90 && (seen.get(line.trim()) ?? 0) >= Math.max(3, pages.length / 2);
  return pages.map((p, i) => [`--- Page ${i + 1} ---`, ...p.split('\n').filter((l) => !repeated(l))].join('\n')).join('\n');
}

export const MAX_PDF_PAGES = 60;

/** A page with fewer letters and digits than this has no text layer worth trusting (a footer and a title only). */
const MIN_PAGE_CHARS = 120;
/** OCR reads a page rendered at this multiple of the PDF's own size. */
const OCR_SCALE = 2;
/** OCR words below this confidence are noise (a photograph read as letters) and are dropped. */
const OCR_MIN_CONFIDENCE = 60;
/** More than this share of symbols outside plain text means the font's encoding is broken ("Offering" read as "Offe ed a¶"). */
const GARBLED_SHARE = 0.015;
/** Characters real prose uses beyond ASCII (curly quotes, dashes, bullets, registered and degree signs, ellipsis). */
const ORDINARY_SYMBOLS = /[‘’“”–—•®©°§ …]/g;

const lettersAndDigits = (text: string): number => text.replace(/[^A-Za-z0-9]/g, '').length;

/** Whether a page's text layer is missing or unusable, so the page has to be read from its picture. */
export function needsReading(pageText: string): 'empty' | 'garbled' | null {
  if (lettersAndDigits(pageText) < MIN_PAGE_CHARS) return 'empty';
  const body = pageText.replace(/\s/g, '').replace(ORDINARY_SYMBOLS, '');
  const odd = body.replace(/[\x20-\x7e]/g, '').length;
  return body.length > 0 && odd / body.length > GARBLED_SHARE ? 'garbled' : null;
}

interface OcrWord {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/** OCR words as the pieces `linesFromPieces` rebuilds into rows and columns: top-down pixels become PDF-style units (y up). */
export function piecesFromWords(words: OcrWord[], scale = OCR_SCALE): TextPiece[] {
  return words
    .filter((w) => w.confidence >= OCR_MIN_CONFIDENCE && w.text.trim() !== '')
    .map((w) => ({ str: w.text, x: w.bbox.x0 / scale, y: -((w.bbox.y0 + w.bbox.y1) / 2) / scale, width: (w.bbox.x1 - w.bbox.x0) / scale }));
}

/** A PDF's text, and what the owner should know about how it was read. */
export interface PdfRead {
  text: string;
  /** Plain sentences about pages read from their picture, or that could not be read. */
  notes: string[];
}

type PdfPage = import('pdfjs-dist').PDFPageProxy;
type OcrWorker = import('tesseract.js').Worker;

/** Renders one page and reads it with OCR, in this browser; nothing is uploaded. Null when it holds no words (a photograph). */
async function readPageByOcr(page: PdfPage, worker: OcrWorker): Promise<string | null> {
  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvas, viewport }).promise;
  const { data } = await worker.recognize(canvas, {}, { blocks: true });
  const words = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  const text = linesFromPieces(piecesFromWords(words));
  return lettersAndDigits(text) >= 20 ? text : null;
}

const pageList = (pages: number[]) => (pages.length === 1 ? `Page ${pages[0]}` : `Pages ${pages.join(', ')}`);

export class ScannedPdfError extends Error {
  constructor() {
    super('This PDF has no text in it (it looks like a scan). Export a text version from the source, or type the figures in Edit Inputs.');
    this.name = 'ScannedPdfError';
  }
}

export async function extractPdfRead(file: File): Promise<PdfRead> {
  // Loaded only when a PDF is read, so it is not part of the main bundle
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const out: string[] = [];
    const weak: Array<{ n: number; page: PdfPage; why: 'empty' | 'garbled' }> = [];
    for (let n = 1; n <= pages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const pieces: TextPiece[] = [];
      for (const item of content.items) {
        if ('str' in item) pieces.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width });
      }
      const text = linesFromPieces(pieces);
      out.push(text);
      const why = needsReading(text);
      if (why) weak.push({ n, page, why });
    }

    const notes: string[] = [];
    // Pages with no usable text layer are read from their picture. The OCR engine and its language data are large, so they load only then.
    if (weak.length) {
      const pictured: number[] = [];
      const garbled: number[] = [];
      const notRead: number[] = [];
      let ocr: OcrWorker | null = null;
      try {
        const { createWorker } = await import('tesseract.js');
        ocr = await createWorker('eng');
        for (const w of weak) {
          const text = await readPageByOcr(w.page, ocr);
          // Only a page that gives back real text replaces the original: a photograph read as scraps of letters does not
          if (text && lettersAndDigits(text) >= MIN_PAGE_CHARS) { out[w.n - 1] = text; (w.why === 'garbled' ? garbled : pictured).push(w.n); }
          else if (w.why === 'empty') notRead.push(w.n);
        }
      } catch {
        // The OCR engine could not load (offline, blocked): the pages are reported below, and the pages with text are still read
        for (const w of weak) if (!pictured.includes(w.n) && !garbled.includes(w.n) && !notRead.includes(w.n)) notRead.push(w.n);
      } finally {
        void ocr?.terminate();
      }
      if (pictured.length) notes.push(`${pageList(pictured)} had no text, so ${pictured.length === 1 ? 'it was' : 'they were'} read from the picture. Check those figures against the document.`);
      if (garbled.length) notes.push(`${pageList(garbled)} had garbled text, so ${garbled.length === 1 ? 'it was' : 'they were'} read again from the picture.`);
      if (notRead.length) notes.push(`${pageList(notRead)} could not be read (photos, or pictures with no text). If ${notRead.length === 1 ? 'it holds' : 'they hold'} figures, type them in.`);
    }

    const text = joinPages(out);
    if (text.replace(/\s/g, '').length < 20 * pages) throw new ScannedPdfError();
    if (pdf.numPages > pages) return { text: `${text}\n\n[Only the first ${pages} of ${pdf.numPages} pages were read.]`, notes };
    return { text, notes };
  } finally {
    void task.destroy();
  }
}

export async function extractPdfText(file: File): Promise<string> {
  return (await extractPdfRead(file)).text;
}

export const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt', '.md'];
export const READABLE_EXTENSIONS = [...TEXT_EXTENSIONS, '.pdf'];

export function isReadableFile(name: string): boolean {
  const lower = name.toLowerCase();
  return READABLE_EXTENSIONS.some((e) => lower.endsWith(e));
}

/** The file's text, whichever supported kind it is, and what the owner should know about how it was read. */
export async function extractFileRead(file: File): Promise<PdfRead> {
  return file.name.toLowerCase().endsWith('.pdf') ? extractPdfRead(file) : { text: await file.text(), notes: [] };
}

/** The file's text, whichever supported kind it is. */
export async function extractFileText(file: File): Promise<string> {
  return (await extractFileRead(file)).text;
}
