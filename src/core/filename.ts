// {name}/{date} token expansion for the export filename pattern (spec §6, §5 Output).

/** Extensions this app itself reads or writes, for stray-extension cleanup. */
const KNOWN_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'] as const;

export function stripExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Expands the user's filename pattern and guarantees the right extension for
 * the exported bytes: `pdf` for a watermarked PDF, `png` for an image (the
 * image path always encodes PNG, whatever went in).
 */
export function expandFilenamePattern(pattern: string, originalFileName: string, extension = 'pdf'): string {
  const name = stripExtension(originalFileName);
  const expanded = pattern
    .replaceAll('{name}', name)
    .replaceAll('{date}', todayIso())
    .trim();
  const safe = expanded.length > 0 ? expanded : `${name}_watermarked`;
  const suffix = `.${extension.replace(/^\./, '').toLowerCase()}`;
  const lower = safe.toLowerCase();
  // Drop an extension of a *different* known format that the pattern carried
  // over from the input, so "{name}" on "photo.jpg" gives "photo.png" and not
  // "photo.jpg.png". Only these extensions, so a name like "report.v2" keeps
  // its dot instead of being treated as an extension.
  const stray = KNOWN_EXTENSIONS.find((ext) => ext !== suffix && lower.endsWith(ext));
  const base = stray ? safe.slice(0, -stray.length) : safe;
  return base.toLowerCase().endsWith(suffix) ? base : `${base}${suffix}`;
}
