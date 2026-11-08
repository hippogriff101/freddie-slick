import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { menuKind } from './menus.ts';
import { readMicState } from './mic.ts';

test('reads the mic button from its label', () => {
  assert.equal(readMicState({ label: 'Unmute' }), 'muted');
  assert.equal(readMicState({ label: 'Mute' }), 'live');
  assert.equal(readMicState({ label: 'Mute microphone' }), 'live');
});

test('reads the mic button from its toggle state', () => {
  assert.equal(readMicState({ pressed: 'true' }), 'muted');
  assert.equal(readMicState({ pressed: 'false' }), 'live');
  assert.equal(readMicState({ checked: 'true' }), 'muted');
});

test('refuses to guess when the hints disagree', () => {
  assert.equal(readMicState({ label: 'Mute', pressed: 'true' }), 'unknown');
  assert.equal(readMicState({ label: 'Camera' }), 'unknown');
  assert.equal(readMicState({}), 'unknown');
});

test('agrees when label and toggle state say the same thing', () => {
  assert.equal(readMicState({ label: 'Unmute microphone', pressed: 'true' }), 'muted');
  assert.equal(readMicState({ label: 'Mute microphone', pressed: 'false' }), 'live');
});

test('spots the mic menu from the button that opened it', () => {
  assert.equal(menuKind('Microphone', []), 'mic');
  assert.equal(menuKind('huddle_footer_mic', ['MacBook Pro Microphone']), 'mic');
  assert.equal(menuKind('Microphone', ['Camera', 'Speaker']), 'mic');
});

test('spots the huddle settings menu', () => {
  assert.equal(menuKind('Huddle settings', []), 'settings');
  assert.equal(menuKind('', ['Notifications', 'Huddle settings']), 'settings');
});

test('leaves unrelated menus and host controls alone', () => {
  assert.equal(menuKind('Participant actions', ['Mute microphone', 'View participant']), null);
  assert.equal(menuKind('Mute everyone', []), null);
  assert.equal(menuKind('', ['Camera', 'Speaker', 'Leave huddle']), null);
  assert.equal(menuKind('', []), null);
});

test("doesn't add the toggle to a participant's own menu", () => {
  assert.equal(menuKind('', ['Mute microphone', 'View profile']), null);
  assert.equal(menuKind('More actions', ['Mute microphone', 'Send message']), null);
});

test("spots the huddle's ⋯ menu, but only inside a huddle", () => {
  assert.equal(menuKind('More options', ['Share screen', 'Start a recording'], true), 'more');
  assert.equal(menuKind('More actions', ['Copy link', 'Mark unread'], false), null);
});

test("leaves a participant's ⋯ menu alone", () => {
  assert.equal(menuKind('More actions', ['Mute microphone'], true), null);
  assert.equal(menuKind('More actions', ['Mute microphone', 'Pop out video'], true), null);
});

test('only counts settings menus that belong to a huddle', () => {
  assert.equal(menuKind('Channel options', ['Copy link', 'Leave channel']), null);
  assert.equal(menuKind('Preferences', ['Notifications', 'Sidebar']), null);
  assert.equal(menuKind('Huddle options', []), 'settings');
});
