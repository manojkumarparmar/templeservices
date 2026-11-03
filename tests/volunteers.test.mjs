import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './test-fixture.mjs';
import { sha256, verifyGoogle } from '../server/volunteers.mjs';

async function directory(call) { return (await (await call('volunteers')).json()).volunteers; }

test('administrator can add a volunteer and edit their details and recurring assignments', async () => {
  const {call} = fixture();
  const person = {name:'New Volunteer Mtj',email:'new@example.com',availabilityNotes:'Evenings',roles:['volunteer'],assignments:[],active:true};
  const created = await call('volunteers/save', person);
  assert.equal(created.status, 200);
  const {id} = await created.json();
  let saved = (await directory(call)).find(v => v.id === id);
  assert.equal(saved.name, person.name);
  assert.equal(saved.email, person.email);
  assert.equal((await call('volunteers/save', {...saved,name:'Updated Volunteer Mtj',roles:['volunteer','backup'],assignments:[{weekday:4,shift:'pm'}]})).status, 200);
  saved = (await directory(call)).find(v => v.id === id);
  assert.equal(saved.name, 'Updated Volunteer Mtj');
  assert.deepEqual(saved.assignments, [{weekday:4,shift:'pm'}]);
  assert.ok(saved.roles.includes('backup'));
});

test('updated roster preserves assignments and uses the requested names', async () => {
  const {call} = fixture({anonymous:true});
  const people = await directory(call);
  assert.equal(people.find(v => v.id === 'nanda-kumar-das').name, 'Nanda Kumar Das');
  assert.equal(people.find(v => v.id === 'ajinkya').name, 'Ajinkya Pr');
  assert.ok(people.filter(v => !['nanda-kumar-das','ajinkya'].includes(v.id)).every(v => v.name.endsWith(' Mtj')));
  const vaidehi = people.find(v => v.id === 'vaidehi');
  assert.equal(vaidehi.name, 'Vaidehi Mtj');
  assert.deepEqual(vaidehi.assignments, []);
});
test('public directory hides emails and ordinary volunteers cannot manage records', async () => {
  const publicSite = fixture({ anonymous: true });
  const people = await directory(publicSite.call); assert.equal(people.length, 16);
  assert.ok(people.every(v => !('email' in v)));
  const hema = people.find(v => v.id === 'hema-sirasha'); assert.deepEqual(hema.assignments, [{ weekday: 0, shift: 'am' }]);
  assert.equal((await publicSite.call('volunteers/save', { ...hema, email: '' })).status, 403);
  assert.equal((await publicSite.call('updates', { id: crypto.randomUUID() })).status, 401);
  const volunteer = fixture({ userId: 'hema-sirasha' });
  assert.equal((await volunteer.call('volunteers/save', { ...hema, email: '' })).status, 403);
});
test('admins can edit other admins but cannot edit the super-admin or demote themselves', async () => {
  const { db, call } = fixture({ userId: 'hema-sirasha' });
  db.prepare('UPDATE volunteers SET roles_json=?,email=? WHERE id=?').run('["admin"]', 'admin@example.com', 'hema-sirasha');
  db.prepare('UPDATE volunteers SET roles_json=?,email=? WHERE id=?').run('["admin"]', 'admin2@example.com', 'swetha');
  const people = await directory(call), self = people.find(v => v.id === 'hema-sirasha'), other = people.find(v => v.id === 'swetha'), superAdmin = people.find(v => v.isSuperAdmin);
  assert.equal((await call('volunteers/save', { ...superAdmin, name: 'Changed' })).status, 403);
  assert.equal((await call('volunteers/remove', superAdmin)).status, 403);
  assert.equal((await call('volunteers/save', { ...self, roles: ['volunteer'] })).status, 403);
  assert.equal((await call('volunteers/save', { ...self, active: false })).status, 403);
  assert.equal((await call('volunteers/remove', self)).status, 403);
  assert.equal((await call('volunteers/save', { ...other, name: 'Another admin', roles: ['admin', 'backup'], availabilityNotes: 'Evenings only' })).status, 200);
  const changed = (await directory(call)).find(v => v.id === other.id);
  assert.deepEqual(changed.roles, ['admin', 'backup']); assert.equal(changed.availabilityNotes, 'Evenings only');
  assert.equal((await call('volunteers/save', { ...other, name: 'Stale edit' })).status, 409);
});
test('super-admin can edit all records but cannot drop the protected role or remove their account', async () => {
  const { call, db } = fixture();
  const people = await directory(call), superAdmin = people.find(v => v.isSuperAdmin), other = people.find(v => v.id === 'swetha');
  assert.equal((await call('volunteers/save', { ...superAdmin, availabilityNotes: 'Coordinate service', assignments: [{ weekday: 6, shift: 'pm' }] })).status, 200);
  assert.equal((await call('volunteers/save', { ...superAdmin, version: 2, roles: ['admin'] })).status, 403);
  assert.equal((await call('volunteers/remove', { id: superAdmin.id, version: 2 })).status, 403);
  assert.equal((await call('volunteers/save', { ...other, roles: ['super-admin'] })).status, 403);
  assert.throws(() => db.prepare('DELETE FROM volunteers WHERE id=?').run(superAdmin.id), /cannot be removed/);
  assert.throws(() => db.prepare('UPDATE volunteers SET roles_json=? WHERE id=?').run('["admin"]', superAdmin.id), /protected role/);
  assert.equal((await call('volunteers/save', { ...other, name: 'Swetha Updated', email: 'swetha@example.com', roles: ['admin', 'coordinator'] })).status, 200);
});
test('removed volunteers lose access and can be reactivated by administrators', async () => {
  const { call } = fixture(); const person = (await directory(call)).find(v => v.id === 'swetha');
  assert.equal((await call('volunteers/remove', person)).status, 200);
  const inactive = (await directory(call)).find(v => v.id === 'swetha'); assert.equal(inactive.active, false);
  assert.equal((await call('volunteers/save', { ...inactive, active: true })).status, 200);
});
test('changing a sign-in email atomically revokes old sessions, codes, and linked Google identity', async () => {
  const { db, call } = fixture();
  const person = (await directory(call)).find(v => v.isSuperAdmin);
  db.prepare('INSERT INTO auth_identities VALUES(?,?,?)').run('google', 'old-google-subject', person.id);
  db.prepare('INSERT INTO email_codes VALUES(?,?,?,?,0)').run(person.email, 'salt', 'hash', Math.floor(Date.now() / 1000) + 600);
  assert.equal((await call('volunteers/save', { ...person, email: 'changed@example.com' })).status, 200);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_sessions WHERE volunteer_id=?').get(person.id).n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM auth_identities WHERE volunteer_id=?').get(person.id).n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM email_codes WHERE email=?').get(person.email).n, 0);
  assert.equal((await (await call('auth/me')).json()).user, null);
});
test('email codes expire, limit attempts, are single use, and create a secure session', async () => {
  const { db, call } = fixture({ anonymous: true });
  const email = 'super@example.com', salt = 'salt', hash = await sha256(salt + ':123456'), expiry = Math.floor(Date.now() / 1000) + 600;
  db.prepare('INSERT INTO email_codes VALUES(?,?,?,?,0)').run(email, salt, hash, expiry);
  assert.equal((await call('auth/email/verify', { email, code: '000000' })).status, 401);
  const response = await call('auth/email/verify', { email, code: '123456' }); assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const rawCookie = response.headers.get('Set-Cookie').split(';')[0];
  const me = await (await call('auth/me', null, 'https://templeservices.pages.dev', rawCookie)).json(); assert.equal(me.user.isSuperAdmin, true);
  assert.equal((await call('auth/email/verify', { email, code: '123456' })).status, 401);
  await call('auth/logout', {}, 'https://templeservices.pages.dev', rawCookie);
  assert.equal((await (await call('auth/me', null, 'https://templeservices.pages.dev', rawCookie)).json()).user, null);
  db.prepare('INSERT INTO email_codes VALUES(?,?,?,?,5)').run(email, salt, hash, expiry);
  assert.equal((await call('auth/email/verify', { email, code: '123456' })).status, 401);
});
test('email sign-in sends only to approved volunteers and stores a hash instead of the code', async () => {
  const { env, db, call } = fixture({ anonymous: true });
  env.RESEND_API_KEY = 'test-key'; env.EMAIL_FROM = 'Temple Services <login@example.com>';
  const originalFetch = globalThis.fetch; const messages = [];
  globalThis.fetch = async (url, options) => { assert.equal(url, 'https://api.resend.com/emails'); messages.push(JSON.parse(options.body)); return Response.json({ id: 'test-email' }); };
  try {
    const response = await call('auth/email/start', { email: 'super@example.com' }); assert.equal(response.status, 200);
    assert.equal(messages.length, 1); const code = messages[0].text.match(/code is (\d{6})/)[1];
    assert.notEqual(db.prepare('SELECT code_hash FROM email_codes').get().code_hash, code);
    assert.equal((await call('auth/email/verify', { email: 'super@example.com', code })).status, 200);
    const unknown = await call('auth/email/start', { email: 'unknown@example.com' }); assert.equal(unknown.status, 200);
    assert.equal(messages.length, 1); assert.equal((await unknown.json()).message, (await response.json()).message);
    assert.equal((await call('auth/email/start', { email: 'super@example.com' })).status, 429);
  } finally { globalThis.fetch = originalFetch; }
});
test('Google sign-in checks signature, audience, expiry, and nonce', async () => {
  const key = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', key.publicKey); publicKey.kid = 'test-key';
  const fetcher = async () => Response.json({ keys: [publicKey] });
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  async function makeJwt(overrides = {}) {
    const content = encode({ alg: 'RS256', kid: 'test-key' }) + '.' + encode({ sub: 'google-user', email: 'super@example.com', email_verified: true, aud: 'test-client', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'test-nonce', ...overrides });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(content));
    return content + '.' + Buffer.from(signature).toString('base64url');
  }
  assert.equal((await verifyGoogle(await makeJwt(), 'test-client', 'test-nonce', fetcher)).sub, 'google-user');
  for (const invalid of [{ aud: 'wrong' }, { exp: 1 }, { nonce: 'wrong' }, { email_verified: false }]) await assert.rejects(() => makeJwt(invalid).then(jwt => verifyGoogle(jwt, 'test-client', 'test-nonce', fetcher)));
  const jwt = await makeJwt(); await assert.rejects(() => verifyGoogle(jwt.slice(0, -8) + 'AAAAAAAA', 'test-client', 'test-nonce', fetcher));
});


test('sign-in lookup matches active emails and normalized phones without returning profile details', async () => {
  const {db,call} = fixture({anonymous:true});
  db.prepare('UPDATE volunteers SET phone=? WHERE id=?').run('+12145550123','ajinkya');
  assert.deepEqual(await (await call('auth/lookup',{identifier:'SUPER@example.com'})).json(),{found:true,kind:'email'});
  assert.deepEqual(await (await call('auth/lookup',{identifier:'(214) 555-0123'})).json(),{found:true,kind:'phone'});
  assert.deepEqual(await (await call('auth/lookup',{identifier:'missing@example.com'})).json(),{found:false,kind:'email'});
  db.prepare('UPDATE volunteers SET active=0 WHERE id=?').run('ajinkya');
  assert.deepEqual(await (await call('auth/lookup',{identifier:'2145550123'})).json(),{found:false,kind:'phone'});
  assert.equal((await call('auth/lookup',{identifier:'abc'})).status,400);
});


test('profile saves and removals succeed when D1 counts schedule-history trigger writes', async () => {
  const {db,call}=fixture({d1TotalChanges:true});
  const saved=(await directory(call)).find(v=>v.id==='ajinkya');
  const before=db.prepare('SELECT count(*) AS n FROM schedule_versions').get().n;
  assert.equal((await call('volunteers/save',{...saved,name:'Updated Ajinkya Pr'})).status,200);
  assert.ok(db.prepare('SELECT count(*) AS n FROM schedule_versions').get().n>before);
  assert.equal((await call('volunteers/save',{...saved,name:'Stale edit'})).status,409);
  const updated=(await directory(call)).find(v=>v.id==='ajinkya');
  assert.equal((await call('volunteers/remove',{id:updated.id,version:updated.version})).status,200);
  assert.equal(db.prepare('SELECT active FROM volunteers WHERE id=?').get(updated.id).active,0);
});

test('contacts require an active session while editing remains administrator-only', async () => {
  const {db,call}=fixture({userId:'hema-sirasha'});
  db.prepare('UPDATE volunteers SET email=?,phone=? WHERE id=?').run('swetha@example.com','+12145550123','swetha');
  const response=await call('volunteers');
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  const person=(await response.json()).volunteers.find(v=>v.id==='swetha');
  assert.equal(person.email,'swetha@example.com'); assert.equal(person.phone,'+12145550123');
  assert.equal((await call('volunteers/save',{...person,name:'Changed'})).status,403);
  async function hidden(cookie) {
    const people=(await (await call('volunteers',undefined,undefined,cookie)).json()).volunteers;
    assert.ok(people.every(v=>!('email' in v) && !('phone' in v)));
  }
  await hidden(''); await hidden('tls_session='+'b'.repeat(64));
  db.prepare('UPDATE auth_sessions SET expires_at=0').run(); await hidden('tls_session='+'a'.repeat(64));
  db.prepare('UPDATE auth_sessions SET expires_at=?').run(Math.floor(Date.now()/1000)+3600);
  db.prepare('UPDATE volunteers SET active=0 WHERE id=?').run('hema-sirasha');
  await hidden('tls_session='+'a'.repeat(64));
});
