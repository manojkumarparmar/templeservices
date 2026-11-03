import {firebaseConfig, normalizePhone, verifyFirebasePhone} from './firebase.mjs';
export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (condition, status, message) => { if (condition) throw new AuthError(status, message); };
const ROLES = ['super-admin', 'admin', 'headpujari', 'coordinator', 'volunteer', 'backup', 'other'];
const now = () => Math.floor(Date.now() / 1000);
const reply = (data, cookie) => Response.json(data, { headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
const cookie = (name, value, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function getCookie(request, name) { return (request.headers.get('Cookie') || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1); }
export const sha256 = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
const cleanEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
function field(value, length, required = false) { fail(typeof value !== 'string' || value.length > length || (required && !value.trim()), 400, 'Please complete the fields within their length limits.'); return value.trim(); }
export function profile(row, privateFields = false) {
  return { id: row.id, name: row.name, roles: JSON.parse(row.roles_json), assignments: JSON.parse(row.assignments_json), availabilityNotes: row.availability_notes, isSuperAdmin: !!row.is_super_admin, active: !!row.active, version: row.version, ...(privateFields ? { email: row.email || '', phone: row.phone || '' } : {}) };
}
export const isSuper = user => !!user?.isSuperAdmin;
export const isAdmin = user => !!user && (isSuper(user) || user.roles.includes('admin'));
export async function sessionUser(request, env) {
  const raw = getCookie(request, 'tls_session'); if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  const row = await env.DB.prepare('SELECT v.* FROM auth_sessions s JOIN volunteers v ON v.id = s.volunteer_id WHERE s.token_hash = ? AND s.expires_at > ? AND v.active = 1').bind(await sha256(raw), now()).first();
  return row ? profile(row, true) : null;
}
async function startSession(row, env) {
  const raw = token();
  await env.DB.prepare('INSERT INTO auth_sessions(token_hash,volunteer_id,expires_at) VALUES(?,?,?)').bind(await sha256(raw), row.id, now() + 30 * 86400).run();
  return reply({ user: profile(row, true) }, cookie('tls_session', raw, 30 * 86400));
}
async function rateLimit(env, key, limit, seconds) {
  const bucket = Math.floor(now() / seconds), expires = (bucket + 1) * seconds;
  const row = await env.DB.prepare('INSERT INTO auth_rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(await sha256(key + ':' + bucket), expires).first();
  fail(row.count > limit, 429, 'Too many attempts. Please try again later.');
}
async function limitAuth(request, env) {
  await rateLimit(env, 'auth-ip:' + (request.headers.get('CF-Connecting-IP') || 'unknown'), 30, 3600);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_rate_limits WHERE expires_at < ?').bind(now()),
    env.DB.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('DELETE FROM email_codes WHERE expires_at < ?').bind(now())
  ]);
}
function decodeJwt(part) { try { return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); } catch { throw new AuthError(401, 'Google sign-in could not be verified.'); } }
let googleKeys = null, googleKeysExpire = 0;
export async function verifyGoogle(jwt, clientId, nonce, fetcher = fetch) {
  fail(typeof jwt !== 'string' || jwt.length > 12000, 401, 'Invalid Google sign-in.');
  const parts = jwt.split('.'); fail(parts.length !== 3, 401, 'Invalid Google sign-in.');
  const header = decodeJwt(parts[0]), claims = decodeJwt(parts[1]);
  fail(header.alg !== 'RS256' || !header.kid || !nonce || claims.nonce !== nonce, 401, 'Please restart Google sign-in.');
  fail(claims.aud !== clientId || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || typeof claims.exp !== 'number' || claims.exp <= now() || !claims.sub || claims.email_verified !== true || (claims.iat && claims.iat > now() + 60), 401, 'Google sign-in could not be verified.');
  if (!googleKeys || now() >= googleKeysExpire || !googleKeys.some(k => k.kid === header.kid)) {
    const response = await fetcher('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
    fail(!response.ok, 503, 'Google sign-in is temporarily unavailable.');
    googleKeys = (await response.json()).keys; googleKeysExpire = now() + 3600;
  }
  const jwk = googleKeys.find(k => k.kid === header.kid); fail(!jwk, 401, 'Invalid Google sign-in.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  let signature; try { signature = Uint8Array.from(atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch { throw new AuthError(401, 'Invalid Google sign-in.'); }
  fail(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(parts[0] + '.' + parts[1])), 401, 'Google sign-in could not be verified.');
  return claims;
}
async function sendCode(data, request, env) {
  fail(!env.RESEND_API_KEY || !env.EMAIL_FROM, 503, 'Email sign-in is temporarily unavailable. Please use Google or contact the coordinator.');
  const email = cleanEmail(data.email); fail(!validEmail(email), 400, 'Enter a valid email address.');
  await limitAuth(request, env); await rateLimit(env, 'daily-email-total', 90, 86400); await rateLimit(env, 'email:' + email, 5, 3600); await rateLimit(env, 'email-minute:' + email, 1, 60);
  const row = await env.DB.prepare('SELECT * FROM volunteers WHERE email = ? AND active = 1').bind(email).first();
  if (row) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const code = String(random % 1000000).padStart(6, '0'), salt = token();
    await env.DB.prepare('INSERT INTO email_codes(email,salt,code_hash,expires_at,attempts) VALUES(?,?,?,?,0) ON CONFLICT(email) DO UPDATE SET salt=excluded.salt, code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0').bind(email, salt, await sha256(salt + ':' + code), now() + 600).run();
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Your Temple Services sign-in code', text: `Your sign-in code is ${code}. It expires in 10 minutes. Do not share this code. If you did not request it, ignore this email.` }) });
    if (!response.ok) { await env.DB.prepare('DELETE FROM email_codes WHERE email = ? AND salt = ?').bind(email, salt).run(); throw new AuthError(503, 'Could not send the code. Please try again later.'); }
  }
  return reply({ sent: true, message: 'If this email is on the volunteer list, a code has been sent.' });
}
async function checkCode(data, request, env) {
  await limitAuth(request, env);
  const email = cleanEmail(data.email); fail(!validEmail(email) || typeof data.code !== 'string' || !/^\d{6}$/.test(data.code), 400, 'Enter your email and six-digit code.');
  const row = await env.DB.prepare('SELECT * FROM email_codes WHERE email = ?').bind(email).first();
  fail(!row || row.expires_at <= now() || row.attempts >= 5, 401, 'Invalid or expired code. Please request a new one.');
  const result = await env.DB.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE email=? AND salt=? AND attempts<5 AND expires_at>?').bind(email, row.salt, now()).run();
  fail(result.meta.changes !== 1 || await sha256(row.salt + ':' + data.code) !== row.code_hash, 401, 'Invalid or expired code.');
  const consumed = await env.DB.prepare('DELETE FROM email_codes WHERE email=? AND salt=? AND code_hash=? AND expires_at>?').bind(email, row.salt, row.code_hash, now()).run();
  fail(consumed.meta.changes !== 1, 401, 'Code already used. Please request a new one.');
  const volunteer = await env.DB.prepare('SELECT * FROM volunteers WHERE email=? AND active=1').bind(email).first();
  fail(!volunteer, 403, 'Please ask an administrator to add your email to the volunteer list.');
  return startSession(volunteer, env);
}
async function saveVolunteer(data, user, env) {
  fail(!isAdmin(user), 403, 'Only administrators can edit volunteers.');
  const current = data.id ? await env.DB.prepare('SELECT * FROM volunteers WHERE id=?').bind(data.id).first() : null;
  fail(data.id && !current, 404, 'Volunteer not found.');
  fail(current?.is_super_admin && !isSuper(user), 403, 'Only the super-admin can edit this record.');
  fail(!Array.isArray(data.roles) || !data.roles.length || data.roles.some(r => !ROLES.includes(r)) || new Set(data.roles).size !== data.roles.length, 400, 'Choose one or more valid roles.');
  fail(!current?.is_super_admin && data.roles.includes('super-admin'), 403, 'The super-admin role is protected.');
  fail(current?.is_super_admin && (!data.roles.includes('super-admin') || data.active !== true), 403, 'The super-admin must retain the super-admin role and stay active.');
  fail(current?.id === user.id && !isSuper(user) && user.roles.includes('admin') && (!data.roles.includes('admin') || data.active !== true), 403, 'You cannot remove your own admin privilege or deactivate your account.');
  const name = field(data.name, 60, true), email = cleanEmail(data.email), availability = field(data.availabilityNotes, 1000);
  const phone = data.phone === undefined ? current?.phone || '' : normalizePhone(data.phone);
  fail(data.phone !== undefined && data.phone !== '' && !phone, 400, 'Enter a valid US phone number, including area code.');
  fail(email && !validEmail(email), 400, 'Enter a valid email address.');
  fail((data.roles.includes('admin') || current?.is_super_admin) && !email && !(phone && firebaseConfig(env)), 400, 'Administrators need a sign-in email or a configured phone sign-in number.');
  fail(typeof data.active !== 'boolean' || !Array.isArray(data.assignments) || data.assignments.length > 14, 400, 'Invalid recurring assignments.');
  const assignments = data.assignments.map(a => { fail(!Number.isInteger(a.weekday) || a.weekday < 0 || a.weekday > 6 || !['am', 'pm'].includes(a.shift), 400, 'Invalid recurring assignment.'); return { weekday: a.weekday, shift: a.shift }; });
  fail(new Set(assignments.map(a => a.weekday + ':' + a.shift)).size !== assignments.length, 400, 'Do not repeat the same assignment.');
  const emailOwner = email ? await env.DB.prepare('SELECT id FROM volunteers WHERE email=?').bind(email).first() : null;
  fail(emailOwner && emailOwner.id !== current?.id, 409, 'This email belongs to another volunteer.');
  const phoneOwner = phone ? await env.DB.prepare('SELECT id FROM volunteers WHERE phone=?').bind(phone).first() : null;
  fail(phoneOwner && phoneOwner.id !== current?.id, 409, 'This phone number belongs to another volunteer.');
  const id = current?.id || crypto.randomUUID();
  if (current) {
    fail(!Number.isInteger(data.version) || current.version !== data.version, 409, 'This volunteer was updated elsewhere. Reload the directory before editing again.');
    const update = env.DB.prepare('UPDATE volunteers SET name=?,email=?,phone=?,availability_notes=?,assignments_json=?,roles_json=?,active=?,version=version+1,updated_at=? WHERE id=? AND version=? RETURNING id').bind(name, email || null, phone || null, availability, JSON.stringify(assignments), JSON.stringify(data.roles), data.active ? 1 : 0, new Date().toISOString(), id, data.version);
    const revoke = email !== (current.email || '') || phone !== (current.phone || '') || !data.active;
    const statements = revoke ? [
      env.DB.prepare('DELETE FROM auth_sessions WHERE volunteer_id=? AND EXISTS(SELECT 1 FROM volunteers WHERE id=? AND version=?)').bind(id, id, data.version),
      env.DB.prepare('DELETE FROM auth_identities WHERE volunteer_id=? AND EXISTS(SELECT 1 FROM volunteers WHERE id=? AND version=?)').bind(id, id, data.version),
      env.DB.prepare('DELETE FROM email_codes WHERE email=? AND EXISTS(SELECT 1 FROM volunteers WHERE id=? AND version=?)').bind(current.email || '', id, data.version),
      update
    ] : [update];
    const results = await env.DB.batch(statements);
    fail(results[results.length - 1].results.length !== 1, 409, 'This volunteer was updated elsewhere. Reload and try again.');
  } else {
    await env.DB.prepare('INSERT INTO volunteers(id,name,email,phone,availability_notes,assignments_json,roles_json,active) VALUES(?,?,?,?,?,?,?,?)').bind(id, name, email || null, phone || null, availability, JSON.stringify(assignments), JSON.stringify(data.roles), data.active ? 1 : 0).run();
  }
  return reply({ saved: true, id });
}
async function saveRecurringSchedule(data, user, env) {
  fail(!user || !(isAdmin(user) || user.roles.includes('coordinator')), 403, 'Only administrators and coordinators can edit the recurring schedule.');
  const rows = (await env.DB.prepare('SELECT id,version FROM volunteers WHERE active=1').all()).results;
  fail(!Array.isArray(data.volunteers) || data.volunteers.length !== rows.length, 409, 'The volunteer list changed. Reload the schedule and try again.');
  const seen = new Set();
  for (const entry of data.volunteers) {
    fail(!entry || typeof entry.id !== 'string' || seen.has(entry.id) || !rows.some(r => r.id === entry.id && r.version === entry.version), 409, 'The schedule or volunteer list changed. Reload and try again.');
    seen.add(entry.id);
    fail(!Array.isArray(entry.assignments) || entry.assignments.length > 14, 400, 'Invalid recurring assignments.');
    const shifts = new Set();
    for (const a of entry.assignments) {
      fail(!a || !Number.isInteger(a.weekday) || a.weekday < 0 || a.weekday > 6 || !['am','pm'].includes(a.shift), 400, 'Invalid recurring assignment.');
      fail(shifts.has(a.weekday + ':' + a.shift), 400, 'Do not repeat an assignment.');
      shifts.add(a.weekday + ':' + a.shift);
    }
  }
  // One guarded statement keeps all fourteen shifts atomic, including concurrent edits.
  const payload = JSON.stringify(data.volunteers.map(v => ({id:v.id,version:v.version,assignments:v.assignments.map(a => ({weekday:a.weekday,shift:a.shift}))})));
  const result = await env.DB.prepare(`WITH proposed AS MATERIALIZED (SELECT value FROM json_each(?)),
    valid AS MATERIALIZED (SELECT
      (SELECT count(*) FROM volunteers WHERE active=1) = (SELECT count(*) FROM proposed)
      AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE v.active=1 AND NOT EXISTS
        (SELECT 1 FROM proposed p WHERE json_extract(p.value,'$.id')=v.id AND json_extract(p.value,'$.version')=v.version)) AS ok)
    UPDATE volunteers SET assignments_json=(SELECT json_extract(value,'$.assignments') FROM proposed WHERE json_extract(value,'$.id')=volunteers.id),
      version=version+1, updated_at=? WHERE active=1 AND (SELECT ok FROM valid) RETURNING id`)
    .bind(payload, new Date().toISOString()).run();
  fail(result.results.length !== rows.length, 409, 'The schedule changed elsewhere. Reload and try again.');
  return reply({saved:true});
}
export async function handlePeople(request, env, url, data, user) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/auth/me') return reply({ user });
  if (request.method === 'GET' && path === '/api/auth/config') {
    const nonce = token();
    return reply({ googleClientId: env.GOOGLE_CLIENT_ID || null, emailEnabled: !!(env.RESEND_API_KEY && env.EMAIL_FROM), firebase: firebaseConfig(env), nonce }, cookie('tls_google_nonce', nonce, 600));
  }
  if (request.method === 'GET' && path === '/api/volunteers') {
    const rows = await env.DB.prepare('SELECT * FROM volunteers ORDER BY is_super_admin DESC, name COLLATE NOCASE').all();
    return reply({ volunteers: rows.results.filter(r => r.active || isAdmin(user)).map(row => profile(row, !!user)), roles: ROLES });
  }
  if (request.method !== 'POST') return null;
  if (path === '/api/recurring/save') return saveRecurringSchedule(data, user, env);
  if (path.startsWith('/api/auth/')) fail(JSON.stringify(data).length > 16000, 413, 'Sign-in request too large.');
  if (path === '/api/auth/lookup') {
    await limitAuth(request, env);
    const raw = typeof data.identifier === 'string' ? data.identifier.trim() : '';
    const kind = raw.includes('@') ? 'email' : 'phone';
    const value = kind === 'email' ? cleanEmail(raw) : normalizePhone(raw);
    fail(!value || (kind === 'email' && !validEmail(value)), 400, 'Enter a valid email address or US mobile number.');
    const row = await env.DB.prepare(kind === 'email' ? 'SELECT id FROM volunteers WHERE email=? AND active=1' : 'SELECT id FROM volunteers WHERE phone=? AND active=1').bind(value).first();
    return reply({found:!!row, kind});
  }
  if (path === '/api/auth/email/start') return sendCode(data, request, env);
  if (path === '/api/auth/email/verify') return checkCode(data, request, env);
  if (path === '/api/auth/phone') {
    const config = firebaseConfig(env); fail(!config, 503, 'Phone sign-in is not configured yet.');
    await limitAuth(request, env);
    let claims;
    try { claims = await verifyFirebasePhone(data.idToken, config.projectId); }
    catch { throw new AuthError(401, 'Phone sign-in could not be verified. Please request a new code.'); }
    const row = await env.DB.prepare('SELECT * FROM volunteers WHERE phone=? AND active=1').bind(claims.phone_number).first();
    fail(!row, 403, 'Your phone was verified, but it is not linked to an active volunteer profile. Ask an administrator to add or correct your phone number and confirm your profile is active, then request a new code.');
    return startSession(row, env);
  }
  if (path === '/api/auth/google') {
    fail(!env.GOOGLE_CLIENT_ID, 503, 'Google sign-in is temporarily unavailable.');
    await limitAuth(request, env);
    const claims = await verifyGoogle(data.credential, env.GOOGLE_CLIENT_ID, getCookie(request, 'tls_google_nonce'));
    let row = await env.DB.prepare("SELECT v.* FROM auth_identities i JOIN volunteers v ON v.id=i.volunteer_id WHERE i.provider='google' AND i.subject=? AND v.active=1").bind(claims.sub).first();
    if (!row) {
      row = await env.DB.prepare('SELECT * FROM volunteers WHERE email=? AND active=1').bind(cleanEmail(claims.email)).first();
      fail(!row, 403, 'Please ask an administrator to add your email to the volunteer list.');
      await env.DB.prepare("INSERT OR IGNORE INTO auth_identities(provider,subject,volunteer_id) VALUES('google',?,?)").bind(claims.sub, row.id).run();
    }
    const response = await startSession(row, env); response.headers.append('Set-Cookie', cookie('tls_google_nonce', '', 0)); return response;
  }
  if (path === '/api/auth/logout') {
    const raw = getCookie(request, 'tls_session'); if (raw) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await sha256(raw)).run();
    return reply({ signedOut: true }, cookie('tls_session', '', 0));
  }
  if (path === '/api/volunteers/save') return saveVolunteer(data, user, env);
  if (path === '/api/volunteers/remove') {
    fail(!isAdmin(user), 403, 'Only administrators can remove volunteers.');
    const row = await env.DB.prepare('SELECT * FROM volunteers WHERE id=?').bind(data.id || '').first();
    fail(!row, 404, 'Volunteer not found.'); fail(row.is_super_admin, 403, 'The super-admin cannot be removed.');
    fail(row.id === user.id, 403, 'You cannot remove your own administrator account.');
    const result = await env.DB.prepare('UPDATE volunteers SET active=0,version=version+1 WHERE id=? AND version=? RETURNING id').bind(row.id, data.version).run();
    fail(result.results.length !== 1, 409, 'This volunteer was updated elsewhere. Reload and try again.');
    return reply({ removed: true });
  }
  return null;
}
