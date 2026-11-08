// Owns the popped-out window: a bare page with one video element mirroring the
// tile's MediaStream. Slack keeps decoding the stream, the window is just a
// second view of it, so the call is untouched.

export type PopOutSize = 'medium' | 'large' | 'huge' | 'fill';

export type PopOutOptions = {
  title: string;
  size: PopOutSize;
  muted: boolean;
  closeWhenVideoEnds: boolean;
  onClose: () => void;
};

export type PopOutHandle = {
  readonly closed: boolean;
  focus: () => void;
  close: () => void;
};

const SIZES: Record<Exclude<PopOutSize, 'fill'>, [number, number]> = {
  medium: [960, 540],
  large: [1280, 720],
  huge: [1600, 900],
};
const MARGIN = 40;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 180;
// Cameras drop their stream briefly while renegotiating, so a missing stream
// only closes the window once it has stayed missing.
const EMPTY_GRACE = 3000;
// Stream changes arrive as events; this slower check only catches the window being
// closed and the tile disappearing, which fire no event here.
const TICK = 1000;
// Controls hide after this long without the mouse moving, like a video player.
const IDLE_MS = 2500;

const CSS = `
  :root { color-scheme: dark; }
  html, body { height: 100%; margin: 0; overflow: hidden; }
  body { background: #000; color: #fff; font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; }
  video { display: block; width: 100%; height: 100%; object-fit: contain; background: #000; }
  .note { position: absolute; inset: 0; display: grid; place-items: center; color: #ffffff8a; font-size: 15px; }
  .note[hidden] { display: none; }
  .bar {
    position: absolute; inset: auto 0 0 0; display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; background: linear-gradient(to top, #000000d9, #0000);
    opacity: 0; transition: opacity 160ms ease; pointer-events: none;
  }
  /* Shown by script on mouse movement; :hover alone is unreliable in a window that isn't focused yet. */
  .bar.shown, .bar:hover, .bar:focus-within { opacity: 1; pointer-events: auto; }
  body.idle, body.idle video { cursor: none; }
  .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
  button {
    font: inherit; color: #fff; background: #ffffff1f; border: 1px solid #ffffff2e;
    border-radius: 6px; padding: 4px 10px; cursor: pointer;
  }
  button:hover { background: #ffffff33; }
`;

const BODY = `
<video autoplay playsinline muted></video>
<div class="note" hidden>Camera off</div>
<div class="bar">
  <span class="title"></span>
  <span class="spacer"></span>
  <button type="button" data-act="audio"></button>
  <button type="button" data-act="fullscreen">Fullscreen</button>
  <button type="button" data-act="close">Close</button>
</div>`;

function features(size: PopOutSize): string {
  const [width, height] =
    size === 'fill'
      ? [Math.max(MIN_WIDTH, screen.availWidth - MARGIN * 2), Math.max(MIN_HEIGHT, screen.availHeight - MARGIN * 2)]
      : SIZES[size];
  const left = Math.max(0, Math.round((screen.availWidth - width) / 2));
  const top = Math.max(0, Math.round((screen.availHeight - height) / 2));
  return [
    'popup=yes',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'resizable=yes',
    'scrollbars=no',
    'menubar=no',
    'toolbar=no',
    'location=no',
    'status=no',
  ].join(',');
}

export function openPopOut(source: HTMLVideoElement, options: PopOutOptions): PopOutHandle | null {
  const popup = window.open('', `slick-pop-out-${Date.now()}`, features(options.size));
  if (!popup) return null;
  const doc = popup.document;
  doc.head.innerHTML = `<meta charset="utf-8"><style>${CSS}</style>`;
  doc.body.innerHTML = BODY;
  doc.title = options.title;

  const video = doc.querySelector('video');
  const note = doc.querySelector<HTMLElement>('.note');
  const title = doc.querySelector<HTMLElement>('.title');
  const audio = doc.querySelector<HTMLButtonElement>('[data-act="audio"]');
  if (!video || !note || !title || !audio) {
    popup.close();
    return null;
  }
  title.textContent = options.title;

  const showAudio = () => {
    audio.textContent = video.muted ? 'Unmute' : 'Mute';
    audio.title = `${audio.textContent} (m)`;
  };
  video.muted = options.muted;
  showAudio();

  const bar = doc.querySelector<HTMLElement>('.bar');
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const wake = () => {
    bar?.classList.add('shown');
    doc.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      bar?.classList.remove('shown');
      doc.body.classList.add('idle');
    }, IDLE_MS);
  };
  for (const type of ['mousemove', 'pointerdown', 'keydown', 'focus'] as const) popup.addEventListener(type, wake);
  // Show the controls when it first opens, so people know they're there.
  wake();

  // Keep a reference so the listeners come off the same stream they went on.
  let watched: MediaStream | null = null;
  let update = (): void => {};
  const onTracks = () => update();
  const mirror = () => {
    // Not instanceof: the tile may live in Slack's huddle window, whose MediaStream is a different class.
    const object = source.srcObject;
    const stream = object && typeof object === 'object' && 'getVideoTracks' in object ? (object as MediaStream) : null;
    if (stream !== watched) {
      watched?.removeEventListener('addtrack', onTracks);
      watched?.removeEventListener('removetrack', onTracks);
      stream?.addEventListener('addtrack', onTracks);
      stream?.addEventListener('removetrack', onTracks);
      watched = stream;
    }
    if (stream === video.srcObject) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
  };
  video.addEventListener('loadedmetadata', () => void video.play().catch(() => {}));
  // Slack swaps the tile's stream when a camera reconnects; follow it straight away.
  const sourceEvents = ['loadedmetadata', 'emptied', 'play'] as const;
  for (const type of sourceEvents) source.addEventListener(type, onTracks);

  const audio_ = () => {
    video.muted = !video.muted;
    showAudio();
  };
  const fullscreen = () => {
    if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
    else void doc.documentElement.requestFullscreen?.().catch(() => {});
  };

  audio.addEventListener('click', audio_);
  doc.querySelector('[data-act="fullscreen"]')?.addEventListener('click', fullscreen);
  doc.querySelector('[data-act="close"]')?.addEventListener('click', () => popup.close());
  video.addEventListener('dblclick', fullscreen);
  doc.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') popup.close();
    else if (event.key === 'm' || event.key === 'M') audio_();
    else if (event.key === 'f' || event.key === 'F') fullscreen();
  });

  let emptySince: number | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    clearTimeout(idleTimer);
    for (const type of sourceEvents) source.removeEventListener(type, onTracks);
    watched?.removeEventListener('addtrack', onTracks);
    watched?.removeEventListener('removetrack', onTracks);
    watched = null;
    video.srcObject = null;
    options.onClose();
  };

  // Assigned before any event can call it: stream and video events only fire after this function returns.
  update = (): void => {
    if (stopped) return;
    if (popup.closed) {
      stop();
      return;
    }
    mirror();
    const live = !!watched && source.isConnected && watched.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);
    note.hidden = live;
    if (live) {
      emptySince = null;
      return;
    }
    if (!options.closeWhenVideoEnds) return;
    emptySince ??= Date.now();
    if (Date.now() - emptySince >= EMPTY_GRACE) popup.close();
  };

  popup.addEventListener('pagehide', stop);
  const timer = setInterval(update, TICK);
  update();
  popup.focus();
  return {
    get closed() {
      return popup.closed;
    },
    focus: () => popup.focus(),
    close: () => {
      if (!popup.closed) popup.close();
      stop();
    },
  };
}
