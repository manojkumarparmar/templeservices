import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.mjs';
const serviceDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayAfter = offset => new Date(Date.parse(serviceDay + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
const weekdayOf = day => (new Date(day + 'T12:00:00Z').getUTCDay() + 6) % 7;
const range = `schedule?from=${dayAfter(0)}&to=${dayAfter(6)}`;
function setup() {
  const f = fixture();
  f.db.prepare("UPDATE volunteers SET assignments_json='[]'").run();
  f.db.prepare("INSERT INTO volunteers(id,name,assignments_json,roles_json,active) VALUES('weekly','Weekly Person',?,'[\"volunteer\"]',1)").run(JSON.stringify([{ weekday: weekdayOf(dayAfter(2)), shift: 'am' }]));
  f.db.prepare("INSERT INTO volunteers(id,name,assignments_json,roles_json,active) VALUES('planned','Planned Person','[]','[\"volunteer\"]',1)").run();
  return f;
}
const names = (schedule, day, shift) => schedule.assignments[day][shift].map(p => p.name);
const actAs = (db, id) => db.prepare('UPDATE auth_sessions SET volunteer_id=?').run(id);

test('a dated plan replaces the weekly primaries for that date only', async () => {
  const { call } = setup(), day = dayAfter(2), nextWeek = dayAfter(9);
  assert.deepEqual(names(await (await call(range)).json(), day, 'am'), ['Weekly Person']);
  assert.equal((await call('planned/save', { shift: 'am', dates: [day, nextWeek], volunteerIds: ['planned'] })).status, 200);
  const schedule = await (await call(range)).json();
  assert.deepEqual(names(schedule, day, 'am'), ['Planned Person']);
  assert.deepEqual(names(schedule, dayAfter(3), 'am'), []);
  assert.equal(schedule.planned[day + ':am'], true);
  const list = await (await call('planned')).json();
  assert.deepEqual(list.planned.map(p => [p.date, p.shift, p.people[0].name]), [[day, 'am', 'Planned Person'], [nextWeek, 'am', 'Planned Person']]);
  assert.equal((await call('planned/save', { shift: 'am', dates: [day], volunteerIds: [] })).status, 200);
  assert.deepEqual(names(await (await call(range)).json(), day, 'am'), []);
  assert.equal((await call('planned/remove', { shift: 'am', date: day })).status, 200);
  assert.deepEqual(names(await (await call(range)).json(), day, 'am'), ['Weekly Person']);
});

test('only managers plan dates, within today to 90 days, using active volunteers', async () => {
  const { call, db } = setup(), day = dayAfter(2);
  const bad = data => call('planned/save', { shift: 'am', volunteerIds: ['planned'], ...data });
  assert.equal((await bad({ dates: [dayAfter(-1)] })).status, 400);
  assert.equal((await bad({ dates: [dayAfter(91)] })).status, 400);
  assert.equal((await bad({ dates: [] })).status, 400);
  assert.equal((await bad({ dates: [day], shift: 'x' })).status, 400);
  assert.equal((await bad({ dates: [day], volunteerIds: ['nobody'] })).status, 400);
  db.prepare("UPDATE volunteers SET active=0 WHERE id='planned'").run();
  assert.equal((await bad({ dates: [day] })).status, 400);
  db.prepare("UPDATE volunteers SET active=1 WHERE id='planned'").run();
  actAs(db, 'planned');
  assert.equal((await bad({ dates: [day] })).status, 403);
  assert.equal((await call('planned/remove', { shift: 'am', date: day })).status, 403);
  assert.equal(Object.hasOwn(await (await call(range)).json(), 'planned'), false);
  db.prepare("UPDATE volunteers SET roles_json='[\"coordinator\"]' WHERE id='planned'").run();
  assert.equal((await bad({ dates: [day] })).status, 200);
});

test('backup rules and open requests follow the planned primaries', async () => {
  const { call, db } = setup(), day = dayAfter(2);
  await call('planned/save', { shift: 'am', dates: [day], volunteerIds: ['planned'] });
  actAs(db, 'weekly');
  const weeklyTry = await call('backups', { date: day, shift: 'am', action: 'request', version: 0 });
  assert.equal(weeklyTry.status, 403);
  actAs(db, 'planned');
  const request = await call('backups', { date: day, shift: 'am', action: 'request', version: 0, notes: 'Away' });
  assert.equal(request.status, 200);
  actAs(db, 'nanda-kumar-das');
  assert.equal((await call('planned/save', { shift: 'am', dates: [day], volunteerIds: [] })).status, 409);
  assert.equal((await call('planned/remove', { shift: 'am', date: day })).status, 409);
  assert.equal((await call('backups', { date: day, shift: 'am', action: 'assign', version: 1, volunteerId: 'planned' })).status, 400);
  assert.equal((await call('backups', { date: day, shift: 'am', action: 'assign', version: 1, volunteerId: 'weekly' })).status, 200);
});

test('deactivated volunteers drop out of future plans and names stay current', async () => {
  const { call, db } = setup(), day = dayAfter(2);
  await call('planned/save', { shift: 'pm', dates: [day], volunteerIds: ['planned', 'weekly'] });
  db.prepare("UPDATE volunteers SET name='Renamed Person' WHERE id='planned'").run();
  assert.deepEqual(names(await (await call(range)).json(), day, 'pm').sort(), ['Renamed Person', 'Weekly Person']);
  db.prepare("UPDATE volunteers SET active=0 WHERE id='weekly'").run();
  assert.deepEqual(names(await (await call(range)).json(), day, 'pm'), ['Renamed Person']);
});

test('the schedule still loads before the planned dates table exists', async () => {
  const { call, db } = setup();
  db.exec('DROP TABLE planned_shifts');
  assert.equal((await call(range)).status, 200);
  assert.deepEqual((await (await call('planned')).json()).planned, []);
});
