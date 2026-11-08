// Finding Slack's own mic button in a huddle and working out which way it is
// pointing. Slack's markup changes between releases, so this reads every hint
// it can and refuses to click unless they agree: clicking a live mic would mute
// the person asking not to be muted.

export type MicState = 'muted' | 'live' | 'unknown';

export type MicSignals = {
  label?: string | null;
  title?: string | null;
  /** Text of a nested tooltip / screen-reader node, when there is one. */
  text?: string | null;
  pressed?: string | null;
  checked?: string | null;
};

// The button is named for what it will do, so "Unmute" means the mic is muted.
const UNMUTE = /\bunmute\b|\bun-mute\b/i;
const MUTE = /^(mute|mute microphone|mute my (microphone|mic))\b/i;

/** Votes from the label and the toggle state; anything contradictory is unknown. */
export function readMicState({ label, title, text, pressed, checked }: MicSignals): MicState {
  const votes: MicState[] = [];
  for (const words of [label, title, text]) {
    if (!words) continue;
    if (UNMUTE.test(words)) votes.push('muted');
    else if (MUTE.test(words)) votes.push('live');
  }
  for (const state of [pressed, checked]) {
    if (state === 'true') votes.push('muted');
    else if (state === 'false') votes.push('live');
  }
  const first = votes[0];
  if (!first) return 'unknown';
  return votes.every((vote) => vote === first) ? first : 'unknown';
}

const NOT_THIS_MIC = /camera|video|screen|share|speaker|volume|headphone|output|everyone|others|participant/i;
const MIC_WORD = /mic|microphone/i;
const BUTTONS = 'button, [role="button"], [role="switch"]';

function signalsOf(element: Element): MicSignals {
  return {
    label: element.getAttribute('aria-label'),
    title: element.getAttribute('title'),
    text: element.querySelector('[class*="tooltip" i], [class*="sr-only" i], [class*="aria" i]')?.textContent ?? null,
    pressed: element.getAttribute('aria-pressed') ?? element.getAttribute('data-pressed'),
    checked: element.getAttribute('aria-checked'),
  };
}

function looksLikeMicButton(element: Element): boolean {
  // A per-participant "mute microphone" row lives in a menu and would mute
  // somebody else; leave every menu alone.
  if (element.closest('[role="menu"], [role="dialog"]')) return false;
  const words = [
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-qa'),
    element.className,
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  if (!MIC_WORD.test(words)) return false;
  return !NOT_THIS_MIC.test(words);
}

/**
 * How much a candidate looks like the mute toggle rather than, say, the device
 * picker beside it: only a mute verb or a pressed state makes it a toggle.
 */
function toggleScore(element: HTMLElement): number {
  if (!looksLikeMicButton(element)) return 0;
  const signals = signalsOf(element);
  const words = `${signals.label ?? ''} ${signals.title ?? ''} ${signals.text ?? ''}`;
  let score = 0;
  if (UNMUTE.test(words) || MUTE.test(words)) score += 4;
  if (signals.pressed !== null || signals.checked !== null) score += 2;
  if (/huddle|footer|bottom|control|bar/i.test(`${element.className} ${element.dataset.qa ?? ''}`)) score += 1;
  return score >= 2 ? score : 0;
}

/** The local mic toggle, or null rather than a guess at something beside it. */
export function findMicButton(doc: Document): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestScore = 0;
  for (const element of doc.querySelectorAll<HTMLElement>(BUTTONS)) {
    if (!element.isConnected || element.getClientRects().length === 0 || element.closest('[hidden], [aria-hidden="true"]')) continue;
    const score = toggleScore(element);
    if (score > bestScore) {
      best = element;
      bestScore = score;
    }
  }
  return best;
}

export function micStateOf(button: Element): MicState {
  return readMicState(signalsOf(button));
}

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type UnmuteResult = 'unmuted' | 'failed' | 'never-muted' | 'no-button' | 'unsure';

export type UnmuteOptions = {
  /** How long to wait for Slack to actually apply the mute before clicking. */
  observeMs?: number;
  attempts?: number;
  signal?: AbortSignal;
  log?: (...args: unknown[]) => void;
};

/**
 * Clicks Slack's own mic button, so the unmute goes through exactly the path a
 * person clicking it would. Waits for the button to report muted first: clicking
 * before Slack has applied the mute would turn the mute into a second mute.
 */
export async function unmuteSelf(doc: Document, options: UnmuteOptions = {}): Promise<UnmuteResult> {
  const { observeMs = 2500, attempts = 3, signal, log = () => {} } = options;
  const aborted = () => signal?.aborted === true;

  let button = findMicButton(doc);
  if (!button) return 'no-button';

  const deadline = Date.now() + observeMs;
  let state = micStateOf(button);
  while (state !== 'muted' && Date.now() < deadline && !aborted()) {
    await tick(200);
    button = findMicButton(doc);
    if (!button) return 'no-button';
    state = micStateOf(button);
  }
  if (state !== 'muted') {
    log('the mic never reported muted, leaving it alone');
    return 'never-muted';
  }

  for (let attempt = 0; attempt < attempts && !aborted(); attempt += 1) {
    button = findMicButton(doc);
    if (!button) return 'no-button';
    if (micStateOf(button) !== 'muted') break;
    button.click();
    log(`clicked the mic button (attempt ${attempt + 1})`);
    await tick(300);
  }

  state = button && micStateOf(button);
  if (state === 'live') return 'unmuted';
  return state === 'muted' ? 'failed' : 'unsure';
}
