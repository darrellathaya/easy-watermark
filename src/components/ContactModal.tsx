import { useState } from 'react';
import { Anchor, Button, Divider, Group, Modal, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconBrandGithub, IconBrandLinkedin, IconMail, IconMapPin, IconSend } from '@tabler/icons-react';
import { CONTACT } from '../core/contact';

interface ContactModalProps {
  opened: boolean;
  onClose: () => void;
}

/**
 * Author contact panel (top icon + bottom bar both open this). Sending
 * builds a `mailto:` link and hands off to the visitor's own email client —
 * consistent with the app's "nothing leaves the browser except what the
 * user explicitly sends" stance: no form submission ever reaches a server.
 */
export function ContactModal({ opened, onClose }: ContactModalProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  function handleSend() {
    const subject = encodeURIComponent(name ? `Message from ${name}` : 'Message from Easy Watermark');
    const body = encodeURIComponent([message, '', email ? `Reply to: ${email}` : null].filter(Boolean).join('\n'));
    window.location.href = `mailto:${CONTACT.email}?subject=${subject}&body=${body}`;
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap={6}>
          <IconMail size={16} />
          <Text fw={600} size="sm">
            Get in touch
          </Text>
        </Group>
      }
      size="lg"
      centered
    >
      <Group align="flex-start" gap="xl" wrap="wrap">
        <Stack gap="xs" style={{ flex: 1, minWidth: 200 }}>
          <Text size="sm" c="dimmed">
            Built and maintained by {CONTACT.name}. Bugs, feature ideas, or anything else about
            Easy Watermark are welcome — this is the fastest way to reach me.
          </Text>
          <Anchor href={`mailto:${CONTACT.email}`} size="sm">
            {CONTACT.email}
          </Anchor>
          <Group gap={6}>
            <IconBrandGithub size={14} />
            <Anchor href={CONTACT.github} target="_blank" rel="noreferrer" size="sm">
              GitHub ↗
            </Anchor>
          </Group>
          <Group gap={6}>
            <IconBrandLinkedin size={14} />
            <Anchor href={CONTACT.linkedin} target="_blank" rel="noreferrer" size="sm">
              LinkedIn ↗
            </Anchor>
          </Group>
          <Group gap={6}>
            <IconMapPin size={14} />
            <Text size="sm" c="dimmed">
              {CONTACT.location}
            </Text>
          </Group>
        </Stack>

        <Divider orientation="vertical" visibleFrom="sm" />

        <Stack gap="sm" style={{ flex: 1, minWidth: 240 }}>
          <TextInput
            label="Name"
            placeholder="Jane Doe"
            size="sm"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label="Email"
            placeholder="jane@company.com"
            size="sm"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <Textarea
            label="Message"
            placeholder="Found a bug, or have an idea for a feature..."
            size="sm"
            minRows={4}
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
          />
          <Button rightSection={<IconSend size={14} />} onClick={handleSend} disabled={!message.trim()}>
            Send message
          </Button>
          <Text size="xs" c="dimmed">
            Opens your email client with this filled in — nothing is sent from here directly.
          </Text>
        </Stack>
      </Group>
    </Modal>
  );
}
