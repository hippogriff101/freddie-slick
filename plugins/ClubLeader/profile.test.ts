import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ago, daysSince, decorate, oneLine, privateRows, profileRows, readPerson, roleOf, span } from './api.ts';
import { Blocked, Limiter } from './limiter.ts';

// Shaped like a real club record, with made-up values.
const record = {
  club_name: 'Example HS',
  status: 'Active',
  member_count: 8,
  first_meeting: '2026-01-12',
  time_last_checkin: '2026-10-30',
  time_created: '2025-09-01T12:00:00.000Z',
  hcb_slug: 'example-hs',
  club_website: 'https://example.club/',
  venue_addr_country: 'United Kingdom',
  venue_addr_city: 'Leeds',
  venue_addr_state: 'West Yorkshire',
  venue_addr_line_1: '1 School Road',
  venue_addr_zip: 'LS1 1AA',
  venue_lat: '53.8',
  venue_lng: '-1.5',
  venue_name: 'Example High School',
  lead_first_name: ['Sam'],
  lead_last_name: ['Example'],
  'contact_email (from rel_leaders)': ['sam@example.com'],
  lead_address_line_1: ['2 Home Street'],
  lead_addr_city: ['Leeds'],
  lead_addr_state: ['West Yorkshire'],
  lead_addr_zip: ['LS2 2BB'],
  lead_addr_country: ['United Kingdom'],
  leader_slack_id: ['U9'],
  team_notes: 'Internal staff notes',
  record_id: 'rec123',
  rel_leaders: ['rec456'],
};
const everything = (rows: { label: string; value: string; href?: string }[]) => JSON.stringify(rows);

test('profileRows: club facts, with links', () => {
  assert.deepEqual(profileRows(record), [
    { label: 'Country', value: 'United Kingdom' },
    { label: 'Members', value: '8' },
    { label: 'First meeting', value: '2026-01-12' },
    { label: 'Last check-in', value: '2026-10-30' },
    { label: 'Club created', value: '2025-09-01' },
    { label: 'HCB', value: 'example-hs', href: 'https://hcb.hackclub.com/example-hs' },
    { label: 'Website', value: 'example.club', href: 'https://example.club/' },
  ]);
});

test('profileRows: nothing personal, and no address parts beyond the country', () => {
  const shown = everything(profileRows(record));
  for (const secret of ['Sam', 'sam@example.com', 'School Road', 'Home Street', 'LS1', 'LS2', 'Leeds', '53.8', 'Internal', 'rec123', 'rec456', 'U9']) {
    assert.ok(!shown.includes(secret), `${secret} must not be in the saved rows`);
  }
});

test('privateRows: name, email and venue area, behind the click', () => {
  assert.deepEqual(privateRows(record), [
    { label: 'Main leader', value: 'Sam Example' },
    { label: 'Contact email', value: 'sam@example.com' },
    { label: 'Venue', value: 'Example High School' },
    { label: 'Venue area', value: 'Leeds, West Yorkshire' },
  ]);
});

test('privateRows: never street addresses, postcodes, coordinates, home addresses or staff notes', () => {
  const shown = everything(privateRows(record));
  for (const secret of ['School Road', 'Home Street', 'LS1', 'LS2', '53.8', '-1.5', 'Internal', 'rec123', 'rec456']) {
    assert.ok(!shown.includes(secret), `${secret} must never be shown`);
  }
});

test('rows: unknown fields and odd values are dropped', () => {
  assert.deepEqual(profileRows({ secret_field: 'x', club_website: 'javascript:alert(1)', hcb_slug: '../evil', first_meeting: 'soon' }), []);
  assert.deepEqual(profileRows(null), []);
  assert.deepEqual(privateRows({ lead_first_name: [], venue_name: '' }), []);
});

const personWith = (role: string | undefined, leaderIds: string[]) => ({
  leader: { by_slack: { found: true, club_name: 'Example HS', club_status: 'Active', ...(role ? { role } : {}) } },
  member: { by_slack: { found: false } },
  clubs: { 'Example HS': { fields: { ...record, leader_slack_id: leaderIds } } },
});

test("readPerson: the API's role decides who is a co-leader", () => {
  // The role wins even when the club record would say otherwise.
  assert.equal(readPerson(personWith('co-leader', ['U1']), 'U1').lookup.coLeader, true);
  assert.equal(readPerson(personWith('Co-Leader', ['U1']), 'U1').lookup.coLeader, true);
  assert.equal(readPerson(personWith('leader', ['U9']), 'U1').lookup.coLeader, false);
});

test('readPerson: with no role, falls back to the club record', () => {
  assert.equal(readPerson(personWith(undefined, ['U9']), 'U1').lookup.coLeader, true);
  assert.equal(readPerson(personWith(undefined, ['U1']), 'U1').lookup.coLeader, false);
});

test('readPerson: saved part has no personal details, hidden part does', () => {
  const { lookup, hidden } = readPerson(personWith('leader', ['U1']), 'U1');
  assert.ok(!JSON.stringify(lookup).includes('sam@example.com'));
  assert.ok(!JSON.stringify(lookup).includes('Sam'));
  assert.equal(hidden[0].value, 'Sam Example');
  assert.equal(typeof lookup.at, 'number');
});

test('roleOf and ago', () => {
  assert.equal(roleOf({ leader: true, coLeader: true, club: null, status: null }, true), 'Club co-leader');
  assert.equal(roleOf({ leader: true, coLeader: true, club: null, status: null }), 'Club leader');
  assert.equal(roleOf({ leader: false, member: true, club: null, status: null }), 'Club member');
  const now = 1_000_000_000_000;
  assert.equal(ago(undefined, now), null);
  assert.equal(ago(now - 20_000, now), 'just now');
  assert.equal(ago(now - 60_000, now), '1 minute ago');
  assert.equal(ago(now - 3 * 3_600_000, now), '3 hours ago');
  assert.equal(ago(now - 2 * 86_400_000, now), '2 days ago');
});

test('limiter: a forced request skips the pause and the budget, but not a stop', async () => {
  let time = 0;
  const limiter = new Limiter({ gapMs: 0, perHour: 1, backoffMs: 1000, maxBackoffMs: 1000, now: () => time, sleep: async () => {} });
  let sent = 0;
  const task = async () => void sent++;
  await limiter.run(task);
  await assert.rejects(limiter.run(task), Blocked); // over budget
  await limiter.run(task, { force: true });
  limiter.pause();
  await limiter.run(task, { force: true });
  assert.equal(sent, 3);
  limiter.stop();
  await assert.rejects(limiter.run(task, { force: true }), Blocked);
  assert.equal(sent, 3);
});

const NOW = Date.UTC(2026, 10, 17, 12); // 17 November 2026

test('span: time since a date, in words', () => {
  assert.equal(span('2025-09-01', NOW), '1 year, 2 months');
  assert.equal(span('2024-11-17', NOW), '2 years');
  assert.equal(span('2026-08-17', NOW), '3 months');
  assert.equal(span('2026-10-18', NOW), '30 days'); // one day short of a month
  assert.equal(span('2026-11-16', NOW), '1 day');
  assert.equal(span('2026-11-17', NOW), 'today');
  assert.equal(span('2026-12-01', NOW), null); // in the future
  assert.equal(span('soon', NOW), null);
  assert.equal(daysSince('2026-11-07', NOW), 10);
});

test('decorate: club age in words', () => {
  assert.deepEqual(decorate([{ label: 'Club created', value: '2025-09-01' }], NOW), [
    { label: 'Club created', value: '2025-09-01', note: '1 year, 2 months old' },
  ]);
});

test('decorate: flags a check-in older than 60 days, and only then', () => {
  const [fresh] = decorate([{ label: 'Last check-in', value: '2026-10-30' }], NOW);
  assert.equal(fresh.note, '18 days ago');
  assert.equal(fresh.warn, undefined);
  const [edge] = decorate([{ label: 'Last check-in', value: '2026-09-18' }], NOW); // exactly 60 days
  assert.equal(edge.warn, undefined);
  const [stale] = decorate([{ label: 'Last check-in', value: '2026-09-17' }], NOW); // 61 days
  assert.equal(stale.note, '2 months ago');
  assert.equal(stale.warn, 'No check-in for over 60 days');
});

test('decorate: leaves other rows alone', () => {
  const rows = [{ label: 'Country', value: 'United Kingdom' }, { label: 'First meeting', value: '2026-01-12' }, { label: 'Members', value: '8' }];
  assert.deepEqual(decorate(rows, NOW), rows);
});

test('oneLine: the hover card summary', () => {
  const lead = { leader: true, club: 'Example HS', status: 'Active' };
  assert.equal(oneLine(lead), 'Leader · Example HS');
  assert.equal(oneLine({ ...lead, coLeader: true }, true), 'Co-leader · Example HS');
  assert.equal(oneLine({ ...lead, coLeader: true }, false), 'Leader · Example HS');
  assert.equal(oneLine({ leader: true, club: null, status: null }), 'Club leader');
  // Members only when other roles are shown, like the badge.
  const member = { leader: false, member: true, club: 'Example HS', status: null };
  assert.equal(oneLine(member, true), 'Member · Example HS');
  assert.equal(oneLine(member, false), null);
  assert.equal(oneLine({ leader: false, club: null, status: null }, true), null);
  assert.equal(oneLine(null), null);
  assert.equal(oneLine({ leader: false, club: null, status: null, failed: true }), null);
});
