// pdf.js is imported from its *legacy* bundle (see core/pdfjs.ts for why).
// That deep path ships no type declarations of its own, and the package has
// no exports map, so point it at the package's own types: the two bundles
// expose the same API and differ only in transpilation and polyfills.
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist';
}
