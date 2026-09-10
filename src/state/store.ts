import { create } from 'zustand';
import { DEFAULT_WATERMARK_CONFIG, type WatermarkConfig } from '../core/watermarkConfig';

const STORAGE_KEY = 'easy-watermark:config';

function loadPersistedConfig(): WatermarkConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_WATERMARK_CONFIG;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_WATERMARK_CONFIG, ...parsed };
  } catch {
    return DEFAULT_WATERMARK_CONFIG;
  }
}

function persistConfig(config: WatermarkConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // localStorage unavailable (private mode, quota, etc.) — silently skip persistence.
  }
}

export type FileStatus = 'loading' | 'ready' | 'encrypted' | 'error';

export interface FileEntry {
  id: string;
  file: File;
  name: string;
  size: number;
  pageCount: number | null;
  status: FileStatus;
  errorMessage?: string;
  checked: boolean;
  /** Cached original bytes, read once per file. Never mutated. */
  bytes: ArrayBuffer;
}

interface WatermarkStore {
  files: FileEntry[];
  selectedId: string | null;
  config: WatermarkConfig;

  addFiles: (entries: FileEntry[]) => void;
  removeFile: (id: string) => void;
  selectFile: (id: string) => void;
  toggleChecked: (id: string) => void;
  setFileStatus: (id: string, status: FileStatus, extra?: { pageCount?: number; errorMessage?: string }) => void;
  setConfig: (patch: Partial<WatermarkConfig>) => void;
  resetConfig: () => void;
}

export const useWatermarkStore = create<WatermarkStore>((set, get) => ({
  files: [],
  selectedId: null,
  config: loadPersistedConfig(),

  addFiles: (entries) =>
    set((state) => {
      const files = [...state.files, ...entries];
      const selectedId = state.selectedId ?? entries[0]?.id ?? null;
      return { files, selectedId };
    }),

  removeFile: (id) =>
    set((state) => {
      const files = state.files.filter((f) => f.id !== id);
      let selectedId = state.selectedId;
      if (selectedId === id) {
        selectedId = files[0]?.id ?? null;
      }
      return { files, selectedId };
    }),

  selectFile: (id) => set({ selectedId: id }),

  toggleChecked: (id) =>
    set((state) => ({
      files: state.files.map((f) => (f.id === id ? { ...f, checked: !f.checked } : f)),
    })),

  setFileStatus: (id, status, extra) =>
    set((state) => ({
      files: state.files.map((f) =>
        f.id === id
          ? { ...f, status, pageCount: extra?.pageCount ?? f.pageCount, errorMessage: extra?.errorMessage ?? f.errorMessage }
          : f,
      ),
    })),

  setConfig: (patch) => {
    const next = { ...get().config, ...patch };
    persistConfig(next);
    set({ config: next });
  },

  resetConfig: () => {
    persistConfig(DEFAULT_WATERMARK_CONFIG);
    set({ config: DEFAULT_WATERMARK_CONFIG });
  },
}));
