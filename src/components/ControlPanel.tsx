import { useState } from 'react';
import {
  Alert,
  Button,
  ColorInput,
  Divider,
  Group,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconDownload } from '@tabler/icons-react';
import { useWatermarkStore } from '../state/store';
import { SliderNumber } from './SliderNumber';
import { FONTS, cssFamilyName } from '../core/fonts';
import { ANGLE_PRESETS, CONFIG_LIMITS } from '../core/watermarkConfig';
import { applyWatermark, downloadBytes, EncryptedPdfError } from '../core/watermarkPdf';
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

  const [pattern, setPattern] = useState('{name}_watermarked');
  const [exporting, setExporting] = useState(false);
  const [results, setResults] = useState<ExportResult[]>([]);

  const checkedFiles = files.filter((f) => f.checked && f.status === 'ready');

  async function handleExport() {
    if (checkedFiles.length === 0) return;
    setExporting(true);
    setResults([]);
    const nextResults: ExportResult[] = [];

    for (const file of checkedFiles) {
      try {
        const bytes = await applyWatermark(file.bytes, config, file.name);
        const outName = expandFilenamePattern(pattern, file.name);
        downloadBytes(bytes, outName);
        nextResults.push({ name: file.name, status: 'ok' });
      } catch (err) {
        if (err instanceof EncryptedPdfError) {
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
            <SliderNumber
              label="Gap"
              value={config.gapRatio}
              onChange={(v) => setConfig({ gapRatio: v })}
              decimalScale={2}
              {...CONFIG_LIMITS.gapRatio}
            />
          </Stack>
        </div>

        <Divider />

        <div>
          <Title order={6} mb={8}>
            Appearance
          </Title>
          <Stack gap="md">
            <ColorInput label="Color" value={config.color} onChange={(v) => setConfig({ color: v })} swatches={SWATCHES} />
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
            <TextInput
              label="Filename pattern"
              description="Tokens: {name}, {date}"
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
            {results.map((r) => (
              <Alert
                key={r.name}
                p="xs"
                color={r.status === 'ok' ? 'green' : r.status === 'skipped' ? 'yellow' : 'red'}
                icon={r.status === 'ok' ? <IconCheck size={14} /> : <IconAlertCircle size={14} />}
              >
                <Text size="xs">
                  {r.name}
                  {r.message ? ` — ${r.message}` : ' — done'}
                </Text>
              </Alert>
            ))}
          </Stack>
        </div>
      </Stack>
    </ScrollArea>
  );
}
