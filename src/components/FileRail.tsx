import { useRef, useState } from 'react';
import { ActionIcon, Box, Button, Checkbox, Group, ScrollArea, Stack, Text, rem } from '@mantine/core';
import { IconFileTypePdf, IconLock, IconTrash, IconUpload } from '@tabler/icons-react';
import { useWatermarkStore, type FileEntry } from '../state/store';
import { useFileIngest } from '../state/useFileIngest';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileRail() {
  const files = useWatermarkStore((s) => s.files);
  const selectedId = useWatermarkStore((s) => s.selectedId);
  const removeFile = useWatermarkStore((s) => s.removeFile);
  const selectFile = useWatermarkStore((s) => s.selectFile);
  const toggleChecked = useWatermarkStore((s) => s.toggleChecked);
  const ingestFiles = useFileIngest();

  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <Stack h="100%" gap="sm" p="sm">
      <Button leftSection={<IconUpload size={16} />} onClick={() => inputRef.current?.click()}>
        Add files
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) ingestFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <Box
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files) ingestFiles(e.dataTransfer.files);
        }}
        style={{
          border: `1px dashed ${dragOver ? 'var(--mantine-color-violet-5)' : 'var(--mantine-color-dark-3)'}`,
          borderRadius: rem(8),
          padding: rem(12),
          textAlign: 'center',
          transition: 'border-color 120ms ease',
          flexShrink: 0,
        }}
      >
        <Text size="xs" c="dimmed">
          Drop PDFs here
        </Text>
      </Box>

      <ScrollArea flex={1}>
        <Stack gap={4}>
          {files.map((f) => (
            <FileRow
              key={f.id}
              entry={f}
              selected={f.id === selectedId}
              onSelect={() => selectFile(f.id)}
              onRemove={() => removeFile(f.id)}
              onToggle={() => toggleChecked(f.id)}
            />
          ))}
          {files.length === 0 && (
            <Text size="xs" c="dimmed" ta="center" mt="md">
              No files yet
            </Text>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
}

function FileRow({
  entry,
  selected,
  onSelect,
  onRemove,
  onToggle,
}: {
  entry: FileEntry;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onToggle: () => void;
}) {
  const isEncrypted = entry.status === 'encrypted';
  const isError = entry.status === 'error';

  return (
    <Group
      gap="xs"
      wrap="nowrap"
      p={6}
      style={{
        borderRadius: rem(6),
        cursor: 'pointer',
        background: selected ? 'var(--mantine-color-dark-5)' : 'transparent',
        opacity: isEncrypted || isError ? 0.6 : 1,
      }}
      onClick={onSelect}
    >
      <Checkbox
        size="xs"
        checked={entry.checked}
        disabled={isEncrypted || isError}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      {isEncrypted ? <IconLock size={18} color="var(--mantine-color-red-5)" /> : <IconFileTypePdf size={18} />}
      <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
        <Text size="xs" fw={500} truncate>
          {entry.name}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {isEncrypted
            ? 'Password-protected — skipped'
            : isError
              ? (entry.errorMessage ?? 'Failed to load')
              : `${formatSize(entry.size)} · ${entry.pageCount ?? '…'} pages`}
        </Text>
      </Stack>
      <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
        <IconTrash size={14} />
      </ActionIcon>
    </Group>
  );
}
