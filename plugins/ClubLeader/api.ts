// Club API calls and response parsing. No Slick or React here, so it can be tested on its own.

export const BASE = 'https://clubapi.hackclub.com';

export type ClubDetails = { country: string | null };

/** One line of the profile section. */
export type Row = { label: string; value: string; href?: string };

export type Lookup = {
  leader: boolean;
  /** The club they lead, or (for members) belong to. */
  club: string | null;
  status: string | null;
  /** A leader who isn't the club's main leader (API key only). */
  coLeader?: boolean;
  /** Set when they're a member rather than a leader (API key only). */
  member?: boolean;
  details?: ClubDetails | null;
  /** Club facts that are fine to show and save (API key only). Never personal details. */
  profile?: Row[];
  /** When this answer was fetched, for "checked 2 hours ago". */
  at?: number;
  /** The lookup failed; remembered briefly so it isn't retried on every render. */
  failed?: boolean;
};

export const FAILED: Lookup = { leader: false, club: null, status: null, failed: true };

type Response = { status: number; body: string };
export type Fetch = (url: string, init: { headers: Record<string, string> }) => Promise<Response>;

export class KeyRejected extends Error {}
export class HttpError extends Error {
  status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** A field's text, whether the API gives a string, a number or a one-item list (Airtable lookups). */
const flat = (value: unknown): string | null => {
  const one = Array.isArray(value) ? value.find((item) => item !== null && item !== '') : value;
  return typeof one === 'number' ? String(one) : text(one);
};

/** Slack IDs from a field that may be a list or a comma-separated string. */
const ids = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [])
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim().toUpperCase())
    .filter(Boolean);

function parse(response: Response): Record<string, any> {
  if (response.status === 401) throw new KeyRejected();
  if (response.status < 200 || response.status >= 300) throw new HttpError(response.status);
  return JSON.parse(response.body || '{}');
}

/** `/leader/slack`: public (leader yes/no) or, with any valid key, the club name and status. */
export async function leaderBySlack(fetch: Fetch, userId: string, apiKey: string): Promise<Lookup> {
  const headers: Record<string, string> = apiKey ? { Authorization: apiKey } : {};
  const data = parse(await fetch(`${BASE}/leader/slack?slackid=${encodeURIComponent(userId)}`, { headers }));
  const club = text(data.club_name);
  return { leader: data.leader === true || !!club, club, status: text(data.club_status), at: Date.now() };
}

const date = (value: unknown) => {
  const day = flat(value)?.slice(0, 10);
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
};
const webLink = (value: unknown) => {
  const url = flat(value);
  return url && /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
};
const row = (label: string, value: string | null, href?: string): Row[] => (value ? [{ label, value, ...(href ? { href } : {}) }] : []);

/**
 * Club facts that are fine to show on a profile and save to disk. This is an allowlist:
 * a field that isn't named here is never shown, so new API fields stay hidden by default.
 */
export function profileRows(fields: Record<string, unknown> | null | undefined): Row[] {
  if (!fields) return [];
  const slug = flat(fields.hcb_slug);
  const site = webLink(fields.club_website);
  return [
    ...row('Country', flat(fields.venue_addr_country)),
    ...row('Members', flat(fields.member_count)),
    ...row('First meeting', date(fields.first_meeting)),
    ...row('Last check-in', date(fields.time_last_checkin)),
    ...row('Club created', date(fields.time_created)),
    ...(slug && /^[a-z0-9-]+$/i.test(slug) ? row('HCB', slug, `https://hcb.hackclub.com/${slug}`) : []),
    ...(site ? row('Website', site.replace(/^https?:\/\//i, '').replace(/\/$/, ''), site) : []),
  ];
}

/**
 * Personal details, only shown after a click and never saved. Also an allowlist.
 * Deliberately never read: street addresses, postcodes, coordinates, anything about a
 * leader's home address (`lead_addr_*`), staff notes (`team_notes`) and record IDs.
 */
export function privateRows(fields: Record<string, unknown> | null | undefined): Row[] {
  if (!fields) return [];
  const name = [flat(fields.lead_first_name), flat(fields.lead_last_name)].filter(Boolean).join(' ');
  const area = [flat(fields.venue_addr_city), flat(fields.venue_addr_state)].filter(Boolean).join(', ');
  return [
    ...row('Main leader', name || null),
    ...row('Contact email', flat(fields['contact_email (from rel_leaders)'])),
    ...row('Venue', flat(fields.venue_name)),
    ...row('Venue area', area || null),
  ];
}

export type PersonResult = { lookup: Lookup; hidden: Row[] };

/** Turns a `/person` response into what the plugin shows. */
export function readPerson(data: Record<string, any>, userId: string): PersonResult {
  const leader = data.leader?.by_slack;
  const member = data.member?.by_slack;
  const isLeader = leader?.found === true;
  const isMember = !isLeader && member?.found === true;
  const club = text(isLeader ? leader?.club_name : isMember ? member?.club_name : null);
  const fields = club ? (data.clubs?.[club]?.fields ?? data.clubs?.[club] ?? null) : null;
  // The API says the role outright. Older responses don't, so fall back to the club record:
  // it names its main leader(s), and a leader who isn't one of them is a co-leader.
  const role = text(leader?.role);
  const mainLeaders = ids(fields?.leader_slack_id);
  const coLeader = role ? /^co/i.test(role) : mainLeaders.length > 0 && !mainLeaders.includes(userId.toUpperCase());
  return {
    lookup: {
      leader: isLeader,
      coLeader: isLeader && coLeader,
      member: isMember,
      club,
      status: text(leader?.club_status) ?? text(fields?.status) ?? text(fields?.club_status),
      details: fields ? { country: text(fields.venue_addr_country ?? fields.country) } : null,
      profile: profileRows(fields),
      at: Date.now(),
    },
    hidden: privateRows(fields),
  };
}

/** `/person`: leader and member matches plus the club's record, in one request. Needs Read permission. */
export async function personFull(fetch: Fetch, userId: string, apiKey: string): Promise<PersonResult> {
  const response = await fetch(`${BASE}/person?slackid=${encodeURIComponent(userId)}`, { headers: { Authorization: apiKey } });
  return readPerson(parse(response), userId);
}

/** `/person`, keeping only what's safe to save. */
export async function person(fetch: Fetch, userId: string, apiKey: string): Promise<Lookup> {
  return (await personFull(fetch, userId, apiKey)).lookup;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/**
 * How long an answer is remembered. Failures: an hour. People in a club: `recheckDays`.
 * People with no club: `noClubDays` (most people have no club, and that rarely changes),
 * or `recheckDays` when `noClubDays` is 0.
 */
export function ttlMs(info: Lookup, recheckDays: number, noClubDays: number): number {
  if (info.failed) return HOUR_MS;
  const days = Math.max(1, Number(recheckDays) || 7);
  const inClub = info.leader || info.member === true;
  const noClub = Math.min(30, Math.max(0, Number(noClubDays) || 0));
  return (!inClub && noClub > 0 ? noClub : days) * DAY_MS;
}

/** "Club leader", "Club co-leader" or "Club member". Co-leaders are only called that when other roles are shown. */
export function roleOf(info: Lookup, otherRoles = false): string {
  return !info.leader ? 'Club member' : info.coLeader && otherRoles ? 'Club co-leader' : 'Club leader';
}

/** Tooltip text for a badge. */
export function describe(info: Lookup, otherRoles = false): string {
  const role = roleOf(info, otherRoles);
  if (!info.club) return role;
  const lines = [`${role}: ${info.club}${info.status ? ` (${info.status})` : ''}`];
  if (info.details?.country) lines.push(info.details.country);
  return lines.join('\n');
}

/** "Co-leader · Example HS", for the hover card. Null for people with no club. */
export function oneLine(info: Lookup | null | undefined, otherRoles = false): string | null {
  if (!info || info.failed) return null;
  // Members only count when other roles are shown, the same rule as the badge.
  if (!info.leader && !(info.member && otherRoles)) return null;
  const role = roleOf(info, otherRoles).replace(/^Club /, '');
  return info.club ? `${role.replace(/^./, (c) => c.toUpperCase())} · ${info.club}` : `Club ${role}`;
}

const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? '' : 's'}`;
const dayOf = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) : null;
};

/** Whole days from a YYYY-MM-DD date until now. Null for a bad or future date. */
export function daysSince(value: string, now = Date.now()): number | null {
  const then = dayOf(value);
  if (then === null || then > now) return null;
  return Math.floor((now - then) / DAY_MS);
}

/** How long ago a YYYY-MM-DD date was, in words: "1 year, 2 months", "3 months", "12 days", "today". */
export function span(value: string, now = Date.now()): string | null {
  const days = daysSince(value, now);
  const then = dayOf(value);
  if (days === null || then === null) return null;
  const from = new Date(then);
  const to = new Date(now);
  const months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth()) -
    (to.getUTCDate() < from.getUTCDate() ? 1 : 0);
  if (months < 1) return days === 0 ? 'today' : plural(days, 'day');
  const years = Math.floor(months / 12);
  return [years ? plural(years, 'year') : '', months % 12 ? plural(months % 12, 'month') : ''].filter(Boolean).join(', ');
}

/** A club with no check-in for longer than this is flagged. */
export const STALE_DAYS = 60;

export type ShownRow = Row & { note?: string; warn?: string };

/** Adds the words that depend on today's date: the club's age, and how old the last check-in is. */
export function decorate(rows: Row[], now = Date.now()): ShownRow[] {
  return rows.map((entry) => {
    const words = span(entry.value, now);
    if (!words) return entry;
    if (entry.label === 'Club created') return { ...entry, note: words === 'today' ? 'new today' : `${words} old` };
    if (entry.label === 'Last check-in') {
      const stale = (daysSince(entry.value, now) ?? 0) > STALE_DAYS;
      return {
        ...entry,
        note: words === 'today' ? 'today' : `${words} ago`,
        ...(stale ? { warn: `No check-in for over ${STALE_DAYS} days` } : {}),
      };
    }
    return entry;
  });
}

/** "just now", "5 minutes ago", "3 days ago". */
export function ago(at: number | undefined, now = Date.now()): string | null {
  if (!at) return null;
  const minutes = Math.floor((now - at) / 60000);
  if (minutes < 1) return 'just now';
  const [count, unit] = minutes < 60 ? [minutes, 'minute'] : minutes < 1440 ? [Math.floor(minutes / 60), 'hour'] : [Math.floor(minutes / 1440), 'day'];
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
}
