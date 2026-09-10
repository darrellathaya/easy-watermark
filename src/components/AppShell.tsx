import { useState } from 'react';
import { AppShell as MantineAppShell, Anchor, Group, Stack, Text, ThemeIcon, Tooltip, ActionIcon } from '@mantine/core';
import { IconDroplet, IconMail } from '@tabler/icons-react';
import { FileRail } from './FileRail';
import { PreviewPane } from './PreviewPane';
import { ControlPanel } from './ControlPanel';
import { ContactModal } from './ContactModal';
import { CONTACT } from '../core/contact';

export function AppShell() {
  const [contactOpen, setContactOpen] = useState(false);

  return (
    <MantineAppShell
      header={{ height: 52 }}
      navbar={{ width: 240, breakpoint: 'sm' }}
      aside={{ width: 360, breakpoint: 'sm' }}
      footer={{ height: 44 }}
      padding={0}
    >
      <MantineAppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="xs">
            <ThemeIcon variant="light" size="sm">
              <IconDroplet size={14} />
            </ThemeIcon>
            <Text fw={600} size="sm">
              Easy Watermark
            </Text>
          </Group>
          <Tooltip label="Get in touch" position="bottom" withArrow>
            <ActionIcon variant="subtle" color="gray" onClick={() => setContactOpen(true)} aria-label="Get in touch">
              <IconMail size={16} />
            </ActionIcon>
          </Tooltip>
        </Group>
      </MantineAppShell.Header>

      <MantineAppShell.Navbar>
        <FileRail />
      </MantineAppShell.Navbar>

      <MantineAppShell.Main
        style={{
          height: 'calc(100dvh - var(--app-shell-header-height, 0rem) - var(--app-shell-footer-height, 0rem))',
          overflow: 'hidden',
        }}
      >
        <PreviewPane />
      </MantineAppShell.Main>

      <MantineAppShell.Aside>
        <ControlPanel />
      </MantineAppShell.Aside>

      <MantineAppShell.Footer>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Stack gap={0}>
            <Text size="xs" fw={600}>
              {CONTACT.name}
            </Text>
            <Text size="xs" c="dimmed">
              {CONTACT.location}
            </Text>
          </Stack>
          <Group gap="md">
            <Anchor href={CONTACT.github} target="_blank" rel="noreferrer" size="xs" c="dimmed" underline="always">
              GitHub
            </Anchor>
            <Anchor href={CONTACT.linkedin} target="_blank" rel="noreferrer" size="xs" c="dimmed" underline="always">
              LinkedIn
            </Anchor>
            <Anchor href={`mailto:${CONTACT.email}`} size="xs" c="dimmed" underline="always">
              Email
            </Anchor>
          </Group>
        </Group>
      </MantineAppShell.Footer>

      <ContactModal opened={contactOpen} onClose={() => setContactOpen(false)} />
    </MantineAppShell>
  );
}
