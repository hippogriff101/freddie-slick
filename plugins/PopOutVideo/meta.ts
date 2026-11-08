import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'PopOutVideo';
export const pluginName = 'Pop Out Video';
export const description =
  "Adds Pop out video to a participant's menu in a huddle, opening their video in a window you can resize";
export const category: PluginCategory = 'sounds';
export const defaultEnabled = false;

export const settings = {
  size: {
    type: 'select',
    label: 'Pop-out size',
    description: 'Only the size it opens at. Drag the window edge to make it as big as you like.',
    default: 'large',
    options: [
      { value: 'medium', label: '960 × 540' },
      { value: 'large', label: '1280 × 720' },
      { value: 'huge', label: '1600 × 900' },
      { value: 'fill', label: 'As large as the screen allows' },
    ],
  },
  muted: {
    type: 'boolean',
    label: 'Mute the pop-out',
    description: 'Slack already plays the huddle audio, so an unmuted pop-out would echo.',
    default: true,
  },
  closeWhenVideoEnds: {
    type: 'boolean',
    label: 'Close when the video ends',
    description: 'Closes the window when the participant turns their camera off or leaves the huddle.',
    default: false,
  },
} as const satisfies SettingsSchema;
