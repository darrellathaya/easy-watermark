import { describe, expect, it } from 'vitest';
import { expandFilenamePattern, stripExtension } from './filename';

describe('stripExtension', () => {
  it('drops a trailing extension but keeps a leading-dot name', () => {
    expect(stripExtension('report.pdf')).toBe('report');
    expect(stripExtension('photo.final.jpg')).toBe('photo.final');
    expect(stripExtension('noextension')).toBe('noextension');
    expect(stripExtension('.gitignore')).toBe('.gitignore');
  });
});

describe('expandFilenamePattern', () => {
  it('expands {name} from the input filename, without its extension', () => {
    expect(expandFilenamePattern('{name}_watermarked', 'report.pdf')).toBe('report_watermarked.pdf');
    expect(expandFilenamePattern('{name}_watermarked', 'photo.jpg', 'png')).toBe('photo_watermarked.png');
  });

  it('expands {date} as an ISO day stamp', () => {
    const out = expandFilenamePattern('{name}-{date}', 'report.pdf');
    expect(out).toMatch(/^report-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('appends the requested extension, defaulting to pdf', () => {
    expect(expandFilenamePattern('stamped', 'a.pdf')).toBe('stamped.pdf');
    expect(expandFilenamePattern('stamped', 'a.png', 'png')).toBe('stamped.png');
  });

  it('does not double up an extension that is already correct, in any case', () => {
    expect(expandFilenamePattern('{name}.pdf', 'report.pdf')).toBe('report.pdf');
    expect(expandFilenamePattern('{name}.PNG', 'photo.jpg', 'png')).toBe('photo.PNG');
  });

  it('replaces a stray extension of another known format', () => {
    // "{name}" on an image yields "photo", but a literal ".jpg" in the pattern
    // (or a pattern echoing the input name) must not survive a PNG export.
    expect(expandFilenamePattern('{name}.jpg', 'photo.jpg', 'png')).toBe('photo.png');
    expect(expandFilenamePattern('{name}.pdf', 'photo.jpg', 'png')).toBe('photo.png');
  });

  it('leaves a dotted name that is not a known extension alone', () => {
    expect(expandFilenamePattern('report.v2', 'a.pdf')).toBe('report.v2.pdf');
  });

  it('falls back to <name>_watermarked when the pattern is empty', () => {
    expect(expandFilenamePattern('', 'report.pdf')).toBe('report_watermarked.pdf');
    expect(expandFilenamePattern('   ', 'photo.png', 'png')).toBe('photo_watermarked.png');
  });
});
