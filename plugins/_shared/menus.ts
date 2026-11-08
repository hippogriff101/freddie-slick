// Helpers for adding a row to one of Slack's own menus. Shared by plugins that do this;
// the build skips this folder because it has no index.ts.
//
// Slack owns its menus and renames their components between releases, so rows are
// added by watching the DOM and cloning one of Slack's own rows, which keeps its look.
// Slack highlights a row with JavaScript (a class it adds on hover), not CSS :hover,
// so a cloned row has to copy that class across itself to highlight like the others.

export const MENU = '[role="menu"]';
const HIGHLIGHT = /highlight|hover|active|focus|selected/i;
const STYLE_KEY = 'data-slick-menu-rows';

export const squish = (value: string | null | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();

/** The leaf that holds the whole row's text, so its icon and layout survive a rename. */
function labelNode(row: Element): Element | null {
  const whole = squish(row.textContent);
  if (!whole) return null;
  let match: Element | null = null;
  for (const child of row.querySelectorAll('*')) {
    if (child.children.length === 0 && squish(child.textContent) === whole) match = child;
  }
  return match;
}

/** Renames a cloned row without destroying the icon beside its text. */
function rename(row: Element, label: string): void {
  const leaf = labelNode(row);
  if (leaf) {
    leaf.textContent = label;
    return;
  }
  // Some menus keep the text in a bare text node rather than a span; the last one with words in it is the label.
  const view = row.ownerDocument.defaultView;
  if (!view) return;
  const walker = row.ownerDocument.createTreeWalker(row, view.NodeFilter.SHOW_TEXT);
  let target: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (squish(node.textContent)) target = node;
  }
  if (target) target.textContent = label;
  else row.append(label);
}

/** The element that sits directly in the menu's list: the item itself, or a wrapper holding only it. */
function outermost(item: HTMLElement): HTMLElement {
  let node = item;
  while (node.parentElement && node.parentElement.children.length === 1 && !node.parentElement.matches(MENU)) {
    node = node.parentElement;
  }
  return node;
}

/** Highlight classes some peers have and others don't: the hovered row's, right now. */
function highlightTokens(peers: Element[]): string[] {
  const counts = new Map<string, number>();
  for (const peer of peers) for (const token of peer.classList) if (HIGHLIGHT.test(token)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts].filter(([, count]) => count < peers.length).map(([token]) => token);
}

/** Fallback look for when Slack's own highlight class can't be learned. */
function ensureStyle(doc: Document): void {
  if (doc.head.querySelector(`style[${STYLE_KEY}]`)) return;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_KEY, '');
  style.textContent = `
    .slick-menu-row--hl {
      background: rgba(var(--sk_highlight, 18, 100, 163), 1) !important;
      color: #fff !important;
    }
    .slick-menu-row--hl * { color: #fff !important; }
    .slick-menu-check {
      display: inline-flex;
      align-items: center;
      margin-left: auto;
      padding-left: 12px;
      flex: none;
    }
    .slick-menu-check svg { width: 16px; height: 16px; }
    [aria-checked="false"] > .slick-menu-check,
    [aria-checked="false"] .slick-menu-check { visibility: hidden; }
  `;
  doc.head.append(style);
}

/** Highlights `wrapper`/`item` on hover the same way Slack highlights its own rows. */
function followHighlight(wrapper: HTMLElement, item: HTMLElement): void {
  const levels: [HTMLElement, () => Element[]][] = [
    [wrapper, () => [...(wrapper.parentElement?.children ?? [])].filter((el) => el !== wrapper)],
    [item, () => [...(item.closest(MENU)?.querySelectorAll(item.tagName) ?? [])].filter((el) => el !== item && el.getAttribute('role') === item.getAttribute('role'))],
  ];
  let applied: [HTMLElement, string[]][] = [];

  const enter = () => {
    applied = [];
    for (const [own, peersOf] of levels) {
      const peers = peersOf();
      const tokens = highlightTokens(peers);
      if (!tokens.length) continue;
      // Slack leaves the last row it highlighted lit; dim it so only one row is highlighted.
      for (const peer of peers) peer.classList.remove(...tokens);
      own.classList.add(...tokens);
      applied.push([own, tokens]);
    }
    if (!applied.length) {
      ensureStyle(item.ownerDocument);
      item.classList.add('slick-menu-row--hl');
    }
  };
  const leave = () => {
    for (const [own, tokens] of applied) own.classList.remove(...tokens);
    applied = [];
    item.classList.remove('slick-menu-row--hl');
  };
  wrapper.addEventListener('mouseenter', enter);
  wrapper.addEventListener('mouseleave', leave);
  item.addEventListener('focus', enter);
  item.addEventListener('blur', leave);
}

export type RowOptions = {
  label: string;
  /** Attribute that marks rows this plugin added. */
  mark: string;
  /**
   * A checkbox row gets its own tick (shown by `aria-checked`) instead of the cloned
   * row's icon, which may be an icon font or image with nothing to draw a tick on.
   */
  role: 'menuitem' | 'menuitemcheckbox';
  /** SVG markup for a 20×20 icon, replacing the cloned row's icon (menuitem rows only). */
  icon?: string;
  onPick: (event: Event) => void;
};

const TICK =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Clones the last row of `menu` into a new row, adds it to the menu and returns its item. */
export function addRow(menu: Element, options: RowOptions): HTMLElement | null {
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')].filter(
    (item) => !item.closest('[data-slick-row]'),
  );
  const sample = items[items.length - 1];
  if (!sample) return null;
  const sampleWrapper = outermost(sample);
  const wrapper = sampleWrapper.cloneNode(true) as HTMLElement;
  const item = (wrapper === sampleWrapper ? wrapper : wrapper.querySelector<HTMLElement>(`[role="${sample.getAttribute('role')}"]`)) ?? wrapper;

  for (const node of [wrapper, ...wrapper.querySelectorAll<HTMLElement>('*')]) {
    for (const attribute of ['data-qa', 'id', 'aria-controls', 'aria-haspopup', 'aria-expanded', 'aria-checked', 'aria-selected'])
      node.removeAttribute(attribute);
  }
  // Strip any highlight the sample had when it was cloned.
  for (const node of [wrapper, item]) for (const token of [...node.classList]) if (HIGHLIGHT.test(token)) node.classList.remove(token);
  wrapper.setAttribute('data-slick-row', '');
  wrapper.setAttribute(options.mark, '');
  item.setAttribute('role', options.role);
  item.setAttribute('tabindex', '-1');
  item.setAttribute('aria-label', options.label);

  // Shortcut hints, checkmarks and badges (like "New") belong to the action we cloned.
  for (const extra of item.querySelectorAll('[class*="shortcut" i], [class*="hotkey" i], [class*="check" i], [class*="badge" i]'))
    extra.remove();
  // Sub-menu arrows too, but only parts with no text, so a wrapper holding the label survives.
  const textless = (element: Element) => !squish(element.textContent);
  for (const extra of item.querySelectorAll('[class*="caret" i], [class*="arrow" i]')) if (textless(extra)) extra.remove();
  if (options.role === 'menuitemcheckbox') {
    // Drop the cloned icon (e.g. Huddle preferences' "opens a window" icon) and add our own tick.
    for (const icon of item.querySelectorAll('svg, img, [class*="icon" i]')) if (icon.isConnected && textless(icon)) icon.remove();
    rename(item, options.label);
    ensureStyle(item.ownerDocument);
    const tick = item.ownerDocument.createElement('span');
    tick.className = 'slick-menu-check';
    tick.innerHTML = TICK;
    // Put the tick beside the label's own container, so it lines up on the right.
    (labelNode(item)?.parentElement ?? item).append(tick);
  } else {
    const icon = item.querySelector('svg');
    if (icon && options.icon) {
      // Keep the size the cloned icon came with: some menus collapse without it.
      icon.setAttribute('viewBox', '0 0 20 20');
      icon.innerHTML = options.icon;
    }
    rename(item, options.label);
  }

  // Listen on the whole row: the highlight covers it, so a click anywhere on it should count.
  let lastPick = 0;
  const pick = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    // A click on the item also reaches the wrapper; only act once.
    if (event.timeStamp === lastPick) return;
    lastPick = event.timeStamp;
    options.onPick(event);
  };
  wrapper.addEventListener('click', pick, true);
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') pick(event);
  });
  followHighlight(wrapper, item);
  sampleWrapper.parentElement?.append(wrapper);
  return item;
}

export type MenuWatcher = {
  /** The element clicked or focused just before the menu opened. */
  trigger: () => Element | null;
  dispose: () => void;
};

/**
 * Calls `onMenu` for each open menu whenever a menu appears. Only DOM changes that add a
 * menu trigger a sweep, so the rest of Slack re-rendering costs almost nothing.
 */
export function watchMenus(doc: Document, onMenu: (menu: Element) => void): MenuWatcher {
  const view = doc.defaultView;
  if (!view) return { trigger: () => null, dispose: () => {} };
  let trigger: Element | null = null;
  let frame: number | null = null;

  const remember = (event: Event) => {
    const target = event.target;
    if (!(target instanceof view.Element) || target.closest(MENU)) return;
    trigger = target;
  };
  const sweep = () => {
    frame = null;
    for (const menu of doc.querySelectorAll(MENU)) onMenu(menu);
  };
  const addsMenu = (records: MutationRecord[]) =>
    records.some((record) =>
      [...record.addedNodes].some(
        (node) => node instanceof view.Element && !node.hasAttribute('data-slick-row') && (node.matches(MENU) || node.closest(MENU) || node.querySelector(MENU)),
      ),
    );

  const observer = new view.MutationObserver((records) => {
    if (frame === null && addsMenu(records)) frame = view.requestAnimationFrame(sweep);
  });
  observer.observe(doc.body ?? doc.documentElement, { childList: true, subtree: true });
  for (const type of ['pointerdown', 'click', 'keydown']) doc.addEventListener(type, remember, true);

  return {
    trigger: () => trigger,
    dispose() {
      observer.disconnect();
      if (frame !== null) view.cancelAnimationFrame(frame);
      for (const type of ['pointerdown', 'click', 'keydown']) doc.removeEventListener(type, remember, true);
    },
  };
}
