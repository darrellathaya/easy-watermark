import { useCallback } from 'react';
import { useWatermarkStore, type FileEntry } from './store';
import { getOrLoadDocument } from '../core/docCache';
import { PasswordProtectedError } from '../core/pdfjs';

/** Shared file-drop/pick ingestion: reads bytes, adds to the store, then validates async. */
export function useFileIngest() {
  const addFiles = useWatermarkStore((s) => s.addFiles);
  const setFileStatus = useWatermarkStore((s) => s.setFileStatus);

  return useCallback(
    async (fileList: FileList | File[]) => {
      const pdfFiles = Array.from(fileList).filter(
        (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'),
      );
      if (pdfFiles.length === 0) return;

      const entries: FileEntry[] = await Promise.all(
        pdfFiles.map(async (file) => ({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          pageCount: null,
          status: 'loading' as const,
          checked: true,
          bytes: await file.arrayBuffer(),
        })),
      );

      addFiles(entries);

      for (const entry of entries) {
        getOrLoadDocument(entry.id, entry.bytes, entry.name)
          .then((doc) => {
            setFileStatus(entry.id, 'ready', { pageCount: doc.numPages });
          })
          .catch((err) => {
            if (err instanceof PasswordProtectedError) {
              setFileStatus(entry.id, 'encrypted', { errorMessage: err.message });
            } else {
              setFileStatus(entry.id, 'error', { errorMessage: err instanceof Error ? err.message : String(err) });
            }
          });
      }
    },
    [addFiles, setFileStatus],
  );
}
