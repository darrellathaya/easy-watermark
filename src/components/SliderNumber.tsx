import { Group, NumberInput, Slider, Stack, Text } from '@mantine/core';

interface SliderNumberProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  decimalScale?: number;
  suffix?: string;
  marks?: { value: number; label?: string }[];
}

/**
 * A Slider and a NumberInput bound to the same state value — never two
 * separate fields (spec §11). Either control can drive the other.
 */
export function SliderNumber({ label, value, onChange, min, max, step, decimalScale = 0, suffix = '', marks }: SliderNumberProps) {
  return (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <NumberInput
          value={value}
          onChange={(v) => {
            const num = typeof v === 'number' ? v : Number(v);
            if (!Number.isNaN(num)) onChange(Math.min(max, Math.max(min, num)));
          }}
          min={min}
          max={max}
          step={step}
          decimalScale={decimalScale}
          suffix={suffix}
          w={90}
          size="xs"
        />
      </Group>
      <Slider
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
        marks={marks}
        label={(v) => `${v}${suffix}`}
      />
    </Stack>
  );
}
