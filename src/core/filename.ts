// {name}/{date} token expansion for the export filename pattern (spec §6, §5 Output).

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

export function expandFilenamePattern(pattern: string, originalFileName: string): string {
  const name = stripExtension(originalFileName);
  const expanded = pattern
    .replaceAll('{name}', name)
    .replaceAll('{date}', todayIso())
    .trim();
  const safe = expanded.length > 0 ? expanded : `${name}_watermarked`;
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}
