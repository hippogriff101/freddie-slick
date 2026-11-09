// Badge (and optional underline) for Hack Club club leaders, and optionally members.
//
// Keeping Club API traffic low:
// - answers, including failures, are cached in Slick storage (people for `recheckDays`, failures for an hour)
// - only senders whose name is actually shown are looked up, never grouped follow-up messages
// - requests go one at a time with a gap, under an hourly budget, and pause after errors

import { SlickPlugin } from '$slick';
import { describe, FAILED, HttpError, KeyRejected, leaderBySlack, person, type Lookup } from './api.ts';
import { Blocked, Limiter } from './limiter.ts';
import * as meta from './meta.ts';

type Emoji = { text: string; url: string | null };
type View = { leader: Emoji; coLeader: Emoji; member: Emoji; underline: boolean; otherRoles: boolean };
type Message = { user?: string; bot_id?: string };

const USER_ID = /^[UW][A-Z0-9]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const FAILED_TTL_MS = 60 * 60 * 1000;
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
  static readonly liveSettings = ['badgeEmoji', 'coLeaderEmoji', 'memberEmoji', 'showOtherRoles', 'recheckDays', 'underline', 'underlineColor'];

  private cache = this.api.Cache<Lookup>('club_leader', (info) =>
    info.failed ? FAILED_TTL_MS : Math.max(1, Number(this.config.recheckDays) || 7) * DAY_MS,
  );
  private limiter = new Limiter({ gapMs: 400, perHour: 120, backoffMs: 15 * 60 * 1000, maxBackoffMs: 4 * 60 * 60 * 1000 });
  private view = new this.api.Store<View>({
    leader: { text: '♣', url: null },
    coLeader: { text: '', url: null },
    member: { text: '', url: null },
    underline: false,
    otherRoles: false,
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
