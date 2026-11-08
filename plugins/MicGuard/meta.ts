import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'MicGuard';
export const pluginName = 'Mic Guard';
export const description =
  'If someone else mutes you in a huddle, Mic Guard unmutes you again and tells you who did it';
export const category: PluginCategory = 'sounds';
export const defaultEnabled = false;

export const settings = {
  keepUnmuted: {
    type: 'boolean',
    label: 'Keep me unmuted in huddles',
    description: "If someone else mutes you, Mic Guard unmutes you again. You can also switch this from a huddle's ⋯ menu.",
    default: false,
  },
  tellMe: {
    type: 'boolean',
    label: 'Tell me when it happens',
    description: 'Shows a small huddle alert naming whoever muted you.',
    default: true,
  },
  debug: {
    type: 'boolean',
    label: 'Log what it sees',
    description: "Logs the mic button and huddle menus it finds, for when the toggle doesn't show up.",
    default: false,
  },
} as const satisfies SettingsSchema;
