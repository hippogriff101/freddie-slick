// A "Keep me unmuted" row in the huddle's own menus: its ⋯ menu, its mic menu and
// its settings menu. Which menu is which comes from the button that opened it
// (falling back to the row labels). Adding and highlighting the row is shared code.

import { addRow, MENU, squish, watchMenus } from '../_shared/menus.ts';

export type MenuKind = 'more' | 'mic' | 'settings' | null;

const MIC_WORD = /mic(rophone)?\b|input device|audio input/i;
const NOT_MIC = /camera|video|screen|output|speaker|headphone|volume/i;
// Settings menus only count inside a huddle; "options" alone matches menus all over Slack.
const HUDDLE_SETTINGS = /\b(huddle|call)\b.*\b(settings|preferences|options)\b|\b(settings|preferences|options)\b.*\b(huddle|call)\b/i;
// The ⋯ button in a huddle's controls.
const MORE = /\bmore\b|options|actions|overflow|ellipsis|kebab/i;
// Host controls that must never be confused with the local toggle.
const NOT_LOCAL = /everyone|others|participants?\b|huddle settings for/i;
// Rows that act on someone else: a menu offering these is a participant menu, not yours.
const SOMEONE_ELSE = /view (full )?profile|send (a )?message|remove from huddle|spotlight|pop out video/i;
const MUTES_SOMEONE = /(^|\|\s*)mute microphone\b/i;

/**
 * Which menu this is, from the button that opened it and, failing that, what it
 * offers. `inHuddle` says whether that button is part of a huddle. Null means leave it alone.
 */
export function menuKind(triggerWords: string, itemLabels: readonly string[], inHuddle = false): MenuKind {
  const trigger = triggerWords.trim();
  const labels = itemLabels.join(' | ');
  if (SOMEONE_ELSE.test(labels)) return null;
  if (trigger && !NOT_LOCAL.test(trigger)) {
    if (MIC_WORD.test(trigger) && !NOT_MIC.test(trigger)) return 'mic';
    if (HUDDLE_SETTINGS.test(trigger)) return 'settings';
    // Your own ⋯ menu never offers to mute a microphone; a participant's does.
    if (inHuddle && MORE.test(trigger) && !MUTES_SOMEONE.test(labels)) return 'more';
  }
  // A "Mute microphone" row mutes someone else, so a menu offering it isn't your mic menu.
  if (MIC_WORD.test(labels) && !NOT_MIC.test(labels) && !NOT_LOCAL.test(labels) && !MUTES_SOMEONE.test(labels)) return 'mic';
  if (/\b(huddle|call) settings\b/i.test(labels)) return 'settings';
  return null;
}

/** Whether the control that opened a menu belongs to a huddle (or the whole window is one). */
export function isInHuddle(trigger: Element | null, doc: Document): boolean {
  if (/huddle/i.test(doc.defaultView?.name ?? '')) return true;
  return !!trigger?.closest('[data-qa*="huddle" i], [class*="huddle" i], [aria-label*="huddle" i]');
}

/** Words that describe the control that opened a menu, e.g. "Microphone" or "More actions". */
export function describeTrigger(element: Element | null): string {
  const parts: string[] = [];
  for (let node = element, depth = 0; node && depth < 4; node = node.parentElement, depth += 1) {
    for (const value of [node.getAttribute('aria-label'), node.getAttribute('title'), node.getAttribute('data-qa'), node.getAttribute('name')]) {
      if (value) parts.push(value);
    }
    const own = squish([...node.childNodes].some((child) => child.nodeType === 3) ? node.textContent : '');
    if (own) parts.push(own);
    if (parts.length > 6) break;
  }
  return [...new Set(parts)].join(' ');
}

const MARK = 'data-slick-mic-guard';

function labelsOf(menu: Element): string[] {
  return [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')]
    .filter((item) => !item.closest(`[${MARK}]`))
    .map((item) => squish(item.textContent))
    .filter(Boolean);
}

// The tick is shown or hidden by CSS from aria-checked (see plugins/_shared/menus.ts).
function paint(item: HTMLElement, on: boolean): void {
  item.setAttribute('aria-checked', on ? 'true' : 'false');
  item.title = on ? 'If someone mutes you, Mic Guard unmutes you again' : 'Mutes from other people stick';
}

export type MenuToggleState = {
  label: string;
  isOn: () => boolean;
  onToggle: (next: boolean) => void;
  log: (...args: unknown[]) => void;
};

/** Watches one document for huddle menus. */
export function installMenuToggle(doc: Document, options: MenuToggleState): { dispose: () => void; refresh: () => void } {
  const watcher = watchMenus(doc, (menu) => {
    const existing = menu.querySelector<HTMLElement>(`[${MARK}] [role="menuitemcheckbox"], [role="menuitemcheckbox"][${MARK}]`);
    if (existing) {
      paint(existing, options.isOn());
      return;
    }
    const trigger = watcher.trigger();
    const kind = menuKind(describeTrigger(trigger), labelsOf(menu), isInHuddle(trigger, doc));
    if (!kind) {
      options.log('left a menu alone; rows were:', labelsOf(menu).slice(0, 8));
      return;
    }
    const item = addRow(menu, {
      label: options.label,
      mark: MARK,
      role: 'menuitemcheckbox',
      onPick: () => {
        const next = !options.isOn();
        options.onToggle(next);
        // React may re-render the row away; paint this copy now and let the next sweep re-add it.
        paint(item!, next);
      },
    });
    if (!item) return;
    paint(item, options.isOn());
    options.log(`added the toggle to the huddle's ${kind} menu`);
  });

  return {
    refresh() {
      for (const item of doc.querySelectorAll<HTMLElement>(`[${MARK}] [role="menuitemcheckbox"], [role="menuitemcheckbox"][${MARK}]`))
        paint(item, options.isOn());
    },
    dispose() {
      watcher.dispose();
      for (const row of doc.querySelectorAll(`${MENU} [${MARK}]`)) row.remove();
    },
  };
}
