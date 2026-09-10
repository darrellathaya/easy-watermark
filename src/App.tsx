import { useEffect } from 'react';
import { AppShell } from './components/AppShell';
import { FONTS, loadFontFace } from './core/fonts';

export default function App() {
  // Preload every bundled font's FontFace up front so the font <Select>
  // can render each option in its own typeface as soon as it's opened.
  useEffect(() => {
    FONTS.forEach((f) => {
      loadFontFace(f.id).catch(() => {
        // Ignore — the select falls back to its default font for this option.
      });
    });
  }, []);

  return <AppShell />;
}
