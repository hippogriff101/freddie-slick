import { SlickPlugin } from '$slick';
import { installMenuHook } from './menu.ts';
import * as meta from './meta.ts';
import { openPopOut, type PopOutHandle, type PopOutSize } from './popout.ts';
import { isLive, nameFor } from './tiles.ts';

const LABEL = 'Pop out video';

export default class PopOutVideo extends SlickPlugin<typeof meta.settings> {
  // No Slack modules needed: the menu is found in the DOM.
  static readonly requiredAPIs = [] as const;
  static readonly id = meta.id;
  static readonly pluginName = meta.pluginName;
  static readonly description = meta.description;
  static readonly category = meta.category;
  static readonly defaultEnabled = meta.defaultEnabled;
  static readonly settings = meta.settings;
  // These only affect windows opened from now on, so no reason to restart the
  // plugin and close the ones already open.
  static readonly liveSettings = ['size', 'muted', 'closeWhenVideoEnds'] as const;

  private readonly menus = new Map<Document, () => void>();
  private readonly windows = new Map<string, PopOutHandle>();

  start(): void {
    this.hook(document);
    // Huddles can live in Slack's own pop-out windows, which are separate documents.
    this.api.onDocument((doc) => this.hook(doc));
  }

  stop(): void {
    for (const dispose of this.menus.values()) dispose();
    this.menus.clear();
    for (const window of this.windows.values()) window.close();
    this.windows.clear();
  }

  private hook(doc: Document): void {
    if (this.menus.has(doc)) return;
    this.menus.set(
      doc,
      installMenuHook(doc, {
        label: LABEL,
        log: this.log,
        onPick: (video) => this.popOut(video),
      }),
    );
  }

  private popOut(video: HTMLVideoElement): void {
    // Nothing to mirror if the tile has no stream yet (camera off, or still connecting).
    if (!isLive(video)) {
      this.log('no video stream on that tile yet');
      return;
    }
    const name = nameFor(video);
    // Keyed by stream, not name: two people can share a name, or both fall back to "Participant".
    const key = (video.srcObject as MediaStream).id || name;
    const existing = this.windows.get(key);
    if (existing && !existing.closed) {
      existing.focus();
      return;
    }
    const handle = openPopOut(video, {
      title: name,
      size: this.config.size as PopOutSize,
      muted: this.config.muted !== false,
      closeWhenVideoEnds: this.config.closeWhenVideoEnds === true,
      onClose: () => this.windows.delete(key),
    });
    if (!handle) {
      this.log('the pop-out window was blocked; allow pop-ups for Slack');
      return;
    }
    this.windows.set(key, handle);
  }
}
