// Privacy step of the document parser: personal data is replaced with placeholders BEFORE a document's text leaves for the model, and
// the placeholders are swapped back in what the model returns. The model never sees a tenant's name, phone number or email.
//
// What is hidden: email addresses, phone numbers, SSN-shaped numbers, and tenant / lessee / resident names. Names are found three ways:
//   1. names the caller already knows (the deal's own tenants), matched anywhere in the text;
//   2. labelled fields ("Tenant: Jane Doe", "Lessee - Acme LLC");
//   3. the cells under a tenant-like column header in a table (rent rolls, as CSV, tab, pipe or spaced columns).
// A name that is in none of those places (a signature block, a sentence naming a stranger) can be missed. The report says how many were
// hidden so the review screen can show it, and the caller should pass every name it knows.
//
// Pure (no imports), shared by the edge function and the tests.

export interface RedactionReport {
  emails: number;
  phones: number;
  ids: number;
  names: number;
}

export interface Redaction {
  /** The text that is safe to send. */
  text: string;
  report: RedactionReport;
  /** Swaps name placeholders back to the original names in a string the model returned. */
  restore: (s: string) => string;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
// 3-3-4 digits with separators, optionally with a country code and parentheses: (509) 555-1234, 509.555.1234, +1 509 555 1234
const PHONE = /(?<![\d.])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\d])/g;
// A run of ten digits is only a phone when a label says so (otherwise it could be a parcel number)
const LABELLED_PHONE = /\b(tel|telephone|phone|cell|mobile|fax|contact)\b(\s*(?:no\.?|number|#)?\s*[:#-]?\s*)(\+?1?\d{10})\b/gi;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

const NAME_LABEL = /^\s*(?:tenant(?:\s+name)?|lessee|resident|occupant|renter|guarantor|co-?signer|signed by|print(?:ed)? name)\s*[:\-–]\s*(.+?)\s*$/i;
const NAME_HEADER = /^(?:tenant(?:\s+name)?|tenant\(s\)|lessee|resident(?:\s+name)?|occupant|renter|name)$/i;
// Cells that sit under a name header but are not a person or company
const NOT_A_NAME = /^(?:vacant|vacancy|n\/?a|none|unit|total|totals|subtotal|owner|model|office|storage|admin|down|—|-|–|)$/i;

function splitRow(line: string): string[] {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if (line.includes('|')) return line.split('|').map((c) => c.trim());
  if (line.includes(',')) {
    const cells: string[] = [];
    let cur = '';
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === ',' && !quoted) {
        cells.push(cur.trim());
        cur = '';
      } else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }
  return line.split(/\s{2,}/).map((c) => c.trim());
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every name the document labels or tabulates as a tenant, plus the names the caller supplied. */
export function findNames(text: string, known: string[] = []): string[] {
  const found = new Set<string>();
  const add = (raw: string) => {
    const n = raw.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ');
    if (n.length >= 2 && n.length <= 80 && !NOT_A_NAME.test(n) && !/^[\d$.,%\s-]+$/.test(n)) found.add(n);
  };
  for (const k of known) add(k);

  const lines = text.split(/\r?\n/);
  let nameCol = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const labelled = NAME_LABEL.exec(line);
    if (labelled) {
      // "Tenant: Jane Doe    Unit: 4B" keeps only the name part
      add(labelled[1].split(/\s{3,}|\t|\||;/)[0]);
      continue;
    }
    const cells = splitRow(line);
    if (cells.length >= 3) {
      const idx = cells.findIndex((c) => NAME_HEADER.test(c.replace(/["*]/g, '').trim()));
      // A header row: remember which column holds names. A later header row (a second table) replaces it.
      if (idx >= 0 && cells.every((c) => !/^[\d$.,%-]+$/.test(c))) {
        nameCol = idx;
        continue;
      }
      if (nameCol >= 0 && nameCol < cells.length) add(cells[nameCol]);
    } else if (line.trim() === '') nameCol = -1;
  }
  return [...found].sort((a, b) => b.length - a.length); // longest first so "Jane Doe Jr" goes before "Jane Doe"
}

export function redactForModel(input: string, opts: { knownNames?: string[] } = {}): Redaction {
  const report: RedactionReport = { emails: 0, phones: 0, ids: 0, names: 0 };
  const placeholders = new Map<string, string>(); // placeholder -> original name
  let text = input;

  const names = findNames(input, opts.knownNames ?? []);
  names.forEach((name, i) => {
    const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(name).replace(/\\? /g, '\\s+')}(?![A-Za-z0-9])`, 'gi');
    const token = `[TENANT_${i + 1}]`;
    let hit = false;
    text = text.replace(re, () => {
      hit = true;
      return token;
    });
    if (hit) {
      placeholders.set(token, name);
      report.names += 1;
    }
  });

  text = text.replace(EMAIL, () => {
    report.emails += 1;
    return '[EMAIL]';
  });
  text = text.replace(LABELLED_PHONE, (_m, label: string, sep: string) => {
    report.phones += 1;
    return `${label}${sep}[PHONE]`;
  });
  text = text.replace(PHONE, () => {
    report.phones += 1;
    return '[PHONE]';
  });
  text = text.replace(SSN, () => {
    report.ids += 1;
    return '[ID]';
  });

  const restore = (s: string): string => {
    let out = s;
    for (const [token, name] of placeholders) out = out.split(token).join(name);
    return out;
  };
  return { text, report, restore };
}
