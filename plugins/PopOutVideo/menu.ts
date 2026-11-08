// Adds "Pop out video" to the menu Slack opens over a participant's video. Finding
// menus, cloning a row and making it highlight like Slack's own is shared code.

import { addRow, MENU, watchMenus } from '../_shared/menus.ts';
import { videoFromTrigger } from './tiles.ts';

export type MenuHookOptions = {
  label: string;
  onPick: (video: HTMLVideoElement) => void;
  log: (...args: unknown[]) => void;
};

const MARK = 'data-slick-pop-out';
const ICON =
  '<path fill="currentColor" d="M3.5 4.5h5v1.75H5.25v9.5h9.5V12h1.75v4.25a1.75 1.75 0 0 1-1.75 1.75h-9.5A1.75 1.75 0 0 1 3.5 16.25z"/>' +
  '<path fill="currentColor" d="M12 3.5h4.5V8h-1.75V6.49l-4.4 4.39-1.23-1.23 4.39-4.4H12z"/>';

function closeMenu(menu: Element): void {
  for (const type of ['keydown', 'keyup'] as const)
    menu.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
  // A menu that ignores Escape would otherwise sit over the new window. Hidden rather than
  // removed, because React owns the node and deleting a child it still holds throws.
  setTimeout(() => {
    if (menu.isConnected) (menu as HTMLElement).style.display = 'none';
  }, 150);
}

/** Watches one document. Returns a disposer. */
export function installMenuHook(doc: Document, { label, onPick, log }: MenuHookOptions): () => void {
  const watcher = watchMenus(doc, (menu) => {
    if (menu.querySelector(`[${MARK}]`)) return;
    // Remember the tile now: by the time the row is clicked, the click target is our row.
    const opener = watcher.trigger();
    if (!videoFromTrigger(opener)) return;
    const item = addRow(menu, {
      label,
      mark: MARK,
      role: 'menuitem',
      icon: ICON,
      onPick: () => {
        // Re-resolve: the tile may have been recycled between opening and clicking.
        const live = videoFromTrigger(opener);
        closeMenu(menu);
        if (live) onPick(live);
        else log('that tile has no video any more');
      },
    });
    if (item) log('added the pop-out row to a participant menu');
  });

  return () => {
    watcher.dispose();
    for (const row of doc.querySelectorAll(`${MENU} [${MARK}]`)) row.remove();
  };
}
