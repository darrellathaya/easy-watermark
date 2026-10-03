import { useState } from 'react';
import {
  Alert,
  Button,
  ColorInput,
  Divider,
  Group,
  ScrollArea,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconDownload, IconReplace } from '@tabler/icons-react';
import { useWatermarkStore } from '../state/store';
import { SliderNumber } from './SliderNumber';
import { FONTS, cssFamilyName } from '../core/fonts';
import { ANGLE_PRESETS, CONFIG_LIMITS, type FontSizeMode } from '../core/watermarkConfig';
import { applyWatermark, downloadBytes, EncryptedPdfError } from '../core/watermarkPdf';
import { exportImage, ImageDecodeError, type ImageExportFormat } from '../core/imageWatermark';
import { expandFilenamePattern } from '../core/filename';

const SWATCHES = ['#B9B9C2', '#FF6B6B', '#FFD43B', '#69DB7C', '#4DABF7', '#DA77F2', '#212529', '#FFFFFF'];

interface ExportResult {
  name: string;
  status: 'ok' | 'skipped' | 'error';
  message?: string;
}

export function ControlPanel() {
  const config = useWatermarkStore((s) => s.config);
  const setConfig = useWatermarkStore((s) => s.setConfig);
  const files = useWatermarkStore((s) => s.files);
  const selectedId = useWatermarkStore((s) => s.selectedId);

  const [pattern, setPattern] = useState('{name}_watermarked');
  // UI-only state, like `pattern`: not part of the persisted WatermarkConfig,
  // which describes the watermark itself rather than the output.
  const [imageFormat, setImageFormat] = useState<ImageExportFormat>('png');
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<ExportResult[]>([]);

  const checkedFiles = files.filter((f) => f.checked && f.status === 'ready');
  // The format picker only means something once an image is loaded; PDFs
  // always export as PDF.
  const hasImages = files.some((f) => f.kind === 'image');
  // A watermark this app stamped before can be edited: exporting replaces it.
  const stamp = files.find((f) => f.id === selectedId)?.stamp ?? null;
  const replaceCount = checkedFiles.filter((f) => f.stamp?.tagged).length;
  const addCount = checkedFiles.length - replaceCount;

  async function handleExport() {
    if (checkedFiles.length === 0) return;
    setExporting(true);
    setResults([]);
    const nextResults: ExportResult[] = [];

    for (const file of checkedFiles) {
      try {
        // An image exports as a PNG at its native resolution; a PDF keeps its
        // own page geometry. Both tile through layout.ts, so they match.
        if (file.kind === 'image') {
          const out = await exportImage(imageFormat, file.bytes, file.mimeType, config, file.name);
          downloadBytes(out.bytes, expandFilenamePattern(pattern, file.name, out.extension), out.mimeType);
        } else {
          const bytes = await applyWatermark(file.bytes, config, file.name);
          downloadBytes(bytes, expandFilenamePattern(pattern, file.name, 'pdf'));
        }
        nextResults.push({ name: file.name, status: 'ok' });
      } catch (err) {
        if (err instanceof EncryptedPdfError || err instanceof ImageDecodeError) {
          nextResults.push({ name: file.name, status: 'skipped', message: err.message });
        } else {
          nextResults.push({ name: file.name, status: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    setResults(nextResults);
    setExporting(false);
  }

  return (
    <ScrollArea h="100%">
      <Stack gap="lg" p="md">
        <div>
          <Title order={6} mb={8}>
            Text
          </Title>
          <Stack gap="sm">
            {stamp?.tagged && (
              <Alert p="xs" color="blue" icon={<IconReplace size={14} />}>
                <Stack gap={6}>
                  <Text size="xs">
                    {stamp.config
                      ? `This file already carries a watermark from here ("${stamp.config.text}"). Exporting replaces it rather than stacking a second one.`
                      : 'This file already carries a watermark from here. Exporting replaces it rather than stacking a second one.'}
                  </Text>
                  {stamp.config && (
                    <Button size="compact-xs" variant="light" onClick={() => setConfig(stamp.config!)}>
                      Load its settings
                    </Button>
                  )}
                </Stack>
              </Alert>
            )}
            <TextInput
              label="Watermark text"
              value={config.text}
              onChange={(e) => setConfig({ text: e.currentTarget.value })}
            />
            <Select
              label="Font"
              data={FONTS.map((f) => ({ value: f.id, label: f.label }))}
              value={config.fontId}
              onChange={(v) => v && setConfig({ fontId: v })}
              allowDeselect={false}
              renderOption={({ option }) => (
                <span style={{ fontFamily: `"${cssFamilyName(option.value)}", sans-serif` }}>{option.label}</span>
              )}
            />
            <ColorInput label="Color" value={config.color} onChange={(v) => setConfig({ color: v })} swatches={SWATCHES} />

            <Stack gap={6}>
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm" fw={500}>
                  Font size
                </Text>
                <SegmentedControl
                  size="xs"
                  value={config.fontSizeMode}
                  onChange={(v) => setConfig({ fontSizeMode: v as FontSizeMode })}
                  data={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'fixed', label: 'Fixed' },
                  ]}
                />
              </Group>
              {config.fontSizeMode === 'fixed' ? (
                <SliderNumber
                  label="Size"
                  value={config.fontSize}
                  onChange={(v) => setConfig({ fontSize: v })}
                  suffix=" pt"
                  {...CONFIG_LIMITS.fontSize}
                />
              ) : (
                <Text size="xs" c="dimmed">
                  Fitted to each tile; set the width with Columns and Gap below.
                </Text>
              )}
            </Stack>
          </Stack>
        </div>

        <Divider />

        <div>
          <Title order={6} mb={8}>
            Layout
          </Title>
          <Stack gap="md">
            <SliderNumber
              label="Columns"
              value={config.columns}
              onChange={(v) => setConfig({ columns: v })}
              {...CONFIG_LIMITS.columns}
            />
            <SliderNumber
              label="Rows"
              value={config.rows}
              onChange={(v) => setConfig({ rows: v })}
              {...CONFIG_LIMITS.rows}
            />
            <SliderNumber
              label="Angle"
              value={config.angle}
              onChange={(v) => setConfig({ angle: v })}
              suffix="°"
              {...CONFIG_LIMITS.angle}
            />
            <Group gap={6}>
              {ANGLE_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  size="xs"
                  variant={config.angle === p.value ? 'filled' : 'default'}
                  onClick={() => setConfig({ angle: p.value })}
                >
                  {p.label}
                </Button>
              ))}
            </Group>
            <Stack gap={4}>
              <SliderNumber
                label="Gap"
                value={config.gapRatio}
                onChange={(v) => setConfig({ gapRatio: v })}
                decimalScale={2}
                disabled={config.fontSizeMode === 'fixed'}
                {...CONFIG_LIMITS.gapRatio}
              />
              {config.fontSizeMode === 'fixed' && (
                <Text size="xs" c="dimmed">
                  Gap only applies to an auto-fitted font size.
                </Text>
              )}
            </Stack>
          </Stack>
        </div>

        <Divider />

        <div>
          <Title order={6} mb={8}>
            Appearance
          </Title>
          <Stack gap="md">
            <SliderNumber
              label="Opacity"
              value={config.opacity}
              onChange={(v) => setConfig({ opacity: v })}
              decimalScale={2}
              {...CONFIG_LIMITS.opacity}
            />
          </Stack>
        </div>

        <Divider />

        <div>
          <Title order={6} mb={8}>
            Output
          </Title>
          <Stack gap="sm">
            {hasImages && (
              <Stack gap={6}>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="sm" fw={500}>
                    Image output
                  </Text>
                  <SegmentedControl
                    size="xs"
                    value={imageFormat}
                    onChange={(v) => setImageFormat(v as ImageExportFormat)}
                    data={[
                      { value: 'png', label: 'PNG' },
                      { value: 'pdf', label: 'PDF' },
                    ]}
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  {imageFormat === 'pdf'
                    ? 'Each image becomes a one-page PDF at its own aspect ratio. PDFs are unaffected.'
                    : 'Images export as lossless PNG. PDFs always export as PDF.'}
                </Text>
              </Stack>
            )}
            <TextInput
              label="Filename pattern"
              description="Tokens: {name}, {date}. The extension follows the output format"
              value={pattern}
              onChange={(e) => setPattern(e.currentTarget.value)}
            />
            <Button
              leftSection={<IconDownload size={16} />}
              onClick={handleExport}
              loading={exporting}
              disabled={checkedFiles.length === 0}
            >
              Apply & Download{checkedFiles.length > 1 ? ` (${checkedFiles.length})` : ''}
            </Button>
            {checkedFiles.length > 0 && (
              // Always state the outcome, so "replaced" vs "added" is visible
              // before exporting rather than inferred from the result.
              <Text size="xs" c="dimmed">
                {replaceCount > 0 && `${replaceCount} of ${checkedFiles.length} will have an existing watermark replaced. `}
                {addCount > 0 &&
                  `${addCount} will get a watermark added${replaceCount > 0 ? '' : ' (no earlier watermark from here was found)'}.`}
              </Text>
            )}
            {results.map((r) => (
              <Alert
                key={r.name}
                p="xs"
                color={r.status === 'ok' ? 'green' : r.status === 'skipped' ? 'yellow' : 'red'}
                icon={r.status === 'ok' ? <IconCheck size={14} /> : <IconAlertCircle size={14} />}
              >
                <Text size="xs">
                  {r.name}
                  {r.message ? `: ${r.message}` : ': done'}
                </Text>
              </Alert>
            ))}
          </Stack>
        </div>
      </Stack>
    </ScrollArea>
  );
}
