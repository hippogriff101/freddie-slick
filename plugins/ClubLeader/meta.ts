import type { PluginCategory, SettingsSchema } from '$slick';

export const id = 'ClubLeader';
export const pluginName = 'Club Leader Badge';
export const description = 'Shows a badge next to Hack Club club leaders, using the Club API';
export const category: PluginCategory = 'hackclub';

export const settings = {
  badgeEmoji: {
    type: 'text',
    label: 'Badge emoji',
    description: 'A custom emoji name from this workspace (like clubs-icon), or paste a normal emoji such as ⭐.',
    default: 'clubs-icon',
    maxLength: 100,
  },
  apiKey: {
    type: 'text',
    label: 'Club API key (optional)',
    description:
      "With a key that has Read permission, the badge's tooltip shows the club's name, status and country, and other roles can get their own badge.",
    default: '',
    maxLength: 200,
  },
  showOtherRoles: {
    type: 'boolean',
    label: 'Show other roles (API key required)',
    description: 'Gives co-leaders and club members their own badges. Without this, co-leaders get the leader badge.',
    default: false,
  },
  coLeaderEmoji: {
    type: 'text',
    label: 'Co-leader badge emoji',
    default: '🤝',
    maxLength: 100,
  },
  memberEmoji: {
    type: 'text',
    label: 'Member badge emoji',
    default: '🧑‍💻',
    maxLength: 100,
  },
  recheckDays: {
    type: 'number',
    label: 'Re-check each person every (days)',
    description: 'How long an answer is remembered. Longer means fewer requests to the Club API.',
    default: 7,
    min: 1,
    max: 30,
  },
  underline: {
    type: 'boolean',
    label: "Underline leaders' names too",
    default: false,
  },
  underlineColor: {
    type: 'color',
    label: 'Underline color',
    default: '#ec3750',
  },
} as const satisfies SettingsSchema;
