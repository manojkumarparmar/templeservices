import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './test-fixture.mjs';
async function payload(call) {
  return {volunteers:(await (await call('volunteers')).json()).volunteers.filter(v=>v.active).map(v=>({id:v.id,version:v.version,assignments:v.assignments}))};
}
test('coordinator saves the whole recurring week using existing volunteers without editing profiles', async () => {
  const {db,call}=fixture({userId:'swetha'});
  db.prepare('UPDATE volunteers SET roles_json=? WHERE id=?').run('["coordinator"]','swetha');
  const data=await payload(call);
  data.volunteers.forEach(v=>v.assignments=[]);
  data.volunteers.find(v=>v.id==='swetha').assignments=[{weekday:0,shift:'am'},{weekday:6,shift:'pm'}];
  data.volunteers.find(v=>v.id==='vaidehi').assignments=[{weekday:0,shift:'am'}];
  data.volunteers.find(v=>v.id==='nanda-kumar-das').name='Unwanted edit';
  assert.equal((await call('recurring/save',data)).status,200);
  assert.equal(db.prepare('SELECT name FROM volunteers WHERE id=?').get('nanda-kumar-das').name,'Nanda Kumar Das');
  assert.deepEqual(JSON.parse(db.prepare('SELECT assignments_json FROM volunteers WHERE id=?').get('swetha').assignments_json),[{weekday:0,shift:'am'},{weekday:6,shift:'pm'}]);
  assert.equal((await call('volunteers/save',{name:'Not permitted'})).status,403);
  assert.equal((await call('recurring/save',data)).status,409);
});
test('ordinary volunteers and anonymous users cannot save recurring schedules', async () => {
  for(const options of [{anonymous:true},{userId:'swetha'}]) {
    const {call}=fixture(options);
    assert.equal((await call('recurring/save',await payload(call))).status,403);
  }
});
test('unknown or inactive people, duplicate shifts, invalid days, and stale edits leave the week unchanged', async () => {
  const {db,call}=fixture(); const original=JSON.stringify(db.prepare('SELECT id,assignments_json FROM volunteers ORDER BY id').all());
  for(const change of [
    data=>{data.volunteers[0].id='unknown';},
    data=>{data.volunteers[0].version--;},
    data=>{data.volunteers[0].assignments=[{weekday:7,shift:'am'}];},
    data=>{data.volunteers[0].assignments=[{weekday:0,shift:'am'},{weekday:0,shift:'am'}];},
    data=>{data.volunteers.pop();}
  ]) {
    const data=await payload(call); change(data);
    assert.ok([400,409].includes((await call('recurring/save',data)).status));
    assert.equal(JSON.stringify(db.prepare('SELECT id,assignments_json FROM volunteers ORDER BY id').all()),original);
  }
  const data=await payload(call); db.prepare('UPDATE volunteers SET active=0 WHERE id=?').run('vaidehi');
  assert.equal((await call('recurring/save',data)).status,409);
});
test('a concurrent profile change between validation and write prevents all schedule changes', async () => {
  const {db,env,call}=fixture(); const data=await payload(call);
  data.volunteers.forEach(v=>v.assignments=[]);
  const prepare=env.DB.prepare;
  env.DB.prepare=function(sql) {
    if(sql.startsWith('WITH proposed')) db.prepare('UPDATE volunteers SET version=version+1 WHERE id=?').run('swetha');
    return prepare(sql);
  };
  assert.equal((await call('recurring/save',data)).status,409);
  assert.ok(JSON.parse(db.prepare('SELECT assignments_json FROM volunteers WHERE id=?').get('swetha').assignments_json).length>0);
});


test('recurring save succeeds with D1 trigger-inclusive counts and still rejects stale drafts', async () => {
  const {db,call}=fixture({d1TotalChanges:true}); const data=await payload(call);
  const before=db.prepare('SELECT count(*) AS n FROM schedule_versions').get().n;
  data.volunteers.find(v=>v.id==='swetha').assignments=[{weekday:2,shift:'pm'}];
  assert.equal((await call('recurring/save',data)).status,200);
  assert.ok(db.prepare('SELECT count(*) AS n FROM schedule_versions').get().n>before);
  assert.equal((await call('recurring/save',data)).status,409);
});
