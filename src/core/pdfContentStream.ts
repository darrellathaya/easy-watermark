// Reading and rewriting page content streams, shared by the taggedand
// legacy watermark strippers.
//
// Latin-1 is used throughout to move between bytes and strings: it maps one
// byte to one char, so string offsets stay byte-exact and slicing a span out
// of a stream can't corrupt the bytes around it.

import { PDFArray, PDFName, PDFRawStream, decodePDFRawStream, type PDFDocument } from 'pdf-lib';

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  // Chunked, since spreading a multi-megabyte array overflows the stack.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/**
 * The decoded content of one page as a single string, or null if any of its
 * streams can't be decoded.
 *
 * A page's Contents may be an array of streams, which PDF treats as one
 * logical stream split at arbitrary points (even mid-token), so they are
 * joined with whitespace before anything scans them.
 */
export function readPageContent(pdfDoc: PDFDocument, pageIndex: number): string | null {
  const contents = pdfDoc.getPages()[pageIndex].node.Contents();
  if (!contents) return null;

  const streams =
    contents instanceof PDFArray ? contents.asArray().map((ref) => pdfDoc.context.lookup(ref)) : [contents];

  const parts: string[] = [];
  for (const stream of streams) {
    if (!(stream instanceof PDFRawStream)) return null;
    try {
      parts.push(bytesToLatin1(decodePDFRawStream(stream).decode()));
    } catch {
      // An undecodable filter (or a broken stream) means hands off this page.
      return null;
    }
  }
  return parts.join('\n');
}

/**
 * Replaces a page's content with `content`, collapsing any stream array into
 * one stream.
 *
 * Must run before anything draws on the page: pdf-lib queues its drawing in a
 * content stream of its own, which this would discard.
 */
export function writePageContent(pdfDoc: PDFDocument, pageIndex: number, content: string): void {
  const replacement = pdfDoc.context.flateStream(latin1ToBytes(content));
  pdfDoc.getPages()[pageIndex].node.set(PDFName.of('Contents'), pdfDoc.context.register(replacement));
}

/**
 * Walks a content stream yielding operator tokens, skipping over string
 * literals, hex strings, names and comments so their contents can never be
 * mistaken for operators. `(quick)` must not read as a `q`.
 */
export function* scanOperators(content: string): Generator<{ op: string; start: number; end: number }> {
  let i = 0;
  while (i < content.length) {
    const ch = content[i];

    if (ch === '(') {
      // Literal string: nested parens count, backslash escapes the next char.
      let depth = 1;
      i++;
      while (i < content.length && depth > 0) {
        if (content[i] === '\\') i += 2;
        else if (content[i] === '(') { depth++; i++; }
        else if (content[i] === ')') { depth--; i++; }
        else i++;
      }
      continue;
    }

    if (ch === '<' && content[i + 1] !== '<') {
      const close = content.indexOf('>', i);
      i = close === -1 ? content.length : close + 1;
      continue;
    }

    if (ch === '/') {
      i++;
      while (i < content.length && /[^\s/[\]<>(){}%]/.test(content[i])) i++;
      continue;
    }

    if (ch === '%') {
      while (i < content.length && content[i] !== '\n' && content[i] !== '\r') i++;
      continue;
    }

    if (/[A-Za-z'"*]/.test(ch)) {
      const start = i;
      while (i < content.length && /[A-Za-z0-9'"*]/.test(content[i])) i++;
      yield { op: content.slice(start, i), start, end: i };
      continue;
    }

    i++;
  }
}

/**
 * Spans of every balanced `q ... Q` block, at any nesting depth.
 *
 * Nested blocks matter: pdf-lib wraps a page's existing content in an outer
 * `q ... Q` pair when it appends to it, so after one round trip everything
 * original sits one level down. Scanning only the outermost blocks would see
 * a single giant block and miss what's inside. An unbalanced `Q` is ignored
 * rather than throwing the rest of the page off.
 */
export function allSaveBlocks(content: string): Array<[number, number]> {
  const blocks: Array<[number, number]> = [];
  const open: number[] = [];

  for (const token of scanOperators(content)) {
    if (token.op === 'q') {
      open.push(token.start);
    } else if (token.op === 'Q') {
      const start = open.pop();
      if (start !== undefined) blocks.push([start, token.end]);
    }
  }

  return blocks;
}
