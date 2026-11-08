import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { handleApi } from '../server/api.mjs';

import { fixture } from './test-fixture.mjs';
const serviceDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayAfter = offset => new Date(Date.parse(serviceDay + 'T12:00:00Z') + offset * 86400000).toISOString().slice(0, 10);
function update() {
  return { id: crypto.randomUUID(), date: serviceDay, shift: 'am', who: 'Test Volunteer', text: 'Ready for the next shift', loads: Object.fromEntries(['kitchen', 'pujari', 'deity'].map(load => [load, { washed: true, dried: false, folded: false }])), photos: [] };
}
test('checklists, photos, and notes persist and can be read by a second visitor', async () => {
  const { call, objects } = fixture(); const data = update(); data.photos = ['data:image/jpeg;base64,/9j/2Q=='];
  assert.equal((await call('updates', data)).status, 201);
  assert.equal((await call('updates', data)).status, 200);
  assert.equal(objects.size, 1);
  const schedule = await (await call(`schedule?from=${dayAfter(-1)}&to=${dayAfter(6)}`)).json();
  assert.equal(schedule.updates.length, 1); assert.equal(schedule.updates[0].loads.kitchen.washed, true);
  assert.equal(schedule.updates[0].who, 'Nanda Kumar Das');
  const photo = await call(schedule.updates[0].photos[0].slice('/api/'.length));
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('Content-Type'), 'image/jpeg');
  assert.equal((await photo.arrayBuffer()).byteLength, 4);
});
const weekdayOfService = (new Date(serviceDay + 'T12:00:00Z').getUTCDay() + 6) % 7;
const noAssignments = db => db.prepare("UPDATE volunteers SET assignments_json='[]'").run();
const actAs = (db, id) => db.prepare('UPDATE auth_sessions SET volunteer_id=?').run(id);
test('backup requests move through needed, assigned and needed again, keeping only the current state', async () => {
  const { call, db } = fixture(); noAssignments(db);
  const base = { date: serviceDay, shift: 'am', notes: 'Unavailable' };
  assert.equal((await call('backups', { ...base, action: 'request', version: 0 })).status, 200);
  assert.equal((await call('backups', { ...base, action: 'request', version: 0 })).status, 409);
  const offer = { ...base, action: 'offer', version: 1 };
  assert.deepEqual((await Promise.all([call('backups', offer), call('backups', offer)])).map(r => r.status).sort(), [200, 409]);
  assert.equal((await call('backups', { ...base, action: 'reopen', version: 2 })).status, 200);
  assert.equal((await call('backups', { ...base, action: 'assign', volunteerId: 'hema', version: 3 })).status, 200);
  const schedule = await (await call(`schedule?from=${serviceDay}&to=${serviceDay}`)).json();
  const state = schedule.backups[serviceDay + ':am'];
  assert.equal(state.status, 'assigned'); assert.deepEqual(state.backup, { id: 'hema', name: 'Hema Mtj' });
  assert.equal(state.requestedBy.id, 'nanda-kumar-das'); assert.equal(state.notes, 'Unavailable');
  assert.equal(state.version, 4); assert.equal(state.history, undefined);
  assert.equal(schedule.backups[serviceDay + ':pm'], undefined);
});
test('backup actions are limited to primaries, the current backup, coordinators and administrators', async () => {
  const { call, db } = fixture(); noAssignments(db);
  db.prepare('UPDATE volunteers SET assignments_json=? WHERE id=?').run(JSON.stringify([{ weekday: weekdayOfService, shift: 'am' }]), 'swetha');
  const base = { date: serviceDay, shift: 'am', notes: '' };
  const status = async (id, data) => { actAs(db, id); return (await call('backups', { ...base, ...data })).status; };
  assert.equal(await status('hema', { action: 'request', version: 0 }), 403);
  assert.equal(await status('swetha', { action: 'request', version: 0 }), 200);
  assert.equal(await status('swetha', { action: 'offer', version: 1 }), 400);
  assert.equal(await status('hema', { action: 'cancel', version: 1 }), 403);
  assert.equal(await status('hema', { action: 'assign', volunteerId: 'vishaka', version: 1 }), 403);
  assert.equal(await status('hema', { action: 'offer', version: 1 }), 200);
  assert.equal(await status('swetha', { action: 'reopen', version: 2 }), 403);
  assert.equal(await status('hema', { action: 'reopen', version: 2 }), 200);
  assert.equal(await status('hema', { action: 'offer', version: 3 }), 200);
  assert.equal(await status('hema', { action: 'release', version: 4 }), 403);
  assert.equal(await status('swetha', { action: 'release', version: 4 }), 200);
  assert.equal(await status('swetha', { action: 'release', version: 5 }), 409);
  assert.equal(await status('swetha', { action: 'cancel', version: 5 }), 409);
  assert.equal(await status('swetha', { action: 'request', version: 5 }), 200);
  assert.equal(await status('swetha', { action: 'cancel', version: 6 }), 200);
  const schedule = await (await call(`schedule?from=${serviceDay}&to=${serviceDay}`)).json();
  assert.equal(schedule.backups[serviceDay + ':am'].status, 'none');
  db.prepare('UPDATE volunteers SET roles_json=? WHERE id=?').run('["coordinator"]', 'hema');
  assert.equal(await status('hema', { action: 'request', version: 7 }), 200);
  assert.equal(await status('hema', { action: 'assign', volunteerId: 'swetha', version: 8 }), 400);
  assert.equal(await status('hema', { action: 'assign', volunteerId: 'nobody', version: 8 }), 400);
  assert.equal(await status('hema', { action: 'assign', volunteerId: 'vishaka', version: 8 }), 200);
  assert.equal(await status('hema', { action: 'release', version: 9 }), 200);
  for (const role of ['coordinator', 'admin']) {
    const f = fixture({ userId: 'vishaka' }); noAssignments(f.db);
    f.db.prepare('UPDATE volunteers SET roles_json=? WHERE id=?').run(JSON.stringify([role]), 'vishaka');
    assert.equal((await f.call('backups', { ...base, action: 'request', version: 0 })).status, 200);
  }
  assert.equal((await fixture().call('backups', { ...base, action: 'request', version: 0 })).status, 200);
  assert.equal((await fixture({ anonymous: true }).call('backups', { ...base, action: 'request', version: 0 })).status, 401);
});
test('older backup records are read as the current state', async () => {
  const { call, db } = fixture(); noAssignments(db);
  const insert = db.prepare('INSERT INTO shift_backups (service_date, shift, state_json, version, updated_at) VALUES (?, ?, ?, 3, ?)');
  const legacy = { person: 'Original', notes: 'Travelling', requestedAt: 'then', requestedBy: 'swetha', wasBackup: false, history: [{ person: 'Earlier' }] };
  insert.run(serviceDay, 'am', JSON.stringify({ ...legacy, cover: 'Old backup', coveredBy: 'hema', coveredAt: 'then' }), 'then');
  insert.run(serviceDay, 'pm', JSON.stringify(legacy), 'then');
  const backups = (await (await call(`schedule?from=${serviceDay}&to=${serviceDay}`)).json()).backups;
  assert.equal(backups[serviceDay + ':am'].status, 'assigned'); assert.equal(backups[serviceDay + ':am'].backup.name, 'Old backup');
  assert.equal(backups[serviceDay + ':pm'].status, 'needed'); assert.equal(backups[serviceDay + ':pm'].requestedBy.name, 'Original');
  assert.equal((await call('backups', { date: serviceDay, shift: 'am', action: 'release', version: 3 })).status, 200);
  assert.equal((await call('backups', { date: serviceDay, shift: 'pm', action: 'reopen', version: 3 })).status, 409);
});
test('validation rejects future notes, old backup requests, bad images, and cross-site writes', async () => {
  const { call } = fixture();
  assert.equal((await call('updates', { ...update(), date: dayAfter(1) })).status, 400);
  assert.equal((await call('updates', { ...update(), date: dayAfter(-2) })).status, 400);
  assert.equal((await call('updates', { ...update(), photos: ['data:image/jpeg;base64,SGVsbG8='] })).status, 400);
  assert.equal((await call('updates', { ...update(), photos: Array(5).fill('data:image/jpeg;base64,/9j/2Q==') })).status, 400);
  assert.equal((await call('updates', { ...update(), who: '' })).status, 201); // The authenticated name overrides submitted names.
  assert.equal((await call('updates', update(), 'https://unrelated.example')).status, 403);
  assert.equal((await call('backups', { date: dayAfter(-1), shift: 'am', action: 'request', version: 0 })).status, 400);
  assert.equal((await call('backups', { date: serviceDay, shift: 'am', action: 'unknown', version: 0 })).status, 400);
  assert.equal((await call('schedule?from=2026-02-30&to=2026-03-01')).status, 400);
  assert.equal((await call(`schedule?from=${serviceDay}&to=${dayAfter(8)}`)).status, 400);
  assert.equal((await call('photos/nonexistent')).status, 404);
});
test('empty updates are rejected; checklist-only and photo-only updates are accepted', async () => {
  const { call } = fixture(); const data = update(); data.text = '';
  assert.equal((await call('updates', data)).status, 201);
  const empty = update(); empty.text = ''; Object.values(empty.loads).forEach(load => { load.washed = false; });
  assert.equal((await call('updates', empty)).status, 400);
  empty.photos = ['data:image/jpeg;base64,/9j/2Q==']; empty.shift = 'pm';
  assert.equal((await call('updates', empty)).status, 201);
});
test('failed database save cleans uploaded photos and leaves no partial update', async () => {
  const { call, env, objects, db } = fixture(); const data = update(); data.photos = ['data:image/jpeg;base64,/9j/2Q=='];
  env.DB.batch = async () => { throw new Error('Simulated database outage'); };
  assert.equal((await call('updates', data)).status, 500);
  assert.equal(objects.size, 0); assert.equal(db.prepare('SELECT count(*) AS n FROM load_updates').get().n, 0);
});
