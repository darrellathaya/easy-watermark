// Font registry (spec §4): bundled TTFs used for both canvas preview
// measurement and pdf-lib embedding. Each TTF is fetched once and its raw
// bytes cached, since both the preview (FontFace) and the exporter
// (pdfDoc.embedFont) need the same underlying bytes.

export interface FontDef {
  id: string;
  label: string;
  url: string;
}

export const FONTS: FontDef[] = [
  { id: 'inter', label: 'Inter Regular', url: '/fonts/Inter-Regular.ttf' },
  { id: 'inter-bold', label: 'Inter Bold', url: '/fonts/Inter-Bold.ttf' },
  { id: 'roboto', label: 'Roboto Regular', url: '/fonts/Roboto-Regular.ttf' },
  { id: 'noto-serif', label: 'Noto Serif Regular', url: '/fonts/NotoSerif-Regular.ttf' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono Regular', url: '/fonts/JetBrainsMono-Regular.ttf' },
];

export const DEFAULT_FONT_ID = FONTS[0].id;

export function getFontDef(id: string): FontDef {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

// Module-level cache: font id -> fetched bytes. A Promise is cached (not
// just the resolved value) so concurrent callers await the same fetch
// instead of firing duplicate requests.
const bytesCache = new Map<string, Promise<ArrayBuffer>>();

export function loadFontBytes(id: string): Promise<ArrayBuffer> {
  const cached = bytesCache.get(id);
  if (cached) return cached;

  const def = getFontDef(id);
  const promise = fetch(def.url).then((res) => {
    if (!res.ok) throw new Error(`Failed to load font "${def.label}" from ${def.url}`);
    return res.arrayBuffer();
  });
  // Don't cache a rejected fetch — allow retry on the next call.
  promise.catch(() => bytesCache.delete(id));
  bytesCache.set(id, promise);
  return promise;
}

// Preview: register a bundled TTF as a CSS FontFace so canvas
// measureText()/fillText() use the exact same glyph outlines as the export.
const faceCache = new Map<string, Promise<FontFace>>();

export function loadFontFace(id: string): Promise<FontFace> {
  const cached = faceCache.get(id);
  if (cached) return cached;

  const def = getFontDef(id);
  const promise = loadFontBytes(id).then(async (bytes) => {
    // FontFace needs its own copy of the bytes; sharing the cached buffer
    // with pdf-lib (which may mutate/consume it) would be unsafe.
    const face = new FontFace(cssFamilyName(def.id), bytes.slice(0));
    await face.load();
    document.fonts.add(face);
    return face;
  });
  promise.catch(() => faceCache.delete(id));
  faceCache.set(id, promise);
  return promise;
}

export function cssFamilyName(id: string): string {
  return `ew-${id}`;
}
