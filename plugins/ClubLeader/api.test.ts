import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describe, KeyRejected, leaderBySlack, person, type Fetch } from './api.ts';

const reply = (status: number, body: unknown): Fetch => async () => ({ status, body: JSON.stringify(body) });

test('leaderBySlack: public answer', async () => {
  assert.deepEqual(await leaderBySlack(reply(200, { leader: true }), 'U1', ''), { leader: true, club: null, status: null });
  assert.equal((await leaderBySlack(reply(200, { leader: false }), 'U1', '')).leader, false);
});

test('leaderBySlack: keyed answer and headers', async () => {
  let seen: Record<string, string> = {};
  const fetch: Fetch = async (url, init) => {
    seen = init.headers;
    assert.match(url, /\/leader\/slack\?slackid=U1$/);
    return { status: 200, body: JSON.stringify({ club_name: 'Example HS', club_status: 'Active' }) };
  };
  assert.deepEqual(await leaderBySlack(fetch, 'U1', 'secret'), { leader: true, club: 'Example HS', status: 'Active' });
  assert.deepEqual(seen, { Authorization: 'secret' });
  assert.equal((await leaderBySlack(reply(200, { club_name: null }), 'U1', 'secret')).leader, false);
});

test('401 means the key was rejected', async () => {
  await assert.rejects(leaderBySlack(reply(401, { error: 'Unauthorized' }), 'U1', 'bad'), KeyRejected);
});

test('person: leader with club details', async () => {
  const body = {
    leader: { by_slack: { found: true, club_name: 'Example HS', club_status: 'Active' } },
    member: { by_slack: { found: false } },
    clubs: { 'Example HS': { fields: { club_name: 'Example HS', level: 2, venue_addr_country: 'UK', club_website: 'https://ex.club' } } },
  };
  const info = await person(reply(200, body), 'U1', 'k');
  assert.deepEqual(info, {
    leader: true,
    coLeader: false,
    member: false,
    club: 'Example HS',
    status: 'Active',
    details: { country: 'UK' },
  });
  assert.equal(describe(info), 'Club leader: Example HS (Active)\nUK');
});

test('person: member only', async () => {
  const body = {
    leader: { by_slack: { found: false } },
    member: { by_slack: { found: true, club_name: 'Other Club' } },
    clubs: { 'Other Club': { fields: { status: 'Active' } } },
  };
  const info = await person(reply(200, body), 'U1', 'k');
  assert.equal(info.leader, false);
  assert.equal(info.member, true);
  assert.equal(describe(info), 'Club member: Other Club (Active)');
});

test('person: nobody', async () => {
  const info = await person(reply(200, { leader: { by_slack: { found: false } }, member: { by_slack: { found: false } } }), 'U1', 'k');
  assert.deepEqual(info, { leader: false, coLeader: false, member: false, club: null, status: null, details: null });
});

const clubWith = (leaderIds: unknown) => ({
  leader: { by_slack: { found: true, club_name: 'Example HS', club_status: 'Active' } },
  member: { by_slack: { found: false } },
  clubs: { 'Example HS': { fields: { leader_slack_id: leaderIds } } },
});

test("person: the club's main leader is not a co-leader", async () => {
  assert.equal((await person(reply(200, clubWith(['U1'])), 'U1', 'k')).coLeader, false);
  assert.equal((await person(reply(200, clubWith('U9, u1')), 'U1', 'k')).coLeader, false);
});

test('person: a leader the club does not name as main leader is a co-leader', async () => {
  const info = await person(reply(200, clubWith(['U9'])), 'U1', 'k');
  assert.equal(info.leader, true);
  assert.equal(info.coLeader, true);
  assert.equal(describe(info, true), 'Club co-leader: Example HS (Active)');
  // With other roles off, they're shown as a leader.
  assert.equal(describe(info), 'Club leader: Example HS (Active)');
});

test('person: no main leader recorded means nobody is called a co-leader', async () => {
  assert.equal((await person(reply(200, clubWith(undefined)), 'U1', 'k')).coLeader, false);
  assert.equal((await person(reply(200, clubWith([])), 'U1', 'k')).coLeader, false);
});
