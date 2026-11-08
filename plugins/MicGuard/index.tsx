import { SlickPlugin } from '$slick';
import { installMenuToggle } from './menus.ts';
import * as meta from './meta.ts';
import { unmuteSelf, type UnmuteResult } from './mic.ts';

type HuddleState = {
  peers?: { byId?: Record<string, { userId?: string }> };
  members?: Record<string, { profile?: { display_name?: string; real_name?: string }; name?: string }>;
};

const LABEL = 'Keep me unmuted';

export default class MicGuard extends SlickPlugin<typeof meta.settings> {
  static readonly requiredAPIs = ['redux'] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // Toggling these should not restart the plugin and drop its menu rows.
  static readonly liveSettings = ['keepUnmuted', 'tellMe', 'debug'] as const;

  private readonly docs = new Map<Document, { dispose: () => void; refresh: () => void }>();
  /** Our own copy of keepUnmuted, so a click counts at once even while Slick saves it. */
  private keepOn = false;

  start(): void {
    this.keepOn = this.config.keepUnmuted === true;
    this.hook(document);
    // A huddle can live in Slack's own pop-out window, which is another document.
    this.api.onDocument((doc) => this.hook(doc));
    const handlePeerMute = (attendeeId: string, dispatch: unknown, getState: unknown) => {
      void this.onPeerMute(attendeeId, dispatch as never, getState as never);
    };
    this.api.redux.patchThunk('displayAlertMessage', (original: (...args: unknown[]) => unknown) => {
      return function (this: unknown, ...args: unknown[]) {
        const thunk = Reflect.apply(original, this, args);
        const payload = args[0] as { alert?: unknown; peerId?: unknown } | undefined;
        // Slack raises this when somebody else mutes you; muting yourself does not.
        if (payload?.alert !== 'peerMuteRequest' || typeof payload.peerId !== 'string' || typeof thunk !== 'function') {
          return thunk;
        }
        const attendeeId = payload.peerId;
        return new Proxy(thunk, {
          apply(target, receiver, thunkArgs) {
            handlePeerMute(attendeeId, thunkArgs[0], thunkArgs[1]);
            return Reflect.apply(target, receiver, thunkArgs);
          },
        });
      };
    });
  }

  stop(): void {
    for (const entry of this.docs.values()) entry.dispose();
    this.docs.clear();
  }

  onSettingsChange(): void {
    this.keepOn = this.config.keepUnmuted === true;
    for (const entry of this.docs.values()) entry.refresh();
  }

  private hook(doc: Document): void {
    const existing = this.docs.get(doc);
    if (existing) {
      existing.refresh();
      return;
    }
    this.docs.set(
      doc,
      installMenuToggle(doc, {
        label: LABEL,
        isOn: () => this.keepOn,
        onToggle: (next) => {
          this.keepOn = next;
          this.log(next ? 'keeping you unmuted' : 'letting mutes stick');
          this.api.settings.set('keepUnmuted', next).catch((error: unknown) => this.log('could not save the setting', error));
          // Show the change in every window's menus straight away.
          for (const entry of this.docs.values()) entry.refresh();
        },
        // Menus open all over Slack, so only narrate them when asked to.
        log: (...args) => {
          if (this.config.debug === true) this.log(...args);
        },
      }),
    );
  }

  private async onPeerMute(
    attendeeId: string,
    dispatch: ((action: unknown) => unknown) | undefined,
    getState: (() => HuddleState | undefined) | undefined,
  ): Promise<void> {
    try {
      if (this.api.signal.aborted || !this.keepOn) return;
      if (typeof dispatch !== 'function') return;
      const name = nameOf(attendeeId, typeof getState === 'function' ? getState() : undefined);
      if (this.config.debug === true) this.log(`${name} muted you; unmuting`);

      const result = await this.unmute();
      if (this.config.debug === true) this.log(`unmute result: ${result}`);
      if (this.api.signal.aborted || this.config.tellMe === false) return;
      const message = toastFor(name, result);
      if (!message) return;
      const toast = await this.api.redux.waitForThunkCreator('enqueueHuddleToast');
      if (this.api.signal.aborted) return;
      await dispatch(toast({ content: message, huddleToastType: 'peer_mute_request' }));
    } catch {
      // A missing lazy Slack module must never break the mute Slack was handling.
    }
  }

  /** Tries every window we know about, since the button can be in a pop-out. */
  private async unmute(): Promise<UnmuteResult> {
    let last: UnmuteResult = 'no-button';
    for (const doc of this.docs.keys()) {
      const result = await unmuteSelf(doc, { signal: this.api.signal, log: this.log.bind(this) });
      if (result === 'unmuted' || result === 'failed' || result === 'unsure') return result;
      if (result === 'never-muted') last = result;
    }
    return last;
  }
}

function nameOf(attendeeId: string, state: HuddleState | undefined): string {
  const userId = state?.peers?.byId?.[attendeeId]?.userId;
  if (typeof userId !== 'string' || !userId) return 'Someone';
  const member = state?.members?.[userId];
  return member?.profile?.display_name || member?.profile?.real_name || member?.name || 'Someone';
}

function toastFor(name: string, result: UnmuteResult): string | null {
  switch (result) {
    case 'unmuted':
      return `${name} muted you, so Mic Guard unmuted you again.`;
    case 'failed':
      return `${name} muted you, and Mic Guard could not unmute you.`;
    case 'no-button':
      return `${name} muted you. Mic Guard could not find the mic button.`;
    case 'unsure':
      return `${name} muted you. Mic Guard tried to unmute you; check your mic.`;
    default:
      return null;
  }
}
