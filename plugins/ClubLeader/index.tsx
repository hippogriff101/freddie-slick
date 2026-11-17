// Badge (and optional underline) for Hack Club club leaders, and optionally members.
//
// Keeping Club API traffic low:
// - answers, including failures, are cached in Slick storage (people for `recheckDays`, people with
//   no club for 30 days by default, failures for an hour)
// - only senders whose name is actually shown are looked up, never grouped follow-up messages
// - requests go one at a time with a gap, under an hourly budget, and pause after errors

import { SlickPlugin } from '$slick';
import {
  ago,
  describe,
  FAILED,
  HttpError,
  KeyRejected,
  leaderBySlack,
  person,
  personFull,
  roleOf,
  ttlMs,
  type Lookup,
  type Row,
} from './api.ts';
import { Blocked, Limiter } from './limiter.ts';
import * as meta from './meta.ts';

type Emoji = { text: string; url: string | null };
type View = { leader: Emoji; coLeader: Emoji; member: Emoji; underline: boolean; otherRoles: boolean; profile: boolean };
type Message = { user?: string; bot_id?: string };
type ProfileShellProps = { profileId?: string; uiComponentName?: string; children?: React.ReactNode };
/** A fresh answer asked for by hand. `hidden` is personal details: kept in memory only, never saved. */
type Fresh = { info: Lookup; hidden: Row[] } | { error: string };

const USER_ID = /^[UW][A-Z0-9]+$/;
const EMOJI_NAME = /^:?([a-z0-9_+'-]+):?$/i;

const personId = (userId?: string, botId?: string) =>
  !botId && userId && USER_ID.test(userId) && userId !== 'USLACKBOT' ? userId : null;

// Grouped follow-up messages get the same header children with `visible: false`;
// only the shown sender counts (same check as Slick's UserPronouns plugin).
const isShownSender = (child: React.ReactNode) => {
  const props = React.isValidElement(child) ? (child.props as Record<string, unknown>) : null;
  return !!props && 'isInteractive' in props && props.visible !== false;
};

export default class ClubLeader extends SlickPlugin<typeof meta.settings> {
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = false;
  static readonly requiredAPIs = [] as const;
  static readonly settings = meta.settings;
  static readonly liveSettings = [
    'badgeEmoji',
    'coLeaderEmoji',
    'memberEmoji',
    'showOtherRoles',
    'showProfile',
    'recheckDays',
    'noClubDays',
    'underline',
    'underlineColor',
  ];

  private cache = this.api.Cache<Lookup>('club_leader', (info) =>
    ttlMs(info, this.config.recheckDays, this.config.noClubDays ?? 30),
  );
  private limiter = new Limiter({ gapMs: 400, perHour: 120, backoffMs: 15 * 60 * 1000, maxBackoffMs: 4 * 60 * 60 * 1000 });
  private view = new this.api.Store<View>({
    leader: { text: '♣', url: null },
    coLeader: { text: '', url: null },
    member: { text: '', url: null },
    underline: false,
    otherRoles: false,
    profile: false,
  });
  private emojiList: Promise<Record<string, string>> | null = null;
  /** With a key: '/person' until it turns out the key can't read, then '/leader/slack'. */
  private keyedEndpoint: 'person' | 'leader' = 'person';
  private lastBlockLog = '';

  start() {
    this.onSettingsChange();
    this.api.signal.addEventListener('abort', () => this.logTotal(), { once: true });

    // Looks a user up once and re-renders when the answer arrives. Pass null to skip.
    const useLookup = (userId: string | null) => {
      const [info, setInfo] = React.useState<Lookup | null>(() =>
        userId ? (this.cache.peek(this.key(userId)) ?? null) : null,
      );
      React.useEffect(() => {
        if (!userId) return;
        let live = true;
        void this.lookUp(userId).then((result) => live && setInfo(result));
        return () => {
          live = false;
        };
      }, [userId]);
      return info;
    };

    const Badge = ({ userId }: { userId: string }) => {
      const info = useLookup(userId);
      const view = this.view.use();
      // Other roles off: co-leaders are just leaders, and members get nothing.
      const emoji = info?.leader
        ? info.coLeader && view.otherRoles
          ? view.coLeader
          : view.leader
        : info?.member && view.otherRoles
          ? view.member
          : null;
      if (!info || !emoji) return null;
      const tip = describe(info, view.otherRoles);
      return (
        <span className="slick-club-leader" title={tip} aria-label={tip} data-stringify-ignore="">
          {emoji.url ? <img className="slick-club-leader__img" src={emoji.url} alt={emoji.text} /> : emoji.text}
        </span>
      );
    };

    // Underline: only a class on the name, so a hidden sender stays hidden.
    // Looks nobody up unless underlining is on (the badge does the lookups).
    this.api.patchComponent<{ userId?: string; botId?: string; className?: string }>(
      'BaseMessageSender',
      (Original) => (props) => {
        const { underline } = this.view.use();
        const info = useLookup(underline ? personId(props.userId, props.botId) : null);
        if (!underline || !info?.leader) return <Original {...props} />;
        return <Original {...props} className={[props.className, 'slick-club-leader-name'].filter(Boolean).join(' ')} />;
      },
    );

    // Channels: the badge goes right after the shown sender in the message header.
    this.api.patchComponent<{ msg?: Message; children?: React.ReactNode }>('BaseBroadcastPreamble', (Original) => (props) => {
      const userId = personId(props.msg?.user, props.msg?.bot_id);
      if (!userId) return <Original {...props} />;
      const children = React.Children.toArray(props.children);
      const sender = children.findIndex(isShownSender);
      if (sender === -1) return <Original {...props} />;
      children.splice(sender + 1, 0, <Badge key="slick-club-leader" userId={userId} />);
      return <Original {...props}>{children}</Original>;
    });

    // Threads build their own header, which ends on a <br> we have to move past.
    this.api.patchComponent<{ msg?: Message; adjacent?: boolean; visible?: boolean; omitLinebreak?: boolean }>(
      'ThreadSenderAndTimestampGeneric',
      (Original) => (props) => {
        const userId = personId(props.msg?.user, props.msg?.bot_id);
        if (props.adjacent || props.visible === false || !userId) return <Original {...props} />;
        return (
          <>
            <Original {...props} omitLinebreak />
            <Badge userId={userId} />
            {props.omitLinebreak ? null : <br />}
          </>
        );
      },
    );

    // The Hack Club section on a profile (API key only).
    const ProfileSection = ({ userId }: { userId: string }) => {
      const view = this.view.use();
      const cached = useLookup(view.profile ? userId : null);
      const [fresh, setFresh] = React.useState<{ info: Lookup; hidden: Row[] } | null>(null);
      const [revealed, setRevealed] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const live = React.useRef(true);
      React.useEffect(
        () => () => {
          live.current = false;
        },
        [],
      );

      // Asks the Club API now, whatever the saved answer's age. Also how personal details are loaded.
      const sync = async (reveal: boolean) => {
        if (busy) return;
        setBusy(true);
        setError('');
        const result = await this.refresh(userId);
        if (!live.current) return;
        if ('error' in result) setError(result.error);
        else {
          setFresh(result);
          if (reveal) setRevealed(true);
        }
        setBusy(false);
      };

      const info = fresh?.info ?? cached;
      const inClub = !!info && !info.failed && (info.leader || info.member === true);
      // Answers saved before this section existed have no club details: fetch them once, on first view.
      // Skipped when the key can't read club records, since that request would only fail.
      const needsDetails = inClub && !fresh && info.profile === undefined && this.keyedEndpoint === 'person';
      React.useEffect(() => {
        if (needsDetails) void sync(false);
      }, [needsDetails]);
      // After every hook, so turning the setting on or off never changes how many hooks run.
      if (!view.profile) return null;
      const checked = ago(info?.at);
      const hidden = fresh?.hidden ?? [];
      const rows: Row[] = inClub
        ? [
            { label: 'Role', value: roleOf(info, true).replace(/^Club /, '').replace(/^./, (c) => c.toUpperCase()) },
            ...(info.club ? [{ label: 'Club', value: info.club }] : []),
            ...(info.status ? [{ label: 'Status', value: info.status }] : []),
            ...(info.profile ?? []),
          ]
        : [];
      const line = ({ label, value, href }: Row) => (
        <div className="slick-club-profile__row" key={label}>
          <dt>{label}</dt>
          <dd>
            {href ? (
              <a href={href} target="_blank" rel="noreferrer">
                {value}
              </a>
            ) : (
              value
            )}
          </dd>
        </div>
      );

      return (
        <div className="p-r_member_profile_section slick-club-profile">
          <div className="slick-club-profile__head">
            <span className="slick-club-profile__heading">Hack Club</span>
            <button
              type="button"
              className="slick-club-profile__button"
              onClick={() => void sync(false)}
              disabled={busy}
              title="Ask the Club API again now"
            >
              {busy ? 'Checking…' : '↻ Resync'}
            </button>
          </div>
          {!info ? (
            <p className="slick-club-profile__note">Not checked yet.</p>
          ) : info.failed ? (
            <p className="slick-club-profile__note">The last check failed. Try Resync.</p>
          ) : !inClub ? (
            <p className="slick-club-profile__note">Not a club leader or member.</p>
          ) : (
            <dl className="slick-club-profile__rows">
              {rows.map(line)}
              {revealed && hidden.map(line)}
            </dl>
          )}
          {inClub &&
            (revealed ? (
              <button type="button" className="slick-club-profile__button" onClick={() => setRevealed(false)}>
                {hidden.length ? 'Hide personal details' : 'No personal details on record'}
              </button>
            ) : (
              <button
                type="button"
                className="slick-club-profile__button"
                onClick={() => (fresh ? setRevealed(true) : void sync(true))}
                disabled={busy}
                title="Loads the main leader's name, contact email and venue from the Club API. Not saved."
              >
                Show personal details
              </button>
            ))}
          {error && (
            <p className="slick-club-profile__note slick-club-profile__note--error" role="status">
              {error}
            </p>
          )}
          {checked && !error && <p className="slick-club-profile__note">Checked {checked}</p>}
        </div>
      );
    };

    // The profile pane's scrollable body, the same spot Slick's InstalledApps plugin uses.
    this.api.patchComponent<{ children?: unknown }>('Content', (Original) => (props) => {
      const shell = props.children;
      if (!React.isValidElement<ProfileShellProps>(shell)) return <Original {...props} />;
      const userId = personId(shell.props.profileId);
      const sections = shell.props.children;
      if (shell.props.uiComponentName !== 'rimeto_member_profile_flexpane' || !userId || !Array.isArray(sections)) {
        return <Original {...props} />;
      }
      const withClub = sections.map((child: React.ReactNode) => {
        if (
          !React.isValidElement<{ 'data-qa'?: string; children?: React.ReactNode }>(child) ||
          child.props['data-qa'] !== 'member_profile_pane'
        ) {
          return child;
        }
        // Keyed by person, so switching profiles starts with nothing revealed.
        return React.cloneElement(child, undefined, child.props.children, <ProfileSection key={`slick-club-profile-${userId}`} userId={userId} />);
      });
      return <Original {...props} children={React.cloneElement(shell, undefined, ...withClub)} />;
    });
  }

  onSettingsChange() {
    const color = this.config.underlineColor || '#ec3750';
    this.api.setStyle(`
      .slick-club-leader {
        display: inline-flex;
        align-items: center;
        margin-left: 4px;
        font-size: 14px;
        line-height: 1;
        vertical-align: middle;
        cursor: default;
        user-select: none;
      }
      .slick-club-leader__img { width: 16px; height: 16px; object-fit: contain; }
      .slick-club-leader-name,
      .slick-club-leader-name .c-message__sender_button {
        text-decoration: underline ${color} !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 3px;
      }
      .slick-club-profile { display: block; padding: 16px; }
      .slick-club-profile__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .slick-club-profile__heading {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        opacity: 0.6;
      }
      .slick-club-profile__rows { margin: 0 0 8px; display: grid; gap: 4px; }
      .slick-club-profile__row { display: flex; gap: 12px; font-size: 13px; }
      .slick-club-profile__row dt { flex: 0 0 104px; opacity: 0.65; }
      .slick-club-profile__row dd { margin: 0; min-width: 0; overflow-wrap: anywhere; user-select: text; }
      .slick-club-profile__button {
        font: inherit;
        font-size: 12px;
        padding: 3px 10px;
        border: 1px solid rgba(134, 134, 134, 0.4);
        border-radius: 6px;
        background: rgba(134, 134, 134, 0.09);
        color: inherit;
        cursor: pointer;
      }
      .slick-club-profile__button:hover:not(:disabled) { background: rgba(134, 134, 134, 0.2); }
      .slick-club-profile__button:disabled { opacity: 0.6; cursor: default; }
      .slick-club-profile__note { margin: 6px 0 0; font-size: 12px; opacity: 0.65; }
      .slick-club-profile__note--error { color: #ec3750; opacity: 1; }
    `);
    void this.refreshView();
  }

  private async refreshView() {
    const [leader, coLeader, member] = await Promise.all([
      this.resolveEmoji(this.config.badgeEmoji, '♣'),
      this.resolveEmoji(this.config.coLeaderEmoji, '🤝'),
      this.resolveEmoji(this.config.memberEmoji, '🧑‍💻'),
    ]);
    this.view.set({
      leader,
      coLeader,
      member,
      underline: this.config.underline === true,
      otherRoles: this.config.showOtherRoles === true && !!this.config.apiKey.trim(),
      profile: this.config.showProfile !== false && !!this.config.apiKey.trim(),
    });
  }

  // Custom emoji need their image URL; anything else is shown as typed.
  private async resolveEmoji(setting: string, fallback: string): Promise<Emoji> {
    const raw = setting.trim();
    const match = raw.match(EMOJI_NAME);
    if (!match) return { text: raw || fallback, url: null };

    const name = match[1].toLowerCase();
    try {
      this.emojiList ??= this.api
        .userAPI<{ emoji?: Record<string, string> }>('emoji.list', {}, { signal: this.api.signal })
        .then((response) => response.emoji ?? {});
      const list = await this.emojiList;
      let url = list[name];
      for (let hops = 0; url?.startsWith('alias:') && hops < 5; hops++) url = list[url.slice(6)];
      if (url?.startsWith('http')) return { text: `:${name}:`, url };
      this.log(`no custom emoji called :${name}:, showing ${fallback} instead`);
    } catch (error) {
      this.emojiList = null;
      this.log("could not load the workspace's emoji", error);
    }
    return { text: fallback, url: null };
  }

  // Answers depend on the key, so a new key starts fresh (a short hash, never the key itself).
  // "k2": keyed answers saved before co-leaders were recorded are looked up again.
  private key(userId: string) {
    const apiKey = this.config.apiKey.trim();
    if (!apiKey) return `n:${userId}`;
    let hash = 0;
    for (const char of apiKey) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
    return `k2${(hash >>> 0).toString(36)}:${userId}`;
  }

  private async lookUp(userId: string): Promise<Lookup | null> {
    try {
      return await this.cache.get(this.key(userId), () => this.limiter.run(() => this.request(userId)));
    } catch (error) {
      // Blocked: nothing was sent and nothing is cached, so a later render can try again.
      if (error instanceof Blocked) {
        if (this.lastBlockLog !== error.message) this.log(`holding off on Club API requests: ${error.message}`);
        this.lastBlockLog = error.message;
      } else {
        this.log(`could not check ${userId}`, error);
      }
      return null;
    }
  }

  /**
   * An on-demand lookup from a profile's Resync button: asks the Club API now, whatever the
   * saved answer's age, and replaces it. Still one at a time, but not held back by the hourly budget.
   */
  private async refresh(userId: string): Promise<Fresh> {
    const apiKey = this.config.apiKey.trim();
    if (!apiKey) return { error: 'Add a Club API key in the plugin settings first.' };
    try {
      const result = await this.limiter.run(() => personFull(this.api.fetch.bind(this.api), userId, apiKey), { force: true });
      this.limiter.recovered();
      // Swap the saved answer. The delete is awaited so the old one can't be read back.
      const key = this.key(userId);
      this.cache.forget(key);
      await this.api.storage.delete(`cache:club_leader:${key}`);
      await this.cache.get(key, async () => result.lookup);
      return { info: result.lookup, hidden: result.hidden };
    } catch (error) {
      if (error instanceof Blocked) return { error: 'The Club API rejected your API key. Fix it in the plugin settings.' };
      if (error instanceof KeyRejected) return { error: 'Your API key needs Read permission for club details.' };
      this.log(`could not resync ${userId}`, error);
      return { error: "Couldn't reach the Club API. Try again in a moment." };
    }
  }

  /** One lookup. Errors become a cached FAILED so they aren't retried on every render. */
  private async request(userId: string): Promise<Lookup> {
    const apiKey = this.config.apiKey.trim();
    const fetch = this.api.fetch.bind(this.api);
    try {
      let result: Lookup;
      if (!apiKey) {
        result = await leaderBySlack(fetch, userId, '');
      } else if (this.keyedEndpoint === 'person') {
        try {
          result = await person(fetch, userId, apiKey);
        } catch (error) {
          if (!(error instanceof KeyRejected)) throw error;
          // The key may just lack Read permission; /leader/slack accepts any valid key.
          result = await leaderBySlack(fetch, userId, apiKey);
          this.keyedEndpoint = 'leader';
          this.log("your API key can't use /person (it needs Read permission), so tooltips show the club name only");
        }
      } else {
        result = await leaderBySlack(fetch, userId, apiKey);
      }
      this.limiter.recovered();
      this.lastBlockLog = '';
      if (this.limiter.total % 25 === 0) this.logTotal();
      return result;
    } catch (error) {
      if (error instanceof KeyRejected) {
        this.limiter.stop();
        this.log('the Club API rejected your API key; fix it in the plugin settings (no more requests until then)');
      } else if (error instanceof HttpError && error.status < 500 && error.status !== 429) {
        // Something about this one person; no need to slow down for everyone.
        this.log(`Club API said ${error.status} for ${userId}`);
      } else {
        this.limiter.pause();
        this.log('Club API request failed, pausing requests for a while', error);
      }
      return FAILED;
    }
  }

  private logTotal() {
    if (this.limiter.total) this.log(`${this.limiter.total} Club API requests since Slack started`);
  }
}
