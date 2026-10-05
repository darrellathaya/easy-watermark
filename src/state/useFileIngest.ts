import { useCallback } from 'react';
import { useWatermarkStore, type FileEntry, type FileKind } from './store';
import { getOrLoadDocument } from '../core/docCache';
import { getOrDecodeImage } from '../core/imageCache';
import { ImageDecodeError, imageMimeType, isImageFile } from '../core/imageWatermark';
import { PasswordProtectedError } from '../core/pdfjs';
import { probeWatermarks } from '../core/watermarkProbe';

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

function fileKind(file: File): FileKind | null {
  if (isPdfFile(file)) return 'pdf';
  if (isImageFile(file)) return 'image';
  return null;
}

/** Shared drag-drop/file-picker ingestion for PDFs and images: reads bytes, adds to the store, then validates async. */
export function useFileIngest() {
  const addFiles = useWatermarkStore((s) => s.addFiles);
  const setFileStatus = useWatermarkStore((s) => s.setFileStatus);

  return useCallback(
    async (fileList: FileList | File[]) => {
      const accepted = Array.from(fileList)
        .map((file) => ({ file, kind: fileKind(file) }))
        .filter((candidate): candidate is { file: File; kind: FileKind } => candidate.kind !== null);
      if (accepted.length === 0) return;

      const entries: FileEntry[] = await Promise.all(
        accepted.map(async ({ file, kind }) => ({
          id: crypto.randomUUID(),
          file,
          name: file.name,
          size: file.size,
          kind,
          mimeType: kind === 'pdf' ? 'application/pdf' : imageMimeType(file),
          pageCount: kind === 'image' ? 1 : null,
          status: 'loading' as const,
          checked: true,
          bytes: await file.arrayBuffer(),
        })),
      );

      addFiles(entries);

      for (const entry of entries) {
        if (entry.kind === 'image') {
          getOrDecodeImage(entry.id, entry.bytes, entry.mimeType, entry.name)
            .then((bitmap) => {
              setFileStatus(entry.id, 'ready', {
                pageCount: 1,
                imageSize: { width: bitmap.width, height: bitmap.height },
              });
            })
            .catch((err) => {
              setFileStatus(entry.id, 'error', {
                errorMessage:
                  err instanceof ImageDecodeError
                    ? err.message
                    : err instanceof Error
                      ? err.message
                      : String(err),
              });
            });
          continue;
        }

        getOrLoadDocument(entry.id, entry.bytes, entry.name)
          .then(async (doc) => {
            // Probe for a watermark this app stamped earlier, so the UI can
            // say it will be replaced rather than stacked. A second parse,
            // but only for PDFs and only once per file.
            // One pdf-lib parse answers both questions: is there a tagged
            // watermark to replace, or an untagged one from an older version.
            const { stamp, legacy } = await probeWatermarks(entry.bytes);
            setFileStatus(entry.id, 'ready', {
              pageCount: doc.numPages,
              stamp,
              legacy: legacy ?? undefined,
            });
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
